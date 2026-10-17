type Handlers = {
  pop: (event: PopStateEvent) => void;
  traverse: (event: Event) => void;
};

/** Installed before router scripts; the live editor owns only its current handlers. */
export function installHistoryGuard(target: Window) {
  const key = Symbol.for('solarscope.history-guard');
  const host = target as Window & {
    [key: symbol]:
      | { subscribe: (handlers: Handlers) => () => void }
      | undefined;
  };
  if (host[key]) return host[key]!;
  let current: Handlers | null = null;
  target.addEventListener('popstate', (event) => current?.pop(event), {
    capture: true,
  });
  (
    target as Window & { navigation?: EventTarget }
  ).navigation?.addEventListener(
    'navigate',
    (event) => current?.traverse(event),
    { capture: true },
  );
  const bridge = {
    subscribe(handlers: Handlers) {
      current = handlers;
      return () => {
        if (current === handlers) current = null;
      };
    },
  };
  host[key] = bridge;
  return bridge;
}

// Fixed application code, not user content. No URLs, draft contents or account data.
export const historyGuardBootstrap = `(${installHistoryGuard.toString()})(window);`;
