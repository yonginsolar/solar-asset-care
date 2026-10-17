// Local PostgreSQL preflight only. No remote connection, keys, mail or real rows.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

assert.equal(process.env.SOLAR_PG_PATCH_RUN, '1');
const pg = '/opt/homebrew/opt/postgresql@17/bin';
const work = mkdtempSync('/tmp/solar-workflow-pg-');
chmodSync(work, 0o700);
const env = {
  ...process.env,
  PGHOST: work,
  PGPORT: '55441',
  PGUSER: 'solar_patch',
  PGDATABASE: 'postgres',
  PGPASSWORD: '',
  PGSSLMODE: 'disable',
};
const run = (tool, args, input) =>
  execFileSync(join(pg, tool), args, {
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
const sql = (text) =>
  run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], text).trim();
let started = false,
  checks = 0;
const owner = '11111111-1111-4111-8111-111111111111',
  expert = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333',
  org = '44444444-4444-4444-8444-444444444444';
const inspection = '55555555-5555-4555-8555-555555555555';
const actor = (id) =>
  `select set_config('request.jwt.claim.sub','${id}',false);`;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
  console.log('PASS ' + message);
};
const rejected = (text, pattern, message) => {
  let error = '';
  try {
    sql(text);
  } catch (e) {
    error = String(e.stderr);
  }
  check(pattern.test(error), message);
};
try {
  run('initdb', [
    '-D',
    join(work, 'data'),
    '-U',
    'solar_patch',
    '-A',
    'trust',
    '--no-locale',
    '--encoding=UTF8',
  ]);
  run('pg_ctl', [
    '-D',
    join(work, 'data'),
    '-l',
    join(work, 'postgres.log'),
    '-o',
    `-h '' -k '${work}' -p 55441`,
    '-w',
    'start',
  ]);
  started = true;
  sql(`create role anon nologin; create role authenticated nologin;
    create schema private; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.inspections(id uuid primary key,organization_id uuid,status text,scheduled_at timestamptz,due_at timestamptz,capture_timezone text,updated_at timestamptz default now());
    create table public.reports(id uuid primary key default gen_random_uuid(),inspection_id uuid,status text,version int);
    create table public.inspection_files(id uuid primary key default gen_random_uuid(),organization_id uuid,inspection_id uuid,kind text,mime_type text);
    create table public.analysis_runs(id uuid primary key default gen_random_uuid(),organization_id uuid,inspection_id uuid,algorithm_key text,algorithm_version text,status text,input_manifest jsonb,requested_by uuid,started_at timestamptz,finished_at timestamptz,result_summary jsonb,error_code text,reviewed_by uuid,reviewed_at timestamptz,review_note text);
    create table public.findings(organization_id uuid,inspection_id uuid,analysis_run_id uuid,source text,kind text,severity text,relative_heat_score numeric,region jsonb,disposition text);
    create table public.audit_events(organization_id uuid,actor_user_id uuid,action text,entity_type text,entity_id text,metadata jsonb);
    create function private.has_org_role(p uuid,roles text[]) returns boolean language sql stable as $$select p='${org}' and (select auth.uid())='${owner}' and 'owner'=any(roles)$$;
    create function private.can_work_inspection(p uuid) returns boolean language sql stable as $$select exists(select 1 from public.inspections where id=p and organization_id='${org}') and (select auth.uid()) in ('${owner}','${expert}')$$;
    insert into inspections(id,organization_id,status) values('${inspection}','${org}','expert_review');
    insert into reports(inspection_id,status,version) values('${inspection}','published',2);`);
  // Captured definitions contain no data/credentials. Their existing authorization,
  // validation, audit and locks are kept, then patched exactly as on the server.
  sql(readFileSync(process.env.SOLAR_PG_BEFORE_SQL, 'utf8'));
  sql(
    'begin;\n' +
      readFileSync(process.env.SOLAR_PG_PATCH_SQL, 'utf8') +
      '\ncommit;',
  );
  check(
    sql(`select private.relative_analysis_editable('${inspection}')`) === 'f',
    'old publication without a new draft stays locked',
  );
  sql(
    `insert into reports(inspection_id,status,version) values('${inspection}','draft',3);`,
  );
  check(
    sql(`select private.relative_analysis_editable('${inspection}')`) === 't',
    'newer draft can coexist with the immutable issue',
  );
  check(
    sql(
      "select has_function_privilege('anon','private.relative_analysis_editable(uuid)','EXECUTE') or has_function_privilege('authenticated','private.relative_analysis_editable(uuid)','EXECUTE')",
    ) === 'f',
    'internal state helper grants no new client access',
  );
  const file = sql(
    `insert into inspection_files(organization_id,inspection_id,kind,mime_type) values('${org}','${inspection}','thermal_original','image/png') returning id;`,
  );
  for (const id of ['', client, '66666666-6666-4666-8666-666666666666'])
    rejected(
      actor(id) + `select private.start_relative_analysis('${file}',64);`,
      /권한|로그인/,
      'original authentication/work authorization still rejects outsider',
    );
  const start = (fileId) =>
    sql(
      actor(expert) +
        `select (private.start_relative_analysis('${fileId}',64)).id;`,
    )
      .split('\n')
      .at(-1);
  const runId = start(file);
  sql(
    actor(expert) +
      `select (private.complete_relative_analysis('${runId}','{}','[]')).status;`,
  );
  check(
    sql(`select status from analysis_runs where id='${runId}'`) === 'succeeded',
    'revision analysis completes while old issue remains published',
  );
  check(
    sql(
      "select count(*) from reports where status='published' and version=2",
    ) === '1',
    'analysis never withdraws or changes the old issue',
  );
  rejected(
    actor(expert) + `select private.start_relative_analysis('${file}',64);`,
    /이미 완료/,
    'successful source cannot be duplicated',
  );
  const file2 = sql(
    `insert into inspection_files(organization_id,inspection_id,kind,mime_type) values('${org}','${inspection}','thermal_original','image/png') returning id;`,
  );
  const run2 = start(file2);
  sql(`update reports set status='review' where version=3;`);
  rejected(
    actor(expert) +
      `select private.complete_relative_analysis('${run2}','{}','[]');`,
    /검토/,
    'review acquired during analysis still prevents completion',
  );
  rejected(
    actor(expert) +
      `select private.resolve_relative_analysis('${run2}','running','cancel','test');`,
    /검토/,
    'review state still prevents resolution',
  );
  sql(`update reports set status='draft' where version=3;`);
  sql(
    actor(expert) +
      `select private.resolve_relative_analysis('${run2}','running','cancel','test'); select private.resolve_relative_analysis('${run2}','cancelled','manual_review','test');`,
  );
  check(
    sql(
      `select status='cancelled' and reviewed_at is not null from analysis_runs where id='${run2}'`,
    ) === 't',
    'revision can explicitly cancel then acknowledge manual review',
  );
  for (const status of ['published', 'closed', 'cancelled']) {
    sql(`update inspections set status='${status}' where id='${inspection}';`);
    rejected(
      actor(expert) + `select private.start_relative_analysis('${file2}',64);`,
      /발행|종료|검토/,
      status + ' stays analysis-locked',
    );
  }
  sql(
    `update inspections set status='requested' where id='${inspection}'; delete from reports;`,
  );
  for (const status of ['review', 'approved']) {
    sql(
      `insert into reports(inspection_id,status,version) values('${inspection}','${status}',4);`,
    );
    rejected(
      actor(expert) + `select private.start_relative_analysis('${file2}',64);`,
      /검토/,
      status + ' report stays analysis-locked',
    );
    sql('delete from reports;');
  }
  sql(
    `insert into reports(inspection_id,status,version) values('${inspection}','published',4),('${inspection}','draft',3);`,
  );
  check(
    sql(`select private.relative_analysis_editable('${inspection}')`) === 'f',
    'older draft cannot unlock a newer publication',
  );
  sql('delete from reports;');
  const revision = sql(
    `select updated_at from inspections where id='${inspection}';`,
  );
  rejected(
    actor(expert) +
      `select private.update_inspection_schedule('${inspection}','${revision}','2026-10-22T10:00:00Z',null);`,
    /관리자/,
    'expert schedule edits stay denied',
  );
  rejected(
    actor(owner) +
      `select private.update_inspection_schedule('${inspection}','2000-01-01',null,null);`,
    /변경/,
    'stale schedule still rejected',
  );
  sql(
    actor(owner) +
      `select private.update_inspection_schedule('${inspection}','${revision}','2026-10-22T10:00:00Z',null);`,
  );
  check(
    sql(`select status from inspections where id='${inspection}'`) ===
      'scheduled',
    'first valid scheduled date atomically confirms initial schedule',
  );
  rejected(
    `update inspections set scheduled_at=null where id='${inspection}';`,
    /예정 일시/,
    'direct date clearing cannot leave confirmed-without-date',
  );
  sql(
    actor(owner) +
      `select private.update_inspection_schedule('${inspection}','${revision}',null,null);`,
  );
  check(
    sql(`select status from inspections where id='${inspection}'`) ===
      'requested',
    'clearing an initial schedule atomically restores requested state',
  );
  rejected(
    `update inspections set status='scheduled' where id='${inspection}';`,
    /예정 일시/,
    'direct status-only confirmation is rejected',
  );
  rejected(
    `insert into inspections(id,organization_id,status) values(gen_random_uuid(),'${org}','scheduled');`,
    /예정 일시/,
    'direct insert without scheduled date is rejected',
  );
  sql(
    `update inspections set status='expert_review' where id='${inspection}';`,
  );
  sql(
    actor(owner) +
      `select private.update_inspection_schedule('${inspection}','${revision}','2026-10-22T10:00:00Z',null);`,
  );
  check(
    sql(`select status from inspections where id='${inspection}'`) ===
      'expert_review',
    'scheduling never rewinds advanced workflow stages',
  );
  rejected(
    actor(owner) +
      `select private.update_inspection_schedule('${inspection}','${revision}','2026-10-22T10:00:00Z','2026-10-21T10:00:00Z');`,
    /완료 목표/,
    'reversed dates still rejected',
  );
  console.log(
    JSON.stringify({ passed: checks, localOnly: true, remoteWrites: false }),
  );
} finally {
  if (started)
    run('pg_ctl', ['-D', join(work, 'data'), '-m', 'fast', '-w', 'stop']);
  assert.match(basename(work), /^solar-workflow-pg-[A-Za-z0-9]+$/);
  rmSync(work, { recursive: true });
}
