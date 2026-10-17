import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
function moduleExports(path) {
  const scope = vm.createContext({ exports: {} });
  vm.runInContext(compile(read(path)), scope);
  return scope.exports;
}
const { manualInspectionStatuses } = moduleExports(
  '../lib/inspection-workflow.ts',
);
const { inspectionEmptyState, inspectionStatuses } = moduleExports(
  '../lib/inspection-directory.ts',
);

test('unissued inspections never offer a close action the server must reject', () => {
  for (const [status] of inspectionStatuses) {
    const available = manualInspectionStatuses(status, false, {
      hasPublishedReport: false,
      hasOpenReport: false,
    });
    assert.ok(!available.includes('closed'));
    for (const choice of available)
      assert.ok(inspectionStatuses.some(([key]) => key === choice));
  }
});
test('published work can close but cannot cancel or fabricate an earlier processing stage', () => {
  assert.deepEqual(
    Array.from(
      manualInspectionStatuses('published', false, {
        hasPublishedReport: true,
        hasOpenReport: false,
      }),
    ),
    ['closed'],
  );
  assert.deepEqual(
    Array.from(
      manualInspectionStatuses('published', true, {
        hasPublishedReport: true,
        hasOpenReport: false,
      }),
    ),
    [],
  );
});
test('active report review and terminal work keep all manual transitions locked', () => {
  for (const expert of [false, true]) {
    for (const status of [
      'requested',
      'expert_review',
      'approval',
      'published',
    ])
      assert.equal(
        manualInspectionStatuses(status, expert, {
          hasPublishedReport: true,
          hasOpenReport: true,
        }).length,
        0,
      );
    for (const status of ['closed', 'cancelled'])
      assert.equal(
        manualInspectionStatuses(status, expert, {
          hasPublishedReport: true,
          hasOpenReport: false,
        }).length,
        0,
      );
  }
});
test('normal manual work remains available without inventing nonexistent status keys or approval rights', () => {
  assert.deepEqual(Array.from(manualInspectionStatuses('requested', false)), [
    'requested',
    'scheduled',
    'expert_review',
    'cancelled',
  ]);
  assert.deepEqual(Array.from(manualInspectionStatuses('requested', true)), [
    'expert_review',
  ]);
  assert.equal(manualInspectionStatuses('unexpected', false).length, 0);
});
test('an unassigned expert receives assignment guidance instead of an unavailable creation instruction', () => {
  for (const hasPlants of [false, true]) {
    const state = inspectionEmptyState('expert', hasPlants);
    assert.match(state.title, /배정/);
    assert.match(state.copy, /관리자.*배정/);
    assert.doesNotMatch(state.copy, /등록하세요|의뢰해|접수 양식/);
  }
});
test('customer and administrator empty states respect whether registration is needed first', () => {
  for (const role of ['owner', 'client'])
    assert.match(inspectionEmptyState(role, false).copy, /먼저 발전소/);
  assert.match(inspectionEmptyState('client', true).copy, /새 점검 요청/);
  assert.match(inspectionEmptyState('owner', true).copy, /새 점검 접수/);
});

const app = read('../components/live/live-app.tsx');
const source = ts.createSourceFile(
  'live-app.tsx',
  app,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let createSource;
function find(node, inInspections = false) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'InspectionsView')
    inInspections = true;
  if (
    inInspections &&
    ts.isFunctionDeclaration(node) &&
    node.name?.text === 'create'
  )
    createSource = node.getText(source);
  ts.forEachChild(node, (child) => find(child, inInspections));
}
find(source);
assert.ok(createSource);
async function runCreate(requesterMode, fail = false, locked = false) {
  const events = [];
  const write = async () => {
    events.push('write');
    return { error: fail ? new Error('synthetic rejection') : null };
  };
  const context = vm.createContext({
    exports: {},
    crypto: { randomUUID },
    koreanDate: () => '2026-10-17',
    newInspectionCode: (day) =>
      `INS-${day.replaceAll('-', '')}-${randomUUID()}`,
    createLock: { current: locked },
    intakeRequestId: { current: 'test-request' },
    effectivePlantId: 'test-plant',
    code: 'TEST-CODE',
    purpose: 'test purpose',
    notes: 'test note',
    scheduledAt: '',
    dueAt: '',
    expertId: '',
    setBusy: (value) => events.push(['busy', value]),
    setSearch: (value) => events.push(['search', value]),
    setStatusFilter: (value) => events.push(['status', value]),
    setBaseline: () => events.push('baseline'),
    setCode: () => events.push('code'),
    setNotes: () => events.push('notes'),
    errorMessage: (error) => error.message,
    props: {
      requesterMode,
      organizationId: 'test-org',
      session: { user: { id: 'test-user' } },
      setNotice: (value) => events.push(['notice', value?.tone]),
      refresh: async () => events.push('refresh'),
      supabase: { rpc: write, from: () => ({ insert: write }) },
    },
  });
  vm.runInContext(compile(`exports.create = ${createSource}`), context);
  await context.exports.create({ preventDefault() {} });
  return events;
}
for (const requesterMode of [false, true]) {
  test(`${requesterMode ? 'customer' : 'admin'} confirmed creation clears list filters before refresh`, async () => {
    const events = await runCreate(requesterMode);
    assert.ok(
      events.indexOf('write') < events.findIndex((e) => e[0] === 'search'),
    );
    assert.deepEqual(
      events.find((e) => e[0] === 'search'),
      ['search', ''],
    );
    assert.deepEqual(
      events.find((e) => e[0] === 'status'),
      ['status', 'all'],
    );
    assert.ok(
      events.findIndex((e) => e[0] === 'status') < events.indexOf('refresh'),
    );
  });
  test(`${requesterMode ? 'customer' : 'admin'} failed creation retains search and operational input`, async () => {
    const events = await runCreate(requesterMode, true);
    assert.ok(!events.some((e) => ['search', 'status'].includes(e[0])));
    assert.ok(!events.includes('notes'));
    assert.ok(!events.includes('refresh'));
    assert.ok(events.some((e) => e[0] === 'notice' && e[1] === 'error'));
  });
}
test('duplicate submit remains blocked before either list or input state changes', async () => {
  assert.deepEqual(await runCreate(true, false, true), []);
});
