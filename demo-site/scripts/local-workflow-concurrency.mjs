// Real PostgreSQL sessions against the disposable local cluster only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function checkConcurrency({ bin, env, sql }) {
  assert.match(env.PGHOST, /solar-workflow-/);
  const row = JSON.parse(
    sql(`select json_build_object('org',o.id,'owner',u.id,'plant',p.id)
    from public.organizations o join public.plants p on p.organization_id=o.id
    cross join auth.users u where o.slug='service-local-test' and u.email='service-owner@example.invalid' limit 1;`).trim(),
  );
  const active = new Set();
  const start = (input) => {
    const process = spawn(
      join(bin, 'psql'),
      ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
      { env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const session = { process, out: '', err: '', code: null };
    active.add(session);
    process.stdout.on('data', (data) => (session.out += data));
    process.stderr.on('data', (data) => (session.err += data));
    session.done = new Promise((resolve) =>
      process.once('close', (code) => {
        session.code = code;
        active.delete(session);
        resolve(code);
      }),
    );
    process.stdin.write(input);
    return session;
  };
  const until = async (predicate, label) => {
    const deadline = Date.now() + 6000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error('Timeout: ' + label);
      await pause(25);
    }
  };
  const claims = `select set_config('request.jwt.claim.sub','${row.owner}',false);set role authenticated;set statement_timeout='5s';`;
  function seed(code) {
    return sql(`insert into public.inspections(organization_id,plant_id,inspection_code)
      values('${row.org}','${row.plant}','${code}') returning id;`).trim();
  }
  try {
    const inspection = seed('CONCURRENCY-REVIEW');
    const file =
      sql(`insert into public.inspection_files(organization_id,inspection_id,kind,storage_bucket,storage_path,original_name,mime_type,bytes,sha256,created_by)
      values('${row.org}','${inspection}','thermal_original','inspection-originals','concurrency/a.jpg','가상 사진','image/jpeg',100,repeat('a',64),'${row.owner}') returning id;`).trim();
    const image =
      sql(`insert into public.report_images(id,organization_id,inspection_id,source_file_id,storage_path,sha256,bytes,width,height,caption,masks,status,created_by,reviewed_by,reviewed_at)
      values(gen_random_uuid(),'${row.org}','${inspection}','${file}','concurrency/r.jpg',repeat('b',64),100,100,100,'가상 사진','[]','approved','${row.owner}','${row.owner}',now()) returning id;`).trim();
    const report = sql(
      `${claims}select id from public.create_report_draft('${inspection}','동시성 시험');`,
    )
      .trim()
      .split('\n')
      .at(-1);
    const holder = start(
      `begin;select id from public.inspections where id='${inspection}' for update;select 'HOLDER_READY';\n`,
    );
    await until(() => holder.out.includes('HOLDER_READY'), 'parent holder');
    const reviewer = start(
      `${claims}select 'PID:'||pg_backend_pid();select id from public.review_report_image('${image}',repeat('b',64),true);\n`,
    );
    await until(() => /PID:\d+/.test(reviewer.out), 'review backend');
    const pid = Number(reviewer.out.match(/PID:(\d+)/)[1]);
    await until(
      () =>
        sql(
          `select coalesce(wait_event_type='Lock',false) from pg_stat_activity where pid=${pid};`,
        ).trim() === 't',
      'review waits for parent',
    );
    assert.equal(
      sql(
        `select count(*) from pg_locks where pid=${pid} and locktype='advisory' and granted;`,
      ).trim(),
      '0',
      'image review must wait on parent BEFORE taking advisory lock',
    );
    const transition = start(
      `${claims}select 'TRANSITION_READY';select id from public.transition_report_status('${report}','review',null,1,null);\n`,
    );
    await until(
      () => transition.out.includes('TRANSITION_READY'),
      'transition backend',
    );
    holder.process.stdin.end('commit;\n');
    reviewer.process.stdin.end();
    transition.process.stdin.end();
    assert.deepEqual(
      await Promise.all([holder.done, reviewer.done, transition.done]),
      [0, 0, 0],
      reviewer.err + transition.err,
    );
    assert.equal(
      sql(`select status from public.reports where id='${report}';`).trim(),
      'review',
    );
    console.log(
      'PASS concurrent image approval/report review: parent-first lock, no advisory inversion or deadlock',
    );
    const second = seed('CONCURRENCY-DRAFT');
    const draft = () =>
      start(
        `${claims}select id from public.create_report_draft('${second}','동시 초안');\n`,
      );
    const a = draft(),
      b = draft();
    a.process.stdin.end();
    b.process.stdin.end();
    const codes = await Promise.all([a.done, b.done]);
    assert.equal(codes.filter((code) => code === 0).length, 1, a.err + b.err);
    assert.match(a.err + b.err, /작성|검토/);
    assert.equal(
      sql(
        `select count(*) from public.reports where inspection_id='${second}' and status='draft';`,
      ).trim(),
      '1',
    );
    console.log(
      'PASS concurrent report creation: exactly one active draft and one explicit rejection',
    );
  } finally {
    for (const s of active) s.process.kill('SIGTERM');
    await Promise.all([...active].map((s) => s.done));
  }
}
