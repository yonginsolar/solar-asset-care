import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scope = vm.createContext({ exports: {} });
vm.runInContext(
  ts.transpileModule(read('../lib/inspection-directory.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  scope,
);
const { filterInspections, inspectionStatuses } = scope.exports;
const plants = [
  { id: 'one', name: '햇빛 발전소' },
  { id: 'two', name: '바람 발전소' },
];
const rows = [
  {
    id: 'a',
    plant_id: 'one',
    inspection_code: 'INS-001',
    purpose: '정기 열화상 점검',
    status: 'requested',
  },
  {
    id: 'b',
    plant_id: 'two',
    inspection_code: 'INS-002',
    purpose: '긴급 확인',
    status: 'published',
  },
  {
    id: 'c',
    plant_id: 'gone',
    inspection_code: 'INS-003',
    purpose: null,
    status: 'closed',
  },
];
const ids = (query = '', status = 'all', source = rows) =>
  Array.from(filterInspections(source, plants, query, status), (row) => row.id);

test('inspection directory defaults preserve authorized rows, order and object identity', () => {
  assert.deepEqual(ids(), ['a', 'b', 'c']);
  assert.equal(filterInspections(rows, plants, '', 'all')[0], rows[0]);
  assert.deepEqual(ids('', 'all', []), []);
});
test('search matches plant, code and purpose with case, width and whitespace normalization', () => {
  for (const query of [
    '햇빛',
    'ins-001',
    'ＩＮＳ-００１',
    '  햇빛\t정기\n열화상  ',
    '햇빛'.normalize('NFD'),
  ])
    assert.deepEqual(ids(query), ['a']);
  assert.deepEqual(ids('긴급'), ['b']);
  assert.deepEqual(ids(' \t\n'), ['a', 'b', 'c']);
});
test('all search terms must match and status combines with search rather than replacing it', () => {
  assert.deepEqual(ids('햇빛 긴급'), []);
  assert.deepEqual(ids('발전소', 'published'), ['b']);
  assert.deepEqual(ids('바람', 'requested'), []);
  assert.deepEqual(ids('no results'), []);
});
test('each workflow status is filtered exactly, including terminal states', () => {
  const source = Array.from(inspectionStatuses, ([status], index) => ({
    ...rows[0],
    id: String(index),
    status,
  }));
  for (const [status] of inspectionStatuses)
    assert.equal(filterInspections(source, plants, '', status).length, 1);
  assert.equal(filterInspections(source, plants, '', 'not-a-status').length, 0);
});
test('missing plant and optional purpose never break code search or invent access', () => {
  assert.deepEqual(ids('ins-003'), ['c']);
  assert.deepEqual(ids('바람', 'all', rows.slice(0, 1)), []);
  assert.deepEqual(ids('', 'all', rows.slice(0, 1)), ['a']);
});
test('directory searches all supplied pages without truncation or mutation', () => {
  const source = Object.freeze(
    Array.from({ length: 1001 }, (_, index) =>
      Object.freeze({
        ...rows[0],
        id: String(index),
        inspection_code: `CASE-${index}`,
      }),
    ),
  );
  assert.deepEqual(ids('case-1000', 'all', source), ['1000']);
  assert.equal(source[1000].inspection_code, 'CASE-1000');
});

const app = read('../components/live/live-app.tsx');
const inspections = app.slice(
  app.indexOf('function InspectionsView('),
  app.indexOf('function FilesView('),
);
test('search is local presentation state, separate from protected operational drafts', () => {
  assert.match(
    inspections,
    /filterInspections\(\s*props.inspections,\s*props.plants,\s*search,\s*statusFilter/,
  );
  const draft = inspections.slice(
    inspections.indexOf('const draft ='),
    inspections.indexOf('const [baseline'),
  );
  assert.doesNotMatch(draft, /search|statusFilter/);
  assert.match(inspections, /filteredInspections.map\(/);
});
test('filters cannot unmount an open schedule draft or change while a save is pending', () => {
  assert.match(
    inspections,
    /const filtersLocked =\s*busy \|\|\s*rowBusy \|\|\s*Boolean\(editingScheduleId\)/,
  );
  assert.match(inspections, /<fieldset disabled=\{filtersLocked\}/);
  assert.match(inspections, /일정을 저장하거나 수정을 취소하면 검색 조건/);
  assert.match(inspections, /<InspectionScheduleEditor/);
});
test('reopening reasons and pending writes also prevent filtering a protected row out of view', () => {
  assert.match(inspections, /Object.values\(reopenPending\).some\(Boolean\)/);
  assert.match(
    inspections,
    /inspectionLocked\(inspection.status\) &&\s*Boolean\(reopenReasons\[inspection.id\]\?\.trim\(\)\)/,
  );
  assert.match(inspections, /reopening \|\|\s*hasReopenDraft/);
  assert.match(
    inspections,
    /reason=\{reopenReasons\[inspection.id\] \?\? ''\}/,
  );
  const reopen = app.slice(
    app.indexOf('function InspectionReopen('),
    app.indexOf('function InspectionsView('),
  );
  assert.match(reopen, /props.reason \?\? localReason/);
  assert.match(reopen, /props.onReasonChange \?\? setLocalReason/);
  assert.match(reopen, /setReason\(event.target.value\)/);
  assert.match(reopen, /props.onPending\?\.\(true\)/);
  assert.match(reopen, /props.onPending\?\.\(false\)/);
  assert.match(
    reopen,
    /useDraftProtection\(Boolean\(reason.trim\(\)\), busy\)/,
  );
});
test('empty search results differ from an empty account and counts use authorized rows only', () => {
  assert.match(
    inspections,
    /props.inspections.length > 0 && filteredInspections.length === 0/,
  );
  assert.match(inspections, /조건에 맞는 점검이 없습니다/);
  assert.match(
    inspections,
    /전체 \{props.inspections.length\}건 중[\s\S]*?\{filteredInspections.length\}건/,
  );
  assert.match(inspections, /setSearch\(''\);\s*setStatusFilter\('all'\)/);
});
test('mobile metrics stay two columns with visible labels, values and notes; desktop layout is retained', () => {
  assert.match(app, /grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4/);
  const metric = app.slice(
    app.indexOf('function MetricCard('),
    app.indexOf('function DashboardView('),
  );
  assert.match(metric, /p-3 shadow-sm sm:p-5/);
  assert.match(
    metric,
    /mt-2 block text-2xl tracking-tight sm:mt-5 sm:text-3xl/,
  );
  for (const field of ['label', 'value', 'note'])
    assert.match(metric, new RegExp(`\\{${field}\\}`));
});
