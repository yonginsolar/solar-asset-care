'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { draftNavigationState } from './draft-navigation';
import { portalPath } from './portal';
import { installHistoryGuard } from './history-guard';
import {
  historyPosition,
  trackHistoryPosition,
  type HistoryPosition,
} from './history-position';
import {
  readWorkspaceLocation,
  createWorkspaceLocationStore,
  workspaceHref,
  type WorkspaceLocation,
} from './workspace-navigation';

type Marker = { id: string; role: string; index: number };
type HistoryRequest = { delta: number; identity: string };
type TraversalEvent = Event & {
  navigationType: string;
  destination: { index: number; key: string };
};
const markerKey = 'solarScopeWorkspace';

/** URL contains menu and opaque inspection id only: never a role grant, draft, File or token. */
export function useWorkspaceLocation(role: string, onBusy: () => void) {
  const store = useMemo(() => createWorkspaceLocationStore(role), [role]);
  const location = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [pending, setPending] = useState<HistoryRequest | null>(null);
  const current = useRef<WorkspaceLocation>(location);
  const marker = useRef<Marker>({ id: '', role, index: 0 });
  const position = useRef<HistoryPosition | null>(null);
  const restoring = useRef<(() => void) | null>(null);
  const bypass = useRef<string | null>(null);
  const busyCallback = useRef(onBusy);
  useLayoutEffect(() => {
    busyCallback.current = onBusy;
  }, [onBusy]);
  const apply = useCallback(
    (next: WorkspaceLocation) => {
      current.current = next;
      store.update(next);
    },
    [store],
  );
  const replace = useCallback(
    (next: WorkspaceLocation) => {
      window.history.replaceState(
        { ...window.history.state, [markerKey]: marker.current },
        '',
        workspaceHref(portalPath(role), next),
      );
    },
    [role],
  );
  useEffect(() => {
    trackHistoryPosition(window).sync();
    position.current = historyPosition(window);
    const old = window.history.state?.[markerKey] as Marker | undefined;
    marker.current =
      old?.role === role &&
      typeof old.id === 'string' &&
      Number.isSafeInteger(old.index)
        ? old
        : { id: crypto.randomUUID(), role, index: 0 };
    const initial = readWorkspaceLocation(window.location.search, role);
    apply(initial);
    replace(initial);
    const pop = (event: PopStateEvent) => {
      const target = event.state?.[markerKey] as Marker | undefined;
      const ownWorkspace = Boolean(
        target &&
        target.id === marker.current.id &&
        target.role === role &&
        Number.isSafeInteger(target.index) &&
        window.location.pathname === portalPath(role),
      );
      const destination = historyPosition(window, event.state);
      // The early guard can run before the legacy ledger's pop listener.
      // Synchronize its valid destination before any guarded replaceState.
      if (destination && destination.id !== 'navigation')
        trackHistoryPosition(window).sync();
      const indexed = Boolean(
        position.current && destination?.id === position.current.id,
      );
      if (!indexed && !ownWorkspace) return;
      const delta = indexed
        ? position.current!.index - destination!.index
        : marker.current.index - target!.index;
      const identity = indexed
        ? destination!.entry
        : `workspace:${target!.index}`;
      if (restoring.current) {
        event.stopImmediatePropagation();
        if (delta) {
          window.history.go(delta);
          return;
        }
        const after = restoring.current;
        restoring.current = null;
        after();
        return;
      }
      const next = readWorkspaceLocation(window.location.search, role);
      const state = draftNavigationState(window);
      if (bypass.current === identity || state === 'clean') {
        bypass.current = null;
        position.current = destination;
        // Public/other-role pages still go through the framework and normal Auth gates.
        if (!ownWorkspace) return;
        event.stopImmediatePropagation();
        marker.current = target!;
        apply(next);
        replace(next);
        return;
      }
      // Stop the router before it can unmount an editor, even when leaving this portal.
      event.stopImmediatePropagation();
      const after = () => {
        if (state === 'busy') busyCallback.current();
        else setPending({ delta: -delta, identity });
      };
      if (delta) {
        // Restore the actual history position before asking: cancel keeps the same draft and URL.
        restoring.current = after;
        window.history.go(delta);
      } else {
        replace(current.current);
        after();
      }
    };
    const traverse = (event: Event) => {
      const e = event as TraversalEvent;
      // Some routers restore cached routes before popstate. Cancel the browser
      // traversal before that commit, not after the editor has been unmounted.
      if (
        e.navigationType !== 'traverse' ||
        !e.cancelable ||
        restoring.current ||
        position.current?.id !== 'navigation' ||
        !Number.isSafeInteger(e.destination.index) ||
        e.destination.index < 0 ||
        !e.destination.key ||
        bypass.current === e.destination.key
      )
        return;
      const state = draftNavigationState(window);
      if (state === 'clean') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (state === 'busy') busyCallback.current();
      else
        setPending({
          delta: e.destination.index - position.current.index,
          identity: e.destination.key,
        });
    };
    return installHistoryGuard(window).subscribe({ pop, traverse });
  }, [role, apply, replace]);
  const replaceInspection = useCallback(
    (id: string) => {
      if (id === current.current.inspectionId) return;
      const next = { ...current.current, inspectionId: id };
      apply(next);
      replace(next);
    },
    [apply, replace],
  );
  return {
    ...location,
    pending,
    go(next: WorkspaceLocation) {
      const safe = readWorkspaceLocation(
        workspaceHref(portalPath(role), next).split('?')[1],
        role,
      );
      if (
        safe.view === current.current.view &&
        safe.inspectionId === current.current.inspectionId
      )
        return;
      marker.current = { ...marker.current, index: marker.current.index + 1 };
      window.history.pushState(
        { ...window.history.state, [markerKey]: marker.current },
        '',
        workspaceHref(portalPath(role), safe),
      );
      position.current = historyPosition(window);
      apply(safe);
    },
    replaceInspection,
    cancelHistory() {
      setPending(null);
    },
    confirmHistory() {
      if (!pending || bypass.current) return;
      if (draftNavigationState(window) === 'busy') {
        busyCallback.current();
        return;
      }
      bypass.current = pending.identity;
      setPending(null);
      const native = (
        window as Window & {
          navigation?: {
            traverseTo?: (key: string) => { finished: Promise<unknown> };
          };
        }
      ).navigation;
      if (position.current?.id === 'navigation' && native?.traverseTo) {
        void native.traverseTo(pending.identity).finished?.catch(() => {
          // A cancelled traversal is not a saved draft. Leave it available to retry.
          bypass.current = null;
          setPending(pending);
        });
      } else window.history.go(pending.delta);
    },
  };
}
