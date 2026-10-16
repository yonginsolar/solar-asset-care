// Explicit, isolated Auth/RLS regression. No email is sent. Existing users are never changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (process.env.SOLAR_ADMIN_QA !== '1') throw new Error('Explicit SOLAR_ADMIN_QA=1 opt-in required.');
const project = 'vzgmryqglptxowbdewkf';
const url = `https://${project}.supabase.co`;
let keyResponse;
try {
  keyResponse = JSON.parse(execFileSync('npx', ['--yes', 'supabase@2.121.0', 'projects', 'api-keys', '--project-ref', project, '--reveal', '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 1048576, stdio: ['ignore', 'pipe', 'pipe'],
  }));
} catch { throw new Error('Existing scoped Supabase CLI authentication could not read this project’s API configuration.'); }
const keyRows = Array.isArray(keyResponse) ? keyResponse : keyResponse.keys;
const secret = keyRows?.find(k => k.api_key?.startsWith('sb_secret_'))?.api_key;
const publishable = keyRows?.find(k => k.api_key?.startsWith('sb_publishable_'))?.api_key;
assert.ok(secret && publishable, 'Modern server/publishable keys are required; no legacy fallback.');
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, authOptions);
const users = [], organizations = [], results = [];
function pass(label) { results.push(label); console.log(`PASS ${label}`); }
async function required(request) { const r = await request; if (r.error) throw new Error(r.error.message); return r.data; }
async function rejected(request, message, label) {
  const r = await request;
  assert.ok(r.error, label);
  assert.match(r.error.message, message, label);
  pass(label);
}
async function makeUser(role = 'owner') {
  const email = `admin-access-${randomUUID()}@example.invalid`;
  const password = `Qa-${randomUUID()}!9`;
  const d = await required(admin.auth.admin.createUser({ email, password, email_confirm: true }));
  const actor = { id: d.user.id, client: createClient(url, publishable, authOptions), role };
  users.push(actor);
  await required(actor.client.auth.signInWithPassword({ email, password }));
  return actor;
}
async function makeOrg(owner) {
  const org = await required(admin.from('organizations').insert({ name: '[삭제예정] 관리자 권한 회귀', slug: `admin-qa-${randomUUID()}`, is_primary_operator: false }).select().single());
  organizations.push(org.id);
  await required(admin.from('organization_members').insert({ organization_id: org.id, user_id: owner.id, role: 'owner', status: 'active' }));
  return org;
}
async function member(org, actor) { return required(admin.from('organization_members').select('*').eq('organization_id', org.id).eq('user_id', actor.id).single()); }
let failure;
try {
  const a = await makeUser(), b = await makeUser(), c = await makeUser(), expert = await makeUser('expert');
  const org = await makeOrg(a), otherOrg = await makeOrg(c);
  await required(admin.from('organization_members').insert([
    { organization_id: org.id, user_id: b.id, role: 'owner', status: 'active' },
    { organization_id: org.id, user_id: expert.id, role: 'expert', status: 'active' },
  ]));
  const aRow = await member(org, a), bRow = await member(org, b);
  const initialState = await required(a.client.rpc('get_my_account_state'));
  assert.equal(initialState.super_admin_user_id, a.id); pass('first active administrator gets the single protected assignment');
  const removeA = () => b.client.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: a.id, p_expected_updated_at: aRow.updated_at });
  await rejected(removeA(), /최고 관리자/, 'ordinary administrator cannot remove the super administrator');
  await rejected(b.client.rpc('admin_update_member', { p_organization_id: org.id, p_user_id: a.id, p_role: 'client', p_status: 'active' }), /최고 관리자/, 'ordinary administrator cannot demote the super administrator');
  await rejected(b.client.rpc('admin_update_member', { p_organization_id: org.id, p_user_id: a.id, p_role: 'owner', p_status: 'suspended' }), /최고 관리자/, 'ordinary administrator cannot suspend the super administrator');
  const transfer = (actor, target = b, version = bRow.updated_at, expected = a.id) => actor.client.rpc('transfer_super_admin', {
    p_organization_id: org.id, p_target_user_id: target.id,
    p_expected_super_admin_user_id: expected, p_expected_target_updated_at: version,
  });
  await rejected(transfer(b), /현재 최고 관리자/, 'ordinary administrator cannot transfer top-level authority');
  await rejected(transfer(expert), /현재 최고 관리자/, 'expert cannot transfer administrator authority');
  await rejected(transfer(a, c), /사용 중인 관리자/, 'cross-organization transfer is denied');
  await rejected(transfer(a, b, '2020-01-01T00:00:00Z'), /변경/, 'stale target revision is denied');
  await rejected(b.client.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: b.id, p_expected_updated_at: bRow.updated_at }), /본인/, 'self-removal is denied');
  await rejected(expert.client.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: b.id, p_expected_updated_at: bRow.updated_at }), /관리자만/, 'expert cannot delete an administrator');
  const plant = await required(a.client.from('plants').insert({ organization_id: org.id, name: '[가상] 권한 회귀 발전소', capacity_kw: 1 }).select().single());
  await required(transfer(a));
  assert.equal((await required(a.client.rpc('get_my_account_state'))).super_admin_user_id, b.id);
  assert.equal((await required(b.client.rpc('get_my_account_state'))).super_admin_user_id, b.id);
  pass('atomic transfer leaves both sessions seeing one new super administrator');
  await rejected(transfer(a), /현재 최고 관리자/, 'former super administrator cannot transfer again');
  const afterTransferA = await member(org, a);
  assert.equal(afterTransferA.role, 'owner'); assert.equal(afterTransferA.status, 'active');
  pass('former super administrator becomes an ordinary active administrator');
  await rejected(a.client.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: b.id, p_expected_updated_at: bRow.updated_at }), /최고 관리자/, 'new super administrator is immediately protected');
  await required(b.client.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: a.id, p_expected_updated_at: afterTransferA.updated_at }));
  assert.equal((await member(org, a)).status, 'removed'); pass('former super administrator can be removed after transfer');
  assert.equal((await required(a.client.rpc('get_my_account_state'))).access_removed, true); pass('existing removed-user session is gated immediately');
  assert.deepEqual(await required(a.client.from('plants').select('id').eq('id', plant.id)), []); pass('old access token cannot read organization data after removal');
  await rejected(a.client.rpc('register_requester'), /초대|역할|연결/, 'removed administrator cannot bypass revocation by self-registering');
  assert.equal((await required(admin.from('plants').select('id').eq('id', plant.id).single())).id, plant.id); pass('removing administrator preserves business records');
  const invitation = await required(admin.auth.admin.generateLink({ type: 'invite', email: `admin-invite-${randomUUID()}@example.invalid` }));
  const invited = { id: invitation.user.id, client: createClient(url, publishable, authOptions) };
  users.push(invited);
  await required(admin.from('organization_members').insert({ organization_id: org.id, user_id: invited.id, role: 'owner', status: 'invited' }));
  await required(invited.client.auth.verifyOtp({ token_hash: invitation.properties.hashed_token, type: 'invite' }));
  assert.equal((await member(org, invited)).status, 'invited'); pass('actual Auth invite verification does not activate an account without a password');
  assert.equal((await required(invited.client.rpc('get_my_account_state'))).needs_initial_password, true); pass('actual invited Auth session must create its initial password');
  await rejected(invited.client.rpc('admin_update_member', { p_organization_id: org.id, p_user_id: b.id, p_role: 'owner', p_status: 'suspended' }), /관리자만/, 'invitation token alone cannot call administrator APIs');
  assert.deepEqual(await required(invited.client.from('plants').select('id').eq('id', plant.id)), []); pass('invitation token alone cannot read organization data');
  await required(admin.from('organization_members').update({ status: 'active' }).eq('organization_id', org.id).eq('user_id', invited.id));
  assert.equal((await member(org, invited)).status, 'invited'); pass('privileged membership activation cannot skip initial-password requirement');
  await required(invited.client.auth.updateUser({ password: `Initial-${randomUUID()}!9` }));
  assert.equal((await member(org, invited)).status, 'active'); pass('actual Auth password creation activates the invited membership');
  assert.equal((await required(invited.client.rpc('get_my_account_state'))).needs_initial_password, false); pass('initial-password gate clears after actual password storage');
  assert.equal((await required(invited.client.from('plants').select('id').eq('id', plant.id))).length, 1); pass('initialized administrator can access authorized organization records');
  const anon = createClient(url, publishable, authOptions);
  await rejected(anon.rpc('get_my_account_state'), /permission|권한|로그인/i, 'anonymous account-state access is denied');
  await rejected(anon.rpc('admin_remove_member', { p_organization_id: org.id, p_user_id: b.id, p_expected_updated_at: bRow.updated_at }), /permission|권한/i, 'anonymous deletion is denied');
  await rejected(anon.rpc('transfer_super_admin', { p_organization_id: org.id, p_target_user_id: b.id, p_expected_super_admin_user_id: a.id, p_expected_target_updated_at: bRow.updated_at }), /permission|권한/i, 'anonymous transfer is denied');
} catch (error) { failure = error instanceof Error ? error.message : 'Unknown verification failure'; }
finally {
  const cleanupErrors = [];
  for (const actor of users) await actor.client.auth.signOut();
  for (const id of organizations) { const r = await admin.from('audit_events').delete().eq('organization_id', id); if (r.error) cleanupErrors.push(`synthetic audit cleanup failed: ${r.error.message}`); }
  for (const id of organizations.reverse()) { const r = await admin.from('organizations').delete().eq('id', id); if (r.error) { cleanupErrors.push('synthetic organization cleanup failed'); console.error(JSON.stringify({ syntheticOrganizationId: id, code: r.error.code, message: r.error.message })); } }
  for (const actor of users) { const r = await admin.auth.admin.deleteUser(actor.id); if (r.error) { cleanupErrors.push('synthetic Auth cleanup failed'); console.error(JSON.stringify({ syntheticUserId: actor.id, message: r.error.message })); } }
  if (cleanupErrors.length) failure = `${failure || ''} ${cleanupErrors.join('; ')}`.trim();
  console.log(JSON.stringify({ checks: results.length, passed: !failure, cleanup: cleanupErrors.length === 0, emailSent: false, existingUsersChanged: false }));
}
if (failure) { console.error(failure); process.exitCode = 1; }
