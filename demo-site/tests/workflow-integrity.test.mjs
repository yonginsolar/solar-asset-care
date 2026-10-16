import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const js = ts.transpileModule(read('../lib/inspection-workflow.ts'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { inspectionLocked, inspectionRows, manualInspectionStatuses } =
  await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
test('terminal inspections are read-only; report-derived stages cannot be manually fabricated', () => {
  assert.equal(inspectionLocked('closed'), true);
  assert.equal(inspectionLocked('cancelled'), true);
  assert.equal(inspectionLocked('published'), false);
  assert.deepEqual(manualInspectionStatuses('closed', false), []);
  assert.deepEqual(manualInspectionStatuses('published', false), ['closed']);
  assert.deepEqual(manualInspectionStatuses('published', true), []);
  assert.deepEqual(manualInspectionStatuses('approval', true), []);
  assert.ok(
    !manualInspectionStatuses('requested', false).includes('published'),
  );
  assert.ok(
    !manualInspectionStatuses('expert_review', true).includes('approval'),
  );
});
test('inspection lists default to current authorized selection; all-view is explicit', () => {
  const rows = [
    { inspection_id: 'a', name: 'one' },
    { inspection_id: 'b', name: 'two' },
  ];
  assert.deepEqual(inspectionRows(rows, 'a'), [rows[0]]);
  assert.deepEqual(inspectionRows(rows, 'b'), [rows[1]]);
  assert.deepEqual(inspectionRows(rows, 'missing'), []);
  assert.deepEqual(inspectionRows(rows, 'a', true), rows);
});
test('report, maintenance and quotation editors protect drafts and pending writes', () => {
  const app = read('../components/live/live-app.tsx');
  for (const [name, next] of [
    ['ReportsView', 'MaintenanceView'],
    ['MaintenanceView', 'PartnerQuotesView'],
  ]) {
    const section = app.slice(
      app.indexOf('function ' + name),
      app.indexOf('function ' + next),
    );
    assert.ok(section.includes('useDraftProtection('));
    assert.ok(section.includes('useRef(false)'));
  }
  assert.ok(app.includes('useSectionDraftProtection(anyBusy)'));
  assert.ok(app.includes('drafts.markSaved(element)'));
  assert.ok(app.includes('key={`reopen-${currentInspection.id}`}'));
  assert.ok(app.includes("parseKoreanInput(quoteDueAt, '회신 마감')"));
  assert.ok(!app.includes('updates.completed_at = new Date()'));
});
test('customer quotation eligibility is server supplied and does not grant every business contact selection rights', () => {
  const app = read('../components/live/live-app.tsx');
  assert.ok(app.includes("rpc('get_quote_requesters'"));
  assert.ok(app.includes('props.quoteRequesters.filter('));
  assert.ok(app.includes('견적 선택 담당자'));
  assert.ok(app.includes("rpc('select_partner_quote'"));
});
