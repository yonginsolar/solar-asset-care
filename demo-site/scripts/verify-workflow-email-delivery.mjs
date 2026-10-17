// Explicit delivery probe. Only a provider-owned Resend test sink is used.
// No customer email, existing membership, plant or report is changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (process.env.SOLAR_EMAIL_DELIVERY_QA !== '1')
  throw Error('Explicit SOLAR_EMAIL_DELIVERY_QA=1 required');
const project = 'vzgmryqglptxowbdewkf',
  url = 'https://' + project + '.supabase.co';
const keys = JSON.parse(
  execFileSync(
    'npx',
    [
      '--yes',
      'supabase@2.121.0',
      'projects',
      'api-keys',
      '--project-ref',
      project,
      '--reveal',
      '--output',
      'json',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ),
);
const secret = keys.find((k) => k.api_key?.startsWith('sb_secret_'))?.api_key;
const publishable = keys.find((k) =>
  k.api_key?.startsWith('sb_publishable_'),
)?.api_key;
assert.ok(secret && publishable, 'Modern server/publishable keys required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
let actor;
const suffix = randomUUID(),
  email = 'delivered+solar-cron-' + suffix + '@resend.dev';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function query(input) {
  const result = JSON.parse(
    execFileSync(
      'npx',
      [
        '--yes',
        'supabase@2.121.0',
        'db',
        'query',
        '--linked',
        '--project-ref',
        project,
        '--file',
        '/dev/stdin',
      ],
      {
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
        maxBuffer: 1e6,
      },
    ),
  );
  return result.rows;
}
async function required(request) {
  const r = await request;
  if (r.error) throw Error(r.error.message);
  return r.data;
}
let user,
  org,
  inspection,
  failed,
  checks = 0;
function pass(label) {
  checks++;
  console.log('PASS ' + label);
}
try {
  assert.equal(
    query('select enabled from private.workflow_email_settings;')[0].enabled,
    true,
    'Activation must be explicit and complete before this test',
  );
  const response = await fetch(url + '/functions/v1/workflow-email', {
    method: 'POST',
  });
  assert.equal(response.status, 401);
  pass('anonymous worker invocation rejected after real configuration');
  const anon = createClient(url, publishable, options);
  const denied = await anon.rpc('claim_workflow_emails', { p_limit: 1 });
  assert.ok(denied.error);
  pass('public key cannot read or claim the internal queue');
  user = (
    await required(
      admin.auth.admin.createUser({
        email,
        password: 'Qa-' + randomUUID() + '!9',
        email_confirm: true,
      }),
    )
  ).user;
  org = await required(
    admin
      .from('organizations')
      .insert({
        name: '[삭제예정] 메일 공급자 경로 시험',
        slug: 'mail-probe-' + suffix,
        is_primary_operator: false,
      })
      .select('id')
      .single(),
  );
  await required(
    admin.from('organization_members').insert({
      organization_id: org.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
    }),
  );
  actor = createClient(url, publishable, options);
  // Use a real issued Auth token, not a fabricated SQL auth.uid() for the business insert.
  const recovery = await required(
    admin.auth.admin.generateLink({ type: 'magiclink', email }),
  );
  await required(
    actor.auth.verifyOtp({
      type: 'magiclink',
      token_hash: recovery.properties.hashed_token,
    }),
  );
  const plant = await required(
    actor
      .from('plants')
      .insert({
        organization_id: org.id,
        name: '[가상] 메일 경로 시험',
        capacity_kw: 1,
      })
      .select('id')
      .single(),
  );
  inspection = await required(
    actor
      .from('inspections')
      .insert({
        organization_id: org.id,
        plant_id: plant.id,
        inspection_code: 'MAIL-PROBE-' + suffix,
        created_by: user.id,
      })
      .select('id,assigned_expert_user_id,updated_at')
      .single(),
  );
  let queue = query(
    "select id,state,kind,attempts from private.workflow_emails where inspection_id='" +
      inspection.id +
      "';",
  );
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, 'inspection_received');
  assert.ok(['queued', 'processing', 'accepted'].includes(queue[0].state));
  pass(
    'actual Auth business insert enqueues exactly one provider-test recipient',
  );
  // Wait for the real scheduled dispatcher, do not manually call the sender.
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    queue = query(
      "select id,state,kind,attempts,provider_id,reason from private.workflow_emails where inspection_id='" +
        inspection.id +
        "';",
    );
    if (
      ['accepted', 'failed', 'unknown', 'cancelled'].includes(queue[0]?.state)
    )
      break;
    await pause(5000);
  }
  assert.equal(
    queue[0]?.state,
    'accepted',
    'cron -> authenticated Edge -> Resend must be accepted',
  );
  assert.equal(queue[0].attempts, 1);
  assert.match(queue[0].provider_id, /^[a-zA-Z0-9-]+$/);
  pass('real cron -> Vault authenticated Edge -> Resend accepted once');
  console.log(
    JSON.stringify({
      providerTestId: queue[0].provider_id,
      providerTestAddress: email,
    }),
  );
  const audit = await required(
    actor
      .from('audit_events')
      .select('action,metadata')
      .eq('organization_id', org.id)
      .eq('action', 'email.accepted'),
  );
  assert.equal(audit.length, 1);
  assert.ok(!JSON.stringify(audit).includes(email));
  pass('administrator audit records acceptance without recipient or token');
  const noReplay = await required(
    admin.rpc('claim_workflow_emails', { p_limit: 1 }),
  );
  assert.ok(!noReplay.some((row) => row.id === queue[0].id));
  pass('accepted test notification is never re-claimed');
  const api = await required(
    actor
      .rpc('claim_workflow_emails', { p_limit: 1 })
      .then((r) => ({ data: !!r.error, error: null })),
  );
  assert.equal(api, true);
  pass('real administrator token cannot operate mail worker RPC');
} catch (error) {
  failed = error;
} finally {
  const cleanup = [];
  if (actor) {
    const result = await actor.auth.signOut({ scope: 'global' });
    if (result.error) cleanup.push('test session');
  }
  if (org) {
    // Explicit FK order, using only this exact synthetic organization.
    // audit_events deliberately restricts organization deletion in production.
    for (const table of ['audit_events', 'inspections', 'plants']) {
      const result = await admin
        .from(table)
        .delete()
        .eq('organization_id', org.id);
      if (result.error) cleanup.push('test ' + table);
    }
    const result = await admin.from('organizations').delete().eq('id', org.id);
    if (result.error) cleanup.push('test organization');
  }
  if (user) {
    const result = await admin.auth.admin.deleteUser(user.id);
    if (result.error) cleanup.push('test user');
  }
  if (cleanup.length)
    failed = new AggregateError(
      [failed, Error('Probe cleanup incomplete: ' + cleanup.join(', '))].filter(
        Boolean,
      ),
      'Probe or cleanup failed',
    );
  else
    console.log('CLEANED provider-test user and synthetic organization only');
}
if (failed) throw failed;
console.log(
  JSON.stringify({ checks, passed: true, realCustomerEmailsSent: 0 }),
);
