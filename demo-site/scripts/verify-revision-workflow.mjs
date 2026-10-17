// Opt-in companion to verify-live-workflow's retained synthetic UI fixture.
// Uses normal Auth/RLS only; caller resumes that fixture's cleanup afterward.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { acceptanceTarget } from './acceptance-target.mjs';

assert.equal(process.env.SOLAR_REVISION_RUN, '1');
assert.ok(process.stdin.isTTY);
const origin = acceptanceTarget(process.env);
execFileSync('stty', ['-echo'], { stdio: 'inherit' });
let config;
try {
  console.log('Ready for hidden revision test JSON on stdin.');
  config = JSON.parse(
    (
      await new Promise((resolve) => process.stdin.once('data', resolve))
    ).toString(),
  );
} finally {
  execFileSync('stty', ['echo'], { stdio: 'inherit' });
}
process.stdin.pause();
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('NEXT_PUBLIC_SUPABASE_'))
    .map((l) => {
      const n = l.indexOf('=');
      return [l.slice(0, n), l.slice(n + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
assert.equal(
  env.NEXT_PUBLIC_SUPABASE_URL,
  'https://vzgmryqglptxowbdewkf.supabase.co',
);
const required = async (promise) => {
  const r = await promise;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
let checks = 0;
const check = (value, name) => {
  assert.ok(value, name);
  checks++;
  console.log('PASS ' + name);
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function actor(email) {
  assert.match(email, /^acceptance-[0-9a-f-]+@example\.invalid$/);
  const api = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const login = await required(
    api.auth.signInWithPassword({ email, password: config.password }),
  );
  const org = await required(
    api
      .from('organizations')
      .select('id,slug')
      .eq('id', config.organizationId)
      .single(),
  );
  assert.match(org.slug, /^acceptance-/);
  return { api, token: login.session.access_token };
}
const owner = await actor(config.owner),
  expert = await actor(config.expert),
  client = await actor(config.client);
const one = (a, table, columns = '*') =>
  a.api.from(table).select(columns).eq('inspection_id', config.inspectionId);
const original = await required(
  one(owner, 'reports').eq('status', 'published').single(),
);
const file = (
  await required(one(expert, 'inspection_files').eq('kind', 'thermal_original'))
)[0];
assert.ok(file);
const pdf = (a, id, method = 'GET') =>
  fetch(`${origin}/api/reports/${id}/pdf`, {
    method,
    headers: { authorization: `Bearer ${a.token}` },
    cache: 'no-store',
  });
async function transition(a, id, status) {
  const r = await required(
    a.api.from('reports').select('action_revision').eq('id', id).single(),
  );
  const snapshot = await required(
    a.api
      .from('report_snapshots')
      .select('sha256')
      .eq('report_id', id)
      .maybeSingle(),
  );
  return a.api.rpc('transition_report_status', {
    p_report_id: id,
    p_next_status: status,
    p_expected_revision: r.action_revision,
    p_expected_snapshot_sha256: snapshot?.sha256 ?? null,
    p_reason: null,
  });
}

if (config.action === 'begin') {
  const existing = await required(
    one(expert, 'reports').eq('status', 'draft').maybeSingle(),
  );
  const draft =
    existing ||
    (await required(
      expert.api.rpc('create_report_draft', {
        p_inspection_id: config.inspectionId,
        p_title: '[격리 회귀] 추가 분석 개정본',
      }),
    ));
  const started = await required(
    expert.api.rpc('start_relative_analysis', {
      p_inspection_file_id: file.id,
      p_normalized_pixels: 64,
    }),
  );
  check(
    Boolean(started.id),
    'current revision starts with old issue still published',
  );
  console.log(
    JSON.stringify({ runId: started.id, fileId: file.id, draftId: draft.id }),
  );
} else if (config.action === 'cancel') {
  const r = await required(
    owner.api.rpc('resolve_relative_analysis', {
      p_analysis_run_id: config.runId,
      p_expected_status: 'running',
      p_action: 'cancel',
      p_reason: '격리 회귀: 다른 창의 상태 변경',
    }),
  );
  check(
    r.status === 'cancelled',
    'owner can resolve current revision using existing work permission',
  );
} else {
  assert.equal(config.action, 'finish');
  const draft = await required(
    one(expert, 'reports').eq('status', 'draft').single(),
  );
  const beforeDocument = await required(
    owner.api
      .from('report_documents')
      .select('*')
      .eq('report_id', original.id)
      .single(),
  );
  const oldResponse = await pdf(client, original.id);
  check(
    oldResponse.ok,
    'customer retains old publication while revision is being prepared',
  );
  const oldHash = hash(Buffer.from(await oldResponse.arrayBuffer()));
  const started = await required(
    expert.api.rpc('start_relative_analysis', {
      p_inspection_file_id: file.id,
      p_normalized_pixels: 64,
    }),
  );
  check(
    Boolean(
      (
        await client.api.rpc('complete_relative_analysis', {
          p_analysis_run_id: started.id,
          p_result_summary: {},
          p_regions: [],
        })
      ).error,
    ),
    'customer still cannot complete staff analysis',
  );
  const response = await fetch(origin + '/api/thermal/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${expert.token}`,
    },
    body: JSON.stringify({
      width: 8,
      height: 8,
      values: Array(64).fill(0.5),
      sensitivity: 72,
    }),
  });
  check(
    response.status === 200,
    'real relative-analysis endpoint accepts authenticated revision work',
  );
  const result = await response.json();
  const completed = await required(
    expert.api.rpc('complete_relative_analysis', {
      p_analysis_run_id: started.id,
      p_result_summary: {
        ...result.summary,
        disclaimer: result.disclaimer,
        quality: result.quality,
        analyzed_at: result.analyzedAt,
      },
      p_regions: result.regions.map((r) => ({
        kind: r.kind,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        area_percent: r.areaPercent,
        score: r.score,
      })),
    }),
  );
  check(
    completed.status === 'succeeded',
    'revision completion succeeds without withdrawing old publication',
  );
  const stillOld = await pdf(client, original.id);
  check(
    stillOld.ok && hash(Buffer.from(await stillOld.arrayBuffer())) === oldHash,
    'analysis preserves exact issued PDF bytes and access',
  );
  await required(transition(expert, draft.id, 'review'));
  check(
    true,
    'expert can request review after revision analysis and manual acknowledgment',
  );
  check(
    (await pdf(client, draft.id)).status === 404,
    'customer cannot read unissued revision PDF',
  );
  check(
    Boolean((await transition(expert, draft.id, 'approved')).error),
    'expert approval stays denied',
  );
  await required(transition(owner, draft.id, 'approved'));
  const prepared = await pdf(owner, draft.id, 'POST');
  check(
    prepared.ok && (await prepared.json()).archived === true,
    'revision PDF is archived through the normal server endpoint',
  );
  await required(transition(owner, draft.id, 'published'));
  const versions = await required(one(owner, 'reports', 'id,status'));
  check(
    versions.find((r) => r.id === draft.id)?.status === 'published' &&
      versions.find((r) => r.id === original.id)?.status === 'withdrawn',
    'new publication atomically supersedes old issue',
  );
  const document = await required(
    owner.api
      .from('report_documents')
      .select('*')
      .eq('report_id', original.id)
      .single(),
  );
  check(
    document.pdf_sha256 === beforeDocument.pdf_sha256 &&
      document.snapshot_sha256 === beforeDocument.snapshot_sha256,
    'superseding preserves old PDF and frozen snapshot identities',
  );
  const issued = await pdf(client, draft.id);
  check(
    issued.ok &&
      Buffer.from(await issued.arrayBuffer())
        .subarray(0, 5)
        .toString() === '%PDF-',
    'customer downloads actual new issue PDF',
  );
  check(
    (await pdf(client, original.id)).status === 404,
    'superseded public access is revoked without deleting old archive',
  );
  console.log(
    JSON.stringify({
      passed: checks,
      publishedReportId: draft.id,
      fixtureCleanupRequired: true,
    }),
  );
}
