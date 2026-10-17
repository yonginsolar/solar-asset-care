export type DraftNavigationState = 'clean' | 'dirty' | 'busy';
type Detail = { busy: boolean };

export function draftNavigationState(
  target: EventTarget,
): DraftNavigationState {
  const detail: Detail = { busy: false };
  const clean = target.dispatchEvent(
    new CustomEvent<Detail>('solarscope:navigate', {
      cancelable: true,
      detail,
    }),
  );
  return detail.busy ? 'busy' : clean ? 'clean' : 'dirty';
}

/** A pending write is never a discardable draft. This does not retry the write. */
export function protectDraftNavigation(
  target: EventTarget,
  dirty: boolean,
  busy: boolean,
) {
  if (!dirty && !busy) return () => {};
  const unload = (event: Event) => {
    event.preventDefault();
    // Retain the legacy-browser data-loss guard recommended by MDN; do not remove it just for lint.
    // oxlint-disable-next-line typescript/no-deprecated -- https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
    (event as BeforeUnloadEvent).returnValue = '';
  };
  const navigate = (event: Event) => {
    event.preventDefault();
    const detail = (event as CustomEvent<Detail>).detail;
    if (busy && detail) detail.busy = true;
  };
  target.addEventListener('beforeunload', unload);
  target.addEventListener('solarscope:navigate', navigate);
  return () => {
    target.removeEventListener('beforeunload', unload);
    target.removeEventListener('solarscope:navigate', navigate);
  };
}
