import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
function module(p, imports = {}, extra = {}) {
  const code = ts.transpileModule(read(p), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const scope = {
    exports: {},
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), name);
      return imports[name];
    },
    ...extra,
  };
  vm.runInNewContext(code, scope);
  return scope.exports;
}
const positions = module('../lib/history-position.ts');
const historyGuard = module('../lib/history-guard.ts');
const locations = module(
  '../lib/workspace-navigation.ts',
  {},
  { URLSearchParams },
);

class Browser extends EventTarget {
  constructor() {
    super();
    this.location = new URL('https://solar.example/');
    this.entries = [
      {
        state: { framework: 'original' },
        href: this.location.href,
        key: 'entry-0',
      },
    ];
    this.at = 0;
    this.queue = [];
    this.serial = 0;
    this.crypto = { randomUUID: () => `id-${++this.serial}` };
    const self = this;
    this.history = {
      get state() {
        return self.entries[self.at].state;
      },
      pushState(state, _, url) {
        self.entries.splice(self.at + 1);
        self.location = new URL(url ?? self.location.href, self.location);
        self.entries.push({
          state,
          href: self.location.href,
          key: `entry-${++self.serial}`,
        });
        self.at++;
      },
      replaceState(state, _, url) {
        self.location = new URL(url ?? self.location.href, self.location);
        self.entries[self.at] = {
          state,
          href: self.location.href,
          key: self.entries[self.at].key,
        };
      },
      go(delta) {
        self.queue.push(() => {
          const next = self.at + delta;
          if (next < 0 || next >= self.entries.length) return;
          if (self.navigation) {
            const navigation = new Event('navigate', { cancelable: true });
            navigation.navigationType = 'traverse';
            navigation.destination = {
              index: next,
              key: self.entries[next].key,
            };
            if (!self.navigation.dispatchEvent(navigation)) return;
          }
          self.at = next;
          self.location = new URL(self.entries[next].href);
          const event = new Event('popstate');
          event.state = self.history.state;
          self.dispatchEvent(event);
        });
      },
    };
  }
  flush() {
    let n = 0;
    while (this.queue.length) {
      assert.ok(n++ < 30, 'history must not loop');
      this.queue.shift()();
    }
  }
}

