import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
async function load(p) {
  const js = ts.transpileModule(read(p), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
}
const { formDraftFingerprint: fingerprint } = await load(
  '../lib/form-draft.ts',
);
const {
  readWorkspaceLocation: location,
  workspaceHref,
  roleViews,
} = await load('../lib/workspace-navigation.ts');
const { auditLabels, auditActions } = await load('../lib/audit-display.ts');
test('form draft includes exact attachment identity, hidden/disabled values and original-value restoration', () => {
  const name = {
    tagName: 'INPUT',
    name: 'title',
    type: 'text',
    value: 'original',
  };
  const attach = { tagName: 'INPUT', name: 'file', type: 'file', files: [] };
  const f = { elements: [name, attach] };
  const baseline = fingerprint(f);
  name.value = 'changed';
  assert.notEqual(fingerprint(f), baseline);
  name.value = 'original';
  assert.equal(fingerprint(f), baseline);
  name.disabled = true;
  assert.equal(fingerprint(f), baseline);
  attach.files = [
    new File(['a'], 'same.png', { type: 'image/png', lastModified: 1 }),
  ];
  const selected = fingerprint(f);
  assert.notEqual(selected, baseline);
  assert.equal(fingerprint(f), selected);
  attach.files = [
    new File(['b'], 'same.png', { type: 'image/png', lastModified: 1 }),
  ];
  assert.notEqual(
    fingerprint(f),
    selected,
    'same filename/length/time is not proof of same File',
  );
  attach.files = [];
  assert.equal(fingerprint(f), baseline);
});
test('calculation and certificate registration protect dirty input and pending writes without protecting search filters', () => {
  for (const file of ['live-assessments.tsx', 'live-recycling.tsx']) {
    const code = read('../components/live/' + file);
    assert.match(code, /useFormDraftProtection\((?:busy|saving)\)/);
    assert.match(
      code,
      /<form\s+ref=\{draft.ref\}\s+onInput=\{draft.onInput\}\s+onChange=\{draft.onChange\}/,
    );
  }
  const cert = read('../components/live/live-recycling.tsx');
  assert.match(cert, /form.reset\(\);\s*draft.markSaved\(\)/);
  assert.match(cert, /<fieldset disabled=\{saving\}/);
  const hook = read('../lib/use-form-draft-protection.ts');
  assert.ok(hook.includes('formDraftFingerprint(ref.current)'));
  assert.ok(hook.includes('useDraftProtection(dirty, busy)'));
});
test('upload selection is readable on closed inspections but row analysis and new uploads remain locked', () => {
  const app = read('../components/live/live-app.tsx');
  const code = app.slice(
    app.indexOf('function FilesView('),
    app.indexOf('function ReportsView('),
  );
  assert.match(
    code,
    /const canEditSelected =\s*props.canWrite[\s\S]*?!inspectionLocked\(currentInspection\?\.status\)/,
  );
  assert.match(
    code,
    /const canAnalyze =[\s\S]*?i.id === file.inspection_id\s*&&\s*!inspectionLocked\(i.status\)/,
  );
  assert.match(
    code,
    /inspectionRows\(\s*props.files,\s*effectiveInspectionId,\s*showAll,?\s*\)/,
  );
  assert.ok(code.includes('visibleFiles.map('));
  assert.ok(
    code.includes('props.canWrite && currentInspection && !canEditSelected'),
  );
  assert.ok(!code.includes('props.files.map('));
  const selector = code.slice(
    code.indexOf('<Field label="연결할 점검">'),
    code.indexOf('<Field label="파일 종류">'),
  );
  assert.ok(!selector.includes('!props.canWrite'));
  assert.ok(selector.includes('queue.length > 0'));
  assert.match(
    code,
    /if \(busy \|\| analyzingFileId \|\| resolving \|\| !canAnalyze\(fileRow\)\)\s*return/,
  );
});
test('URL menu is limited to the current role and inspection is only an opaque syntactically valid UUID', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const [role, view] of [
    ['owner', 'audit'],
    ['expert', 'findings'],
    ['client', 'reports'],
  ]) {
    const v = { view, inspectionId: id };
    assert.deepEqual(
      location(workspaceHref('/client', v).split('?')[1], role),
      v,
    );
  }
  for (const role of ['client', 'expert', '__proto__', 'unknown']) {
    assert.equal(location('?view=members&role=owner', role).view, 'dashboard');
  }
  for (const query of [
    '?view=audit&view=plants',
    '?view=https://evil.invalid',
    '?view=__proto__',
  ])
    assert.equal(location(query, 'owner').view, 'dashboard');
  for (const query of [
    '?inspection=bad',
    '?inspection=' + id + '&inspection=' + id,
    '?inspection=<script>',
  ])
    assert.equal(location(query, 'owner').inspectionId, '');
  assert.ok(!roleViews.client.includes('files'));
  assert.ok(!roleViews.expert.includes('members'));
});
test('history guard restores URL/position before prompting and checks busy again before replay', () => {
  const hook = read('../lib/use-workspace-location.ts');
  assert.match(hook, /draftNavigationState\(window\)/);
  assert.ok(hook.includes('window.history.go(delta)'));
  assert.ok(hook.includes('restoring.current = after'));
  assert.ok(hook.includes('event.stopImmediatePropagation()'));
  assert.ok(hook.includes('{ capture: true }'));
  assert.ok(hook.includes("if (draftNavigationState(window) === 'busy')"));
  assert.ok(!hook.includes('localStorage'));
  assert.ok(!hook.includes('user_metadata'));
  const app = read('../components/live/live-app.tsx');
  assert.ok(app.includes('navigation.confirmHistory()'));
  assert.ok(app.includes('navigation.cancelHistory()'));
  assert.ok(
    app.includes('resolveInspectionSelection(selectedInspection, inspections)'),
  );
});
test('history renders Korean actions, authorized target/actor labels and safe missing-data fallbacks', () => {
  const row = {
    action: 'report.status_changed',
    entity_type: 'report',
    entity_id: 'r1',
    actor_user_id: 'u1',
  };
  assert.deepEqual(
    auditLabels(row, {
      actors: { u1: '가상 담당자' },
      targets: { 'report:r1': '보고서 · 가상 보고서' },
    }),
    {
      action: '보고서 상태 변경',
      target: '보고서 · 가상 보고서',
      actor: '가상 담당자',
    },
  );
  assert.equal(
    auditLabels({ ...row, actor_user_id: null }, { actors: {}, targets: {} })
      .actor,
    '시스템',
  );
  assert.match(
    auditLabels(row, { actors: {}, targets: {} }).target,
    /보고서 · 기록/,
  );
  assert.equal(
    auditLabels(
      { ...row, action: 'unknown.operation' },
      { actors: {}, targets: {} },
    ).action,
    '업무 변경',
  );
  for (const action of [
    'analysis.relative_completed',
    'inspection.schedule_updated',
    'report.pdf_archived',
    'organization.member_invited',
    'recycling.withdrawn',
  ])
    assert.ok(auditActions[action]);
  const ctx = read('../lib/audit-context.ts');
  assert.ok(!ctx.includes("select('*')"));
  assert.ok(!ctx.includes('service_admin_action'));
  assert.doesNotMatch(ctx, /select\([^)]*metadata/);
  assert.ok(ctx.includes("select('user_id,display_name')"));
  assert.ok(ctx.includes("eq('organization_id', org)"));
});
