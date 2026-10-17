/** Same-document history coordinates only. Never stores URLs, accounts or form data. */
export type HistoryPosition = { id: string; index: number; entry: string };
const key = 'solarScopeHistoryPosition';
const installed = Symbol.for('solarscope.history-position');
type Tracker = { sync: () => void };

/** Prefer browser-owned physical coordinates, including writes through a router's cached API. */
export function historyPosition(
  target: Window,
  state: unknown = target.history.state,
) {
  const navigation = (
    target as Window & {
      navigation?: { currentEntry?: { index: number; key: string } | null };
    }
  ).navigation;
  const entry = navigation?.currentEntry;
  if (
    entry &&
    Number.isSafeInteger(entry.index) &&
    entry.index >= 0 &&
    entry.key
  ) {
    return { id: 'navigation', index: entry.index, entry: entry.key };
  }
  return readHistoryPosition(state);
}

export function readHistoryPosition(state: unknown): HistoryPosition | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return null;
  const p = value as HistoryPosition;
  return typeof p.id === 'string' &&
    p.id.length > 0 &&
    p.id.length <= 64 &&
    Number.isSafeInteger(p.index) &&
    p.index >= 0 &&
    typeof p.entry === 'string' &&
    p.entry.length > 0 &&
    p.entry.length <= 64
    ? p
    : null;
}

export function trackHistoryPosition(target: Window): Tracker {
  const host = target as Window & { [installed]?: Tracker };
  if (host[installed]) return host[installed];
  if (historyPosition(target)?.id === 'navigation') {
    // Modern browsers already track physical entries; do not patch their state.
    host[installed] = { sync() {} };
    return host[installed];
  }
  const history = target.history;
  const push = history.pushState.bind(history);
  const replace = history.replaceState.bind(history);
  let current = readHistoryPosition(history.state) ?? {
    id: target.crypto.randomUUID(),
    index: 0,
    entry: target.crypto.randomUUID(),
  };
  // Framework history state is retained verbatim alongside our own metadata.
  // Do not change primitive/array state owned by an unrelated history user.
  const tagged = (state: unknown, position: HistoryPosition) =>
    state === null || (typeof state === 'object' && !Array.isArray(state))
      ? { ...state, [key]: position }
      : state;
  replace(tagged(history.state, current), '');
  history.pushState = (state, unused, url) => {
    const next = {
      id: current.id,
      index: current.index + 1,
      entry: target.crypto.randomUUID(),
    };
    push(tagged(state, next), unused, url);
    current = next;
  };
  history.replaceState = (state, unused, url) => {
    replace(tagged(state, current), unused, url);
  };
  target.addEventListener(
    'popstate',
    (event) => {
      const position = readHistoryPosition(event.state);
      if (position?.id === current.id) current = position;
    },
    { capture: true },
  );
  // One tracker lives for this document, including public pages between workspaces.
  // Keeping it installed also makes StrictMode/HMR setup idempotent.
  host[installed] = {
    sync() {
      // Router commits may use an original cached pushState and start with fresh
      // metadata. A replace preserves the existing tag; a new entry does not.
      const position = readHistoryPosition(history.state);
      if (position?.id === current.id) current = position;
      else {
        current = {
          id: current.id,
          index: current.index + 1,
          entry: target.crypto.randomUUID(),
        };
        replace(tagged(history.state, current), '');
      }
    },
  };
  return host[installed];
}
