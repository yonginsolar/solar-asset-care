/** One read subscription: cancel on unmount, settle timeouts, ignore late responses. No write retries. */
export function startClientRead<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  handlers: {
    success: (value: T) => void;
    error: (reason: unknown, timedOut: boolean) => void;
    settled: () => void;
  },
  timeoutMs = 20000,
) {
  const controller = new AbortController();
  let active = true;
  let finished = false;
  const finish = (apply: () => void) => {
    if (!active || finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      apply();
    } catch (reason) {
      handlers.error(reason, false);
    } finally {
      handlers.settled();
    }
  };
  const timer = setTimeout(() => {
    controller.abort();
    finish(() => handlers.error(new Error('Read timed out'), true));
  }, timeoutMs);
  // Also normalize a transport that throws before returning its promise.
  void Promise.resolve()
    .then(() => (active && !finished ? read(controller.signal) : undefined))
    .then(
      (value) => finish(() => handlers.success(value as T)),
      (reason: unknown) => finish(() => handlers.error(reason, false)),
    );
  return () => {
    active = false;
    clearTimeout(timer);
    controller.abort();
  };
}
