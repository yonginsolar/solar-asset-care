import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(
  readFileSync(new URL('../lib/account-access.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { parseAccountState } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const base = {
  needs_initial_password: false,
  access_removed: false,
  organization_id: 'organization',
  super_admin_user_id: 'super-admin',
};
test('account readiness is parsed only from the server response', () => {
  assert.deepEqual(parseAccountState(base), {
    needsInitialPassword: false,
    accessRemoved: false,
    organizationId: 'organization',
    superAdminUserId: 'super-admin',
  });
  assert.equal(
    parseAccountState({ ...base, needs_initial_password: true })
      .needsInitialPassword,
    true,
  );
  assert.equal(
    parseAccountState({ ...base, access_removed: true }).accessRemoved,
    true,
  );
});
test('missing or malformed account state fails closed', () => {
  for (const value of [
    null,
    [],
    {},
    { ...base, needs_initial_password: 'false' },
    { ...base, super_admin_user_id: 1 },
    { ...base, organization_id: undefined },
  ]) {
    assert.throws(() => parseAccountState(value), /권한을 확인하지 못했습니다/);
  }
});
const app = readFileSync(
  new URL('../components/live/live-app.tsx', import.meta.url),
  'utf8',
);
test('initial password and removed access are checked before rendering the workspace', () => {
  const gate = app.slice(
    app.indexOf('function WorkspaceGate('),
    app.indexOf('function OrganizationOnboarding('),
  );
  assert.ok(
    gate.indexOf("rpc('get_my_account_state')") <
      gate.indexOf(".from('organization_members')"),
  );
  assert.ok(gate.includes('state.needsInitialPassword || state.accessRemoved'));
  assert.ok(
    gate.indexOf('accountState?.needsInitialPassword') <
      gate.indexOf('<AdminConsole'),
  );
  assert.ok(gate.includes('initialSetup'));
  assert.ok(gate.includes("notice?.tone === 'error'"));
});
test('administrator destructive actions have a confirmation and stale-state arguments', () => {
  const members = app.slice(app.indexOf('function MembersView('));
  for (const name of [
    '<AlertDialog',
    'p_expected_updated_at',
    'p_expected_target_updated_at',
    'p_expected_super_admin_user_id',
    'protectedSuperAdmin',
    'isSelf',
    'actionInFlight.current',
  ])
    assert.ok(members.includes(name), name);
  assert.ok(members.includes('내 계정은 일반 관리자로 바뀌며'));
  assert.ok(members.includes("member.status === 'active'"));
});
