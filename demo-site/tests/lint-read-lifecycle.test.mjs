import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = (path) =>
  ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function readHarness() {
  const timers = new Map();
  let id = 0;
  const scope = vm.createContext({
    exports: {},
    AbortController,
    setTimeout: (callback) => {
      timers.set(++id, callback);
      return id;
    },
    clearTimeout: (key) => timers.delete(key),
  });
  vm.runInContext(compile('../lib/client-read.ts'), scope);
  const calls = [];
  return {
    timers,
    calls,
    start: (read, extra = {}) =>
      scope.exports.startClientRead(read, {
        success: (value) => calls.push(['success', value]),
        error: (error, timedOut) =>
          calls.push(['error', error.message, timedOut]),
        settled: () => calls.push(['settled']),
        ...extra,
      }),
  };
}
test('read success settles once, clears its timeout and does not run synchronously during setup', async () => {
  const h = readHarness();
  h.start(() => Promise.resolve('current'));
  assert.equal(h.calls.length, 0);
  await tick();
  assert.deepEqual(h.calls, [['success', 'current'], ['settled']]);
  assert.equal(h.timers.size, 0);
});
test('unmount aborts the read and ignores a transport that resolves late', async () => {
  const h = readHarness();
  let resolve, signal;
  const cancel = h.start((value) => {
    signal = value;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await tick();
  cancel();
  assert.equal(signal.aborted, true);
  resolve('previous account');
  await tick();
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers.size, 0);
});
test('cleanup before the microtask prevents the read from starting at all', async () => {
  const h = readHarness();
  let started = 0;
  h.start(() => {
    started++;
    return Promise.resolve('late');
  })();
  await tick();
  assert.equal(started, 0);
  assert.deepEqual(h.calls, []);
});
test('timeout settles a transport that ignores abort; its later result cannot overwrite retry data', async () => {
  const h = readHarness();
  let resolve, signal;
  h.start((value) => {
    signal = value;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await tick();
  [...h.timers.values()][0]();
  assert.equal(signal.aborted, true);
  assert.deepEqual(h.calls, [['error', 'Read timed out', true], ['settled']]);
  resolve('too late');
  await tick();
  assert.equal(h.calls.length, 2);
});
test('synchronous and asynchronous transport failures become one controlled read error', async () => {
  for (const read of [
    () => {
      throw Error('sync transport');
    },
    () => Promise.reject(Error('async transport')),
  ]) {
    const h = readHarness();
    h.start(read);
    await tick();
    assert.equal(h.calls[0][0], 'error');
    assert.equal(h.calls[0][2], false);
    assert.equal(h.calls[1][0], 'settled');
    assert.equal(h.calls.length, 2);
    assert.equal(h.timers.size, 0);
  }
});
test('a response-processing error also settles without an unhandled rejection', async () => {
  const h = readHarness();
  h.start(() => Promise.resolve('bad response'), {
    success: () => {
      throw Error('bad shape');
    },
  });
  await tick();
  assert.deepEqual(h.calls, [['error', 'bad shape', false], ['settled']]);
});

const workspace = vm.createContext({ exports: {}, URLSearchParams });
vm.runInContext(compile('../lib/workspace-navigation.ts'), workspace);
test('history store has a stable SSR snapshot and notifies only real client changes', () => {
  const store = workspace.exports.createWorkspaceLocationStore('owner');
  const initial = store.getServerSnapshot();
  assert.equal(initial.ready, false);
  assert.equal(store.getSnapshot(), initial);
  let changed = 0;
  const dispose = store.subscribe(() => changed++);
  store.update({ view: 'plants', inspectionId: '' });
  const current = store.getSnapshot();
  assert.equal(current.ready, true);
  assert.equal(current.view, 'plants');
  store.update({ view: 'plants', inspectionId: '' });
  assert.equal(store.getSnapshot(), current);
  assert.equal(changed, 1);
  assert.equal(store.getServerSnapshot(), initial);
  dispose();
  store.update({ view: 'reports', inspectionId: '' });
  assert.equal(changed, 1);
});
test('history store keeps role allowlists, validates identifiers and does not share role state', () => {
  const client = workspace.exports.createWorkspaceLocationStore('client');
  const expert = workspace.exports.createWorkspaceLocationStore('expert');
  client.update({ view: 'members', inspectionId: 'not-an-id' });
  assert.equal(client.getSnapshot().view, 'dashboard');
  assert.equal(client.getSnapshot().inspectionId, '');
  expert.update({
    view: 'findings',
    inspectionId: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(expert.getSnapshot().view, 'findings');
  assert.equal(client.getSnapshot().view, 'dashboard');
  assert.deepEqual(Object.keys(expert.getSnapshot()).sort(), [
    'inspectionId',
    'ready',
    'view',
  ]);
});
test('guard confirmation uses the latest committed callback and never writes refs during render', () => {
  const refs = [],
    states = [];
  let cursor = 0,
    rendering = false;
  const scope = vm.createContext({
    exports: {},
    require: (name) => {
      if (name === 'react')
        return {
          useRef: (value) => {
            const key = cursor++;
            refs[key] ??= { value };
            return {
              get current() {
                assert.equal(rendering, false);
                return refs[key].value;
              },
              set current(value) {
                assert.equal(rendering, false);
                refs[key].value = value;
              },
            };
          },
          useState: (value) => {
            const key = cursor++;
            states[key] ??= value;
            return [
              states[key],
              (next) => {
                states[key] = next;
              },
            ];
          },
        };
      if (name === './draft-navigation')
        return { draftNavigationState: () => 'clean' };
      throw Error(name);
    },
  });
  vm.runInContext(compile('../lib/use-guarded-action.ts'), scope);
  const render = (state) => {
    cursor = 0;
    rendering = true;
    const value = scope.exports.useGuardedAction(() => state);
    rendering = false;
    return value;
  };
  let saved = 0;
  render('dirty').request(() => saved++);
  render('busy').confirm();
  assert.equal(saved, 0);
  render('dirty').confirm();
  assert.equal(saved, 1);
});
test('browser-close compatibility is one documented exception, not a global rule disable', () => {
  const source = read('../lib/draft-navigation.ts');
  assert.ok(source.includes('event.preventDefault()'));
  assert.ok(source.includes("(event as BeforeUnloadEvent).returnValue = ''"));
  assert.equal((source.match(/oxlint-disable-next-line/g) || []).length, 1);
  assert.ok(
    source.includes(
      'developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event',
    ),
  );
});
