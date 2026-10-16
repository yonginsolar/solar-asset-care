import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
async function load(path) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
}
const { directoryMembers, directoryRoleCounts, memberRoleTabs } = await load(
  '../lib/member-directory.ts',
);
const { workspaceCollections } = await load('../lib/workspace-load-plan.ts');
const members = [
  { user_id: 'a', role: 'owner', status: 'active' },
  { user_id: 'b', role: 'owner', status: 'invited' },
  { user_id: 'c', role: 'expert', status: 'active' },
  { user_id: 'd', role: 'client', status: 'active' },
  { user_id: 'removed', role: 'owner', status: 'removed' },
];
const profiles = {
  a: { display_name: '민호', email: 'Minho@Example.test' },
  b: { display_name: '이은석', email: 'invite@example.test' },
  c: { display_name: '민호 전문가', email: 'expert@example.test' },
  d: { display_name: null, email: null },
};
test('role tabs separate all three roles and count pending but never removed accounts', () => {
  assert.deepEqual(
    memberRoleTabs.map((t) => t.role),
    ['owner', 'expert', 'client'],
  );
  assert.deepEqual(directoryRoleCounts(members), {
    owner: 2,
    expert: 1,
    client: 1,
  });
  assert.deepEqual(
    directoryMembers(members, profiles, 'owner', '').map((m) => m.user_id),
    ['a', 'b'],
  );
  assert.deepEqual(
    directoryMembers(members, profiles, 'client', '').map((m) => m.user_id),
    ['d'],
  );
});
test('search normalizes whitespace, email case and full-width characters inside the selected role', () => {
  assert.deepEqual(
    directoryMembers(
      members,
      profiles,
      'owner',
      '  민호  MINHO@ＥＸＡＭＰＬＥ.test ',
    ).map((m) => m.user_id),
    ['a'],
  );
  assert.deepEqual(directoryMembers(members, profiles, 'owner', 'expert'), []);
  assert.deepEqual(
    directoryMembers(members, profiles, 'expert', '민호').map((m) => m.user_id),
    ['c'],
  );
});
test('missing profiles and hostile search text are ordinary empty search results', () => {
  assert.deepEqual(
    directoryMembers(members, profiles, 'client', '<script>'),
    [],
  );
  assert.deepEqual(directoryMembers(members, {}, 'owner', '민호'), []);
  assert.equal(members[0].role, 'owner');
  assert.deepEqual(directoryRoleCounts([]), { owner: 0, expert: 0, client: 0 });
});
test('the dashboard does not wait for file, report, quote or membership collections', () => {
  assert.deepEqual(workspaceCollections('dashboard'), [
    'plants',
    'inspections',
    'findings',
    'maintenance_requests',
  ]);
  assert.deepEqual(workspaceCollections('members'), ['organization_members']);
  assert.deepEqual(workspaceCollections('account'), []);
  assert.deepEqual(workspaceCollections('unknown'), []);
});
test('each operational view retains its dependent collections', () => {
  const required = {
    files: ['plants', 'inspections', 'inspection_files', 'analysis_runs'],
    findings: ['inspections', 'inspection_files', 'findings'],
    'report-images': ['inspections', 'inspection_files'],
    plants: ['plants', 'organization_members'],
    inspections: ['plants', 'inspections', 'organization_members'],
    reports: ['inspections', 'reports'],
    maintenance: ['inspections', 'maintenance_requests'],
    partners: [
      'plant_requesters',
      'organization_members',
      'partner_private_details',
      'partner_quotes',
      'quote_requests',
      'maintenance_requests',
    ],
    assessments: ['plants', 'inspections'],
    recycling: ['plants'],
  };
  for (const [view, collections] of Object.entries(required))
    for (const collection of collections)
      assert.ok(
        workspaceCollections(view).includes(collection),
        `${view}: ${collection}`,
      );
});
const app = readFileSync(
  new URL('../components/live/live-app.tsx', import.meta.url),
  'utf8',
);
test('view reads keep server authorization, abort superseded requests and expose manual retry', () => {
  const consoleCode = app.slice(
    app.indexOf('function AdminConsole('),
    app.indexOf('type SharedProps'),
  );
  assert.ok(
    consoleCode.indexOf("'get_my_account_state'") <
      consoleCode.indexOf('const scoped'),
  );
  assert.ok(consoleCode.includes('needed.includes(collection)'));
  assert.ok(consoleCode.includes('request.abortSignal(controller.signal)'));
  assert.ok(consoleCode.includes('currentView.current === view'));
  assert.ok(consoleCode.includes('if (!current()) return;'));
  assert.ok(consoleCode.includes('20_000'));
  assert.ok(consoleCode.includes('loadedView !== view'));
  assert.ok(consoleCode.includes('다시 불러오기'));
});
test('directory search is local and destructive actions remain named, confirmed and protected', () => {
  const code = app.slice(app.indexOf('function MembersView('));
  for (const text of [
    'role="tablist"',
    'role="tab"',
    'role="tabpanel"',
    'aria-selected',
    '사용자 검색',
    '이름 또는 이메일 검색',
    'ArrowRight',
    'ArrowLeft',
    'protectedSuperAdmin',
    'isSelf',
    'p_expected_updated_at',
    '<AlertDialog',
  ])
    assert.ok(code.includes(text), text);
  assert.ok(code.includes('setMemberSearch(searchDraft.trim())'));
  assert.ok(code.includes('aria-label={`${profile?.display_name'));
});