function hook(browser, state) {
  const slots = [],
    effects = [];
  let cursor = 0,
    busyNotices = 0;
  const cell = (initial) => {
    const n = cursor++;
    if (!slots[n]) slots[n] = { value: initial() };
    return slots[n];
  };
  const memo = (fn, deps) => {
    const slot = cell(() => ({ deps, value: fn() }));
    if (!deps.every((d, i) => Object.is(d, slot.value.deps[i])))
      slot.value = { deps, value: fn() };
    return slot.value.value;
  };
  const effect = (fn, deps) => {
    const slot = cell(() => ({ deps: null }));
    if (
      !slot.value.deps ||
      !deps.every((d, i) => Object.is(d, slot.value.deps[i]))
    ) {
      effects.push(() => {
        slot.value.cleanup?.();
        slot.value.cleanup = fn();
      });
      slot.value.deps = deps;
    }
  };
  const react = {
    useRef: (v) => cell(() => ({ current: v })).value,
    useState: (v) => {
      const slot = cell(() => (typeof v === 'function' ? v() : v));
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useMemo: memo,
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useSyncExternalStore: (_, get) => get(),
  };
  const { useWorkspaceLocation: runHook } = module(
    '../lib/use-workspace-location.ts',
    {
      react,
      './history-position': positions,
      './history-guard': historyGuard,
      './workspace-navigation': locations,
      './portal': { portalPath: () => '/admin' },
      './draft-navigation': { draftNavigationState: () => state.value },
    },
    { window: browser, crypto: browser.crypto },
  );
  return {
    render() {
      cursor = 0;
      const value = runHook('owner', () => busyNotices++);
      while (effects.length) effects.shift()();
      return value;
    },
    unmount() {
      for (const slot of slots) slot.value?.cleanup?.();
    },
    notices: () => busyNotices,
  };
}

function returnedWorkspace(native = false) {
  const b = new Browser();
  if (native)
    b.navigation = Object.defineProperty(new EventTarget(), 'currentEntry', {
      get: () => ({ index: b.at, key: b.entries[b.at].key }),
    });
  if (native)
    b.navigation.traverseTo = (key) => {
      b.history.go(b.entries.findIndex((e) => e.key === key) - b.at);
      return { finished: Promise.resolve() };
    };
  historyGuard.installHistoryGuard(b);
  positions.trackHistoryPosition(b);
  b.history.pushState({ framework: 'workspace' }, '', '/admin?view=members');
  const state = { value: 'clean' };
  const first = hook(b, state);
  first.render();
  b.history.pushState({ framework: 'home' }, '', '/');
  first.unmount();
  b.history.go(-1);
  b.flush();
  const h = hook(b, state);
  h.render();
  return { b, h, state };
}

test('history coordinates preserve framework state, replacement and entry identity across branch changes', () => {
  const b = new Browser();
  const tracker = positions.trackHistoryPosition(b);
  assert.equal(positions.trackHistoryPosition(b), tracker);
  assert.equal(b.history.state.framework, 'original');
  b.history.pushState({ framework: { scroll: [1, 2] } }, '', '/help');
  const first = positions.readHistoryPosition(b.history.state);
  b.history.replaceState({ framework: 'replacement' }, '', '/help?x=1');
  assert.equal(
    positions.readHistoryPosition(b.history.state).entry,
    first.entry,
  );
  b.history.go(-1);
  b.flush();
  b.history.pushState({ framework: 'new branch' }, '', '/policy');
  const branch = positions.readHistoryPosition(b.history.state);
  assert.equal(branch.index, first.index);
  assert.notEqual(branch.entry, first.entry);
  assert.deepEqual(Object.keys(branch).sort(), ['entry', 'id', 'index']);
  assert.equal(b.history.state.framework, 'new branch');
});

test('browser-owned entry coordinates handle cached router writes without patching modern History APIs', () => {
  const { b, h, state } = returnedWorkspace(true);
  assert.equal(positions.readHistoryPosition(b.history.state), null);
  assert.equal(positions.historyPosition(b).index, b.at);
  state.value = 'dirty';
  const href = b.location.href;
  b.history.go(1);
  b.flush();
  assert.equal(b.location.href, href);
  assert.ok(h.render().pending);
  h.render().confirmHistory();
  b.flush();
  assert.equal(b.location.pathname, '/');
});

test('legacy route commits tag cached native router pushes once before workspace bootstrap', () => {
  const b = new Browser();
  const nativePush = b.history.pushState.bind(b.history);
  const tracker = positions.trackHistoryPosition(b);
  nativePush({ framework: 'cached router commit' }, '', '/admin?view=members');
  assert.equal(positions.readHistoryPosition(b.history.state), null);
  const h = hook(b, { value: 'dirty' });
  h.render();
  assert.equal(positions.historyPosition(b).index, 1);
  tracker.sync();
  tracker.sync();
  assert.equal(
    positions.historyPosition(b).index,
    1,
    'route effect must not count the same commit twice',
  );
  assert.equal(b.history.state.framework, 'cached router commit');
  assert.match(read('../components/history-position.tsx'), /usePathname\(\)/);
});

test('early bootstrap is self-contained and idempotent before router startup', () => {
  const b = new Browser();
  vm.runInNewContext(historyGuard.historyGuardBootstrap, { window: b });
  let calls = 0;
  const bridge = historyGuard.installHistoryGuard(b);
  const release = bridge.subscribe({ pop: () => calls++, traverse() {} });
  b.dispatchEvent(new Event('popstate'));
  assert.equal(calls, 1);
  const releaseNew = bridge.subscribe({
    pop: () => (calls += 10),
    traverse() {},
  });
  release(); // An old cached route's cleanup cannot remove a newer editor's guard.
  b.dispatchEvent(new Event('popstate'));
  assert.equal(calls, 11);
  releaseNew();
  b.dispatchEvent(new Event('popstate'));
  assert.equal(calls, 11);
  assert.match(read('../app/layout.tsx'), /strategy="beforeInteractive"/);
});

test('native traversal is stopped before a router can restore a different cached screen', () => {
  const { b, h, state } = returnedWorkspace(true);
  let cachedRouteRestores = 0;
  b.navigation.addEventListener('navigate', () => cachedRouteRestores++);
  const source = b.location.href;
  state.value = 'dirty';
  b.history.go(1);
  b.flush();
  assert.equal(b.location.href, source);
  assert.equal(cachedRouteRestores, 0);
  h.render().cancelHistory();
  assert.equal(state.value, 'dirty');
  b.history.go(1);
  b.flush();
  const pending = h.render();
  pending.confirmHistory();
  pending.confirmHistory();
  b.flush();
  assert.equal(b.location.pathname, '/');
  assert.equal(cachedRouteRestores, 1);
});

test('native traversal keeps pending writes locked and rechecks a write begun in the dialog', () => {
  const { b, h, state } = returnedWorkspace(true);
  state.value = 'busy';
  b.history.go(1);
  b.flush();
  assert.equal(h.notices(), 1);
  assert.equal(h.render().pending, null);
  state.value = 'dirty';
  b.history.go(1);
  b.flush();
  state.value = 'busy';
  h.render().confirmHistory();
  b.flush();
  assert.equal(b.location.pathname, '/admin');
  assert.ok(h.render().pending);
  assert.equal(h.notices(), 2);
});

test('cross-route forward restores the actual URL and position before asking; cancel keeps the editor mounted', () => {
  const { b, h, state } = returnedWorkspace();
  state.value = 'dirty';
  let routerCalls = 0;
  b.addEventListener('popstate', () => routerCalls++);
  const source = b.location.href,
    at = b.at;
  b.history.go(1);
  b.flush();
  assert.equal(b.location.href, source);
  assert.equal(b.at, at);
  assert.equal(routerCalls, 0);
  assert.ok(h.render().pending);
  h.render().cancelHistory();
  assert.equal(h.render().pending, null);
  assert.equal(b.location.href, source);
  assert.equal(state.value, 'dirty');
});

test('cross-route discard confirms one traversal only and lets the router perform normal access checks', () => {
  const { b, h, state } = returnedWorkspace();
  state.value = 'dirty';
  let routerCalls = 0;
  b.addEventListener('popstate', () => routerCalls++);
  b.history.go(1);
  b.flush();
  const actions = h.render();
  actions.confirmHistory();
  actions.confirmHistory();
  assert.equal(b.queue.length, 1);
  b.flush();
  assert.equal(b.location.pathname, '/');
  assert.equal(routerCalls, 1);
  assert.equal(h.render().pending, null);
});

test('busy traversal and a write begun during confirmation stay on the original route without retrying writes', () => {
  const { b, h, state } = returnedWorkspace();
  const original = b.location.href;
  state.value = 'busy';
  b.history.go(1);
  b.flush();
  assert.equal(b.location.href, original);
  assert.equal(h.render().pending, null);
  assert.equal(h.notices(), 1);
  state.value = 'dirty';
  b.history.go(1);
  b.flush();
  assert.ok(h.render().pending);
  state.value = 'busy';
  h.render().confirmHistory();
  b.flush();
  assert.equal(b.location.href, original);
  assert.ok(h.render().pending);
  assert.equal(h.notices(), 2);
});

test('clean traversal and same-workspace dirty back/forward retain their existing behavior', () => {
  const { b, h, state } = returnedWorkspace();
  h.render().go({ view: 'customers', inspectionId: '' });
  const original = b.location.href;
  state.value = 'dirty';
  b.history.go(-1);
  b.flush();
  assert.equal(b.location.href, original);
  assert.ok(h.render().pending);
  h.render().confirmHistory();
  b.flush();
  assert.equal(h.render().view, 'members');
  assert.equal(
    positions.historyPosition(b).index,
    b.at,
    'early guard must keep legacy coordinates aligned after replacement',
  );
  state.value = 'clean';
  b.history.go(1);
  b.flush();
  assert.equal(h.render().view, 'customers');
});

function customerImport(initial, mode = 'dirty') {
  const source = read('../components/live/live-customers.tsx');
  const action = source.slice(
    source.indexOf('  function importApplicant('),
    source.indexOf('  const read = useCallback'),
  );
  const writes = [],
    queued = [],
    focused = [];
  const context = {
    ...initial,
    importChange: {
      request: (fn) => {
        if (mode === 'busy') return false;
        if (mode === 'dirty') queued.push(fn);
        else fn();
      },
    },
    setError: () => {},
    setMessage: () => {},
    window: { requestAnimationFrame: (fn) => fn() },
    nameRef: {
      current: {
        scrollIntoView: () => focused.push('scroll'),
        focus: () => focused.push('focus'),
      },
    },
  };
  for (const [setter, field] of [
    ['setKind', 'kind'],
    ['setName', 'name'],
    ['setBn', 'bn'],
    ['setRepresentative', 'representative'],
  ])
    context[setter] = (value) => {
      context[field] = value;
      writes.push([field, value]);
    };
  const js = ts.transpileModule(action, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new vm.Script(js + ';importApplicant;').runInNewContext(context);
  return { run, writes, queued, focused };
}
const businessDraft = {
  kind: 'corporation',
  name: '작성 중인 고객',
  bn: '1234567890',
  representative: '가상 대표',
};
const applicant = { kind: 'individual', name: '신청 고객' };

test('import waits for explicit discard, cancel preserves all four registration fields and performs no write', () => {
  const h = customerImport(businessDraft);
  h.run(applicant);
  assert.equal(h.queued.length, 1);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.focused, []);
  h.queued.pop(); // cancel
  assert.deepEqual(h.writes, []);
  h.run(applicant);
  h.queued.pop()();
  assert.deepEqual(h.writes, [
    ['kind', 'individual'],
    ['name', '신청 고객'],
    ['bn', ''],
    ['representative', ''],
  ]);
  assert.deepEqual(h.focused, ['scroll', 'focus']);
});

test('empty registration imports directly, identical data needs no confirmation, and busy import is blocked', () => {
  const empty = customerImport(
    { kind: 'individual', name: '', bn: '', representative: '' },
    'clean',
  );
  empty.run(applicant);
  assert.equal(empty.writes.length, 4);
  empty.run(applicant);
  assert.equal(
    empty.writes.length,
    4,
    'same values must not reapply or create another action',
  );
  const busy = customerImport(businessDraft, 'busy');
  busy.run(applicant);
  assert.deepEqual(busy.writes, []);
  assert.deepEqual(busy.queued, []);
});

test('finding focus moves once only after the guarded editor change actually commits', () => {
  const code = read('../components/live/live-findings.tsx');
  assert.match(
    code,
    /change\.request\(\(\) => \{\s*focusRequested\.current = true;\s*setEditing\(f\);/,
  );
  assert.match(
    code,
    /newFinding=\{\(\) =>\s*change\.request\(\(\) => \{\s*focusRequested\.current = true;\s*finishEditing\(\);/,
  );
  const effect = code
    .slice(
      code.indexOf(
        '  useEffect(() => {',
        code.indexOf('export function FindingsEditorView'),
      ),
    )
    .match(/useEffect\(\(\) => \{([\s\S]+?)\}, \[/)[1];
  const calls = [],
    requested = { current: false };
  const run = new vm.Script(`() => {${effect}}`).runInNewContext({
    focusRequested: requested,
    editorRef: {
      current: {
        scrollIntoView: () => calls.push('scroll'),
        focus: () => calls.push('focus'),
      },
    },
  });
  run();
  assert.deepEqual(calls, []);
  requested.current = true;
  run();
  run();
  assert.deepEqual(calls, ['scroll', 'focus']);
  assert.equal(requested.current, false);
  assert.match(code, /<section\s+ref=\{editorRef\}/);
});

test('customer search distinguishes a truly empty directory and resets filters without clearing registration fields', () => {
  const code = read('../components/live/live-customers.tsx');
  assert.match(
    code,
    /data\.customers\.length === 0\s*\? '등록된 고객이 없습니다\.'/,
  );
  assert.ok(
    code.includes('검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.'),
  );
  assert.match(
    code,
    /\(query \|\| search\) && \([\s\S]*?setQuery\(''\);\s*setSearch\(''\);/,
  );
});

test('report maintenance states reuse all seven existing Korean labels; unknown values never expose an internal code', () => {
  const { maintenanceStatusLabel: label, maintenanceStatuses: statuses } =
    module('../lib/maintenance-status.ts');
  for (const [value, expected] of statuses)
    assert.equal(label(value), expected);
  assert.equal(label('completed'), '완료');
  assert.equal(label('unexpected_state'), '상태 확인 필요');
  const report = read('../components/live/live-report.tsx');
  assert.ok(report.includes('maintenanceStatusLabel(item.status)'));
  assert.ok(!report.includes('<strong>{item.status}</strong>'));
  assert.ok(
    read('../components/live/live-app.tsx').includes(
      "import { maintenanceStatuses } from '@/lib/maintenance-status'",
    ),
  );
});
