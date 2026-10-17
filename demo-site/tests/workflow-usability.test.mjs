import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (code) =>
  ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const scope = vm.createContext({ exports: {} });
vm.runInContext(compile(read('../lib/workflow-guidance.ts')), scope);
const { inspectionShortcut, workflowEmptyState } = scope.exports;
const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const rows = [
  { id, status: 'requested' },
  { id: other, status: 'published' },
];

test('shortcuts resolve only the current authorized inspection list and known roles', () => {
  for (const role of ['owner', 'expert', 'client'])
    assert.equal(inspectionShortcut(role, 'missing', rows, []), null);
  for (const role of ['admin', '__proto__', '', null])
    assert.equal(inspectionShortcut(role, id, rows, []), null);
  assert.equal(inspectionShortcut('owner', id, [], []), null);
});
test('staff open active work or preserved reports without widening their destination menus', () => {
  for (const role of ['owner', 'expert']) {
    assert.equal(inspectionShortcut(role, id, rows, []).view, 'files');
    assert.equal(inspectionShortcut(role, other, rows, []).view, 'reports');
    assert.equal(
      inspectionShortcut(role, id, [{ id, status: 'closed' }], []).view,
      'reports',
    );
    assert.equal(
      inspectionShortcut(role, id, [{ id, status: 'cancelled' }], []).view,
      'files',
    );
  }
});
test('customers open only their visible published report, otherwise their request progress', () => {
  for (const status of ['draft', 'review', 'approved', 'withdrawn'])
    assert.equal(
      inspectionShortcut('client', id, rows, [{ inspection_id: id, status }])
        .view,
      'inspections',
    );
  assert.equal(
    inspectionShortcut('client', id, rows, [
      { inspection_id: other, status: 'published' },
    ]).view,
    'inspections',
  );
  const next = inspectionShortcut('client', id, rows, [
    { inspection_id: id, status: 'published' },
  ]);
  assert.equal(next.view, 'reports');
  assert.equal(next.inspectionId, id);
});
test('read-only report guidance never asks customers to create or approve reports', () => {
  for (const hasInspections of [false, true])
    for (const hasOtherRows of [false, true]) {
      const state = workflowEmptyState('reports', {
        canWrite: false,
        hasInspections,
        hasOtherRows,
      });
      assert.doesNotMatch(state.copy, /초안|만들어|등록해|승인해/);
      assert.match(state.title, /발행/);
      assert.equal(state.action, hasOtherRows ? '전체 보고서 보기' : undefined);
    }
});
test('staff empty report guidance distinguishes missing inspections, locked work and an empty filter', () => {
  const options = {
    canWrite: true,
    hasInspections: false,
    hasOtherRows: false,
  };
  assert.match(workflowEmptyState('reports', options).copy, /점검을 접수/);
  assert.match(
    workflowEmptyState('reports', { ...options, hasInspections: true }).copy,
    /사진과 소견/,
  );
  assert.match(
    workflowEmptyState('reports', {
      ...options,
      hasInspections: true,
      locked: true,
    }).copy,
    /재개/,
  );
  assert.equal(
    workflowEmptyState('reports', { ...options, hasOtherRows: true }).action,
    '전체 보고서 보기',
  );
});
test('read-only maintenance guidance offers viewing, not a nonexistent creation action', () => {
  const options = {
    canWrite: false,
    hasInspections: true,
    hasOtherRows: false,
  };
  assert.match(
    workflowEmptyState('maintenance', options).copy,
    /진행 상황을 확인/,
  );
  assert.doesNotMatch(
    workflowEmptyState('maintenance', options).copy,
    /등록해 주세요/,
  );
  assert.equal(
    workflowEmptyState('maintenance', { ...options, hasOtherRows: true })
      .action,
    '전체 조치 보기',
  );
  assert.match(
    workflowEmptyState('maintenance', { ...options, canWrite: true }).copy,
    /등록해 주세요/,
  );
});

const app = read('../components/live/live-app.tsx');
const source = ts.createSourceFile(
  'live-app.tsx',
  app,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let perform;
function find(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === 'performNavigation'
  )
    perform = node.initializer.getText(source);
  ts.forEachChild(node, find);
}
find(source);
assert.ok(perform);
test('actual shortcut navigation moves view and inspection atomically and rechecks a removed target', () => {
  const calls = [];
  const context = vm.createContext({
    exports: {},
    role: 'client',
    inspections: rows,
    reports: [{ inspection_id: id, status: 'published' }],
    inspectionShortcut,
    navigation: {
      go: (target) => calls.push(['go', JSON.parse(JSON.stringify(target))]),
    },
    setNotice: (value) => calls.push(['notice', value]),
  });
  vm.runInContext(compile(`exports.perform=${perform}`), context);
  context.exports.perform({ openInspectionId: id });
  assert.deepEqual(calls[1], ['go', { inspectionId: id, view: 'reports' }]);
  assert.equal(calls.filter((c) => c[0] === 'go').length, 1);
  context.inspections = [];
  calls.length = 0;
  context.exports.perform({ openInspectionId: id });
  assert.equal(calls.filter((c) => c[0] === 'go').length, 0);
  assert.match(calls.at(-1)[1].text, /현재 목록/);
});
test('both shortcut surfaces use the existing dirty and busy navigation boundary', () => {
  assert.match(
    app,
    /const openInspection = \(id: string\) =>\s*requestNavigation\(\{ openInspectionId: id \}\)/,
  );
  assert.equal(
    (app.match(/onOpenInspection=\{openInspection\}/g) || []).length,
    2,
  );
  assert.equal(
    (app.match(/props\.onOpenInspection\(inspection\.id\)/g) || []).length,
    2,
  );
  assert.match(
    app,
    /state === 'busy'[\s\S]*?state === 'dirty'\) setPendingNavigation\(next\)/,
  );
  assert.match(
    app,
    /draftNavigationState\(window\) === 'busy'[\s\S]*?else performNavigation\(pendingNavigation\)/,
  );
  assert.doesNotMatch(
    app,
    /copy="완료할 점검을 선택하고 첫 초안을 만들어 보세요\."/,
  );
  assert.doesNotMatch(
    app,
    /copy="판정이 끝난 점검에서 필요한 현장 조치를 등록하세요\."/,
  );
});
test('schedule cancel uses the actual local dirty/pending guard and keeps exact-revision saving', () => {
  const schedule = read('../components/live/live-inspection-schedule.tsx');
  assert.match(
    schedule,
    /const close = useGuardedAction\(\(\) =>\s*busy \|\| lock\.current \? 'busy' : dirty \? 'dirty' : 'clean'/,
  );
  assert.match(schedule, /<DraftChangeDialog guard=\{close\}/);
  assert.match(schedule, /onClick=\{\(\) => close\.request\(onClose\)\}/);
  assert.doesNotMatch(schedule, /onClick=\{onClose\}/);
  assert.match(schedule, /p_expected_updated_at: original.updated_at/);
  assert.match(schedule, /onPending\(true\)/);
  assert.match(schedule, /onPending\(false\)/);
});
