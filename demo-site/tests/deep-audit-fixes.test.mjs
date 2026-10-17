import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const compile = (p, module = ts.ModuleKind.ESNext) =>
  ts.transpileModule(read(p), {
    compilerOptions: { module, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const { preserveCertificateDrafts } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compile('../lib/recycling-certificate.ts')).toString('base64')
);
test('internal discard confirmation rechecks current busy state and cancel never executes a pending action', () => {
  const changes = [];
  const scope = vm.createContext({
    exports: {},
    require: (name) => {
      if (name === 'react')
        return {
          useRef: (v) => ({ current: v }),
          useState: (v) => [v, (next) => changes.push(next)],
        };
      if (name === './draft-navigation')
        return {
          draftNavigationState: () => {
            throw Error('Explicit scope required in this test');
          },
        };
      throw Error(name);
    },
  });
  vm.runInContext(
    compile('../lib/use-guarded-action.ts', ts.ModuleKind.CommonJS),
    scope,
  );
  let state = 'dirty',
    runs = 0;
  const guard = scope.exports.useGuardedAction(() => state);
  assert.equal(
    guard.request(() => runs++),
    false,
  );
  assert.equal(runs, 0);
  guard.cancel();
  guard.confirm();
  assert.equal(runs, 0);
  guard.request(() => runs++);
  state = 'busy';
  guard.confirm();
  assert.equal(runs, 0);
  state = 'dirty';
  guard.confirm();
  assert.equal(runs, 1);
  state = 'busy';
  assert.equal(
    guard.request(() => runs++),
    false,
  );
  assert.equal(runs, 1);
  state = 'clean';
  assert.equal(
    guard.request(() => runs++),
    true,
  );
  assert.equal(runs, 2);
});
test('finding selection and new finding requests are guarded and cannot replace an in-flight editor', () => {
  const code = read('../components/live/live-findings.tsx');
  assert.ok(code.includes('change.request(() => setEditing(f))'));
  assert.ok(code.includes('newFinding={() => change.request(finishEditing)}'));
  assert.ok(code.includes('disabled={!props.canWrite || editorBusy}'));
  assert.ok(code.includes('props.onPending(true)'));
  assert.ok(code.includes('props.onPending(false)'));
  assert.ok(code.includes('editing?.inspection_id === id ? editing : null'));
});
test('inspection/assignment/maintenance updates all compare the exact revision and require a changed row', () => {
  const app = read('../components/live/live-app.tsx');
  for (const [start, end, expected] of [
    [
      'async function updateStatus(inspection:',
      'async function assignExpert(',
      'inspection',
    ],
    ['async function assignExpert(', 'const plantName =', 'inspection'],
    ['async function updateStatus(item:', 'const inspectionLabel =', 'item'],
  ]) {
    const from = app.indexOf(start);
    assert.ok(from > 0);
    const code = app.slice(from, app.indexOf(end, from));
    assert.ok(code.includes(`.eq('updated_at', ${expected}.updated_at)`));
    assert.ok(code.includes(".eq('organization_id', props.organizationId)"));
    assert.ok(code.includes(".select('id')"));
    assert.ok(code.includes('.maybeSingle()'));
    assert.match(code, /if \(!data\)/);
    assert.match(code, /catch \(error\)/);
  }
});
test('workspace home uses the existing pending/busy navigation guard while modified clicks keep the current tab', () => {
  const app = read('../components/live/live-app.tsx');
  assert.ok(app.includes("<Brand onHome={() => requestNavigation('home')} />"));
  assert.ok(app.includes("else if (next === 'home') router.push('/')"));
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])
    assert.ok(app.includes('!event.' + key));
});
test('photo selection only discards caption/masks after confirmation, and never copies masks to a different source', () => {
  const code = read('../components/live/live-report-images.tsx');
  assert.ok(code.includes('sourceChange.request(() => selectSource(next))'));
  assert.match(code, /busy\s*\? 'busy'\s*:\s*caption \|\| masks.length/);
  assert.match(
    code,
    /function selectSource[\s\S]*?setMasks\(\[\]\)[\s\S]*?setCaption\(''\)/,
  );
});
test('certificate search does not mark an operational draft; card edits, filters, reload and pages do', () => {
  const code = read('../components/live/live-recycling.tsx');
  assert.ok(code.includes('ref={correctionRef}'));
  assert.match(code, /ref: correctionRef, \.\.\.correction/);
  assert.ok(code.includes('correction.getState()'));
  assert.ok(
    code.includes('useDraftProtection(Boolean(reason || confirmed), writing)'),
  );
  assert.ok(code.includes("states.includes('busy')"));
  assert.ok(code.includes('changeList(() => void refresh())'));
  assert.ok(code.includes('changeList(() => setPage(page - 1))'));
  assert.ok(code.includes('changeList(() => setPage(page + 1))'));
  assert.ok(code.includes('setPlantFilter(next)'));
  assert.ok(code.includes('setSearch(next)'));
  assert.ok(!code.includes('loading ? ('));
  assert.ok(!code.includes('setRows([])'));
  assert.ok(!code.includes('useDraftProtection(Boolean(query)'));
});
test('saving one certificate preserves exact unrelated draft rows/revisions even if page membership changed', () => {
  const a = { id: 'a', revision: 1 },
    b = { id: 'b', revision: 3 },
    c = { id: 'c', revision: 1 };
  const incoming = [{ id: 'a', revision: 2 }, c];
  const result = preserveCertificateDrafts(
    [a, b],
    incoming,
    new Set(['a', 'b']),
    'a',
  );
  assert.equal(result[0], incoming[0]);
  assert.equal(result[1], c);
  assert.equal(result[2], b);
  assert.equal(
    preserveCertificateDrafts(
      [b],
      [{ id: 'b', revision: 4 }],
      new Set(['b']),
    )[0],
    b,
  );
  assert.deepEqual(
    preserveCertificateDrafts([a, b], incoming, new Set()),
    incoming,
  );
});
