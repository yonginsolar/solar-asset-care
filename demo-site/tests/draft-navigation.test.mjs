import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(
  new URL('../lib/draft-navigation.ts', import.meta.url),
  'utf8',
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { draftNavigationState, protectDraftNavigation } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);
test('reading and reverting to the saved value are clean, not false unsaved warnings', () => {
  const target = new EventTarget();
  const dispose = protectDraftNavigation(target, false, false);
  assert.equal(draftNavigationState(target), 'clean');
  dispose();
});
test('real draft blocks navigation/unload until cancel preservation or explicit discard', () => {
  const target = new EventTarget(),
    dispose = protectDraftNavigation(target, true, false);
  assert.equal(draftNavigationState(target), 'dirty');
  const unload = new Event('beforeunload', { cancelable: true });
  target.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  assert.equal(
    draftNavigationState(target),
    'dirty',
    'asking or cancelling must not clear protection',
  );
  dispose();
  assert.equal(draftNavigationState(target), 'clean');
});
test('pending writes cannot be discarded even when no unsaved field remains', () => {
  const target = new EventTarget(),
    dispose = protectDraftNavigation(target, false, true);
  assert.equal(draftNavigationState(target), 'busy');
  dispose();
  assert.equal(draftNavigationState(target), 'clean');
});
test('one busy editor takes precedence over other dirty editors; unmount removes only its own guard', () => {
  const target = new EventTarget(),
    dirty = protectDraftNavigation(target, true, false),
    busy = protectDraftNavigation(target, true, true);
  assert.equal(draftNavigationState(target), 'busy');
  busy();
  assert.equal(draftNavigationState(target), 'dirty');
  dirty();
  assert.equal(draftNavigationState(target), 'clean');
});
test('customer plant and inspection forms plus refresh/logout share draft protection', () => {
  const app = readFileSync(
    new URL('../components/live/live-app.tsx', import.meta.url),
    'utf8',
  );
  for (const [name, next, permission] of [
    ['PlantsView', 'ReadOnlyNote', 'canWrite'],
    ['InspectionsView', 'FilesView', 'canCreate'],
  ]) {
    const section = app.slice(
      app.indexOf('function ' + name + '('),
      app.indexOf('function ' + next + '('),
    );
    assert.match(
      section,
      new RegExp(
        'useDraftProtection\\(\\s*props\\.' +
          permission +
          ' && draft !== baseline,\\s*busy(?: \\|\\| rowBusy)?[,]?\\s*\\)',
      ),
    );
    assert.match(
      section,
      /const \[baseline, setBaseline\] = useState\(draft\)/,
    );
    assert.match(section, /<fieldset\s+disabled=\{\s*busy(?:\s*\|\|[^}]*)?\}/);
  }
  assert.match(app, /requestNavigation\('refresh'\)/);
  assert.match(app, /requestNavigation\('logout'\)/);
  assert.match(app, /state === 'busy'/);
});
