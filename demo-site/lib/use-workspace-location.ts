'use client';
import { useEffect, useRef, useState } from 'react';
import { draftNavigationState } from './draft-navigation';
import { portalPath } from './portal';
import {
  readWorkspaceLocation,
  workspaceHref,
  type WorkspaceLocation,
} from './workspace-navigation';

type Marker = { id: string; role: string; index: number };
type HistoryRequest = { location: WorkspaceLocation; index: number };
const markerKey = 'solarScopeWorkspace';

/** URL contains menu and opaque inspection id only: never a role grant, draft, File or token. */
export function useWorkspaceLocation(role: string, onBusy: () => void) {
  const [location, setLocation] = useState<WorkspaceLocation>({
    view: 'dashboard',
    inspectionId: '',
  });
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<HistoryRequest | null>(null);
  const current = useRef(location);
  const marker = useRef<Marker>({ id: '', role, index: 0 });
  const restoring = useRef<(() => void) | null>(null);
  const bypass = useRef<number | null>(null);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  function apply(next: WorkspaceLocation) {
    current.current = next;
    setLocation(next);
  }
  function replace(next: WorkspaceLocation) {
    window.history.replaceState(
      { ...window.history.state, [markerKey]: marker.current },
      '',
      workspaceHref(portalPath(role), next),
    );
  }
  useEffect(() => {
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
    setReady(true);
    const pop = (event: PopStateEvent) => {
      const target = event.state?.[markerKey] as Marker | undefined;
      if (
        !target ||
        target.id !== marker.current.id ||
        target.role !== role ||
        !Number.isSafeInteger(target.index) ||
        window.location.pathname !== portalPath(role)
      ) {
        return;
      }
      // These entries change workspace UI only. Run before the framework's
      // router so its popstate restoration cannot remount and erase a draft.
      event.stopImmediatePropagation();
      if (restoring.current) {
        if (target.index !== marker.current.index) {
          window.history.go(marker.current.index - target.index);
          return;
        }
        const after = restoring.current;
        restoring.current = null;
        after();
        return;
      }
      const next = readWorkspaceLocation(window.location.search, role);
      const state = draftNavigationState(window);
      if (bypass.current === target.index || state === 'clean') {
        bypass.current = null;
        marker.current = target;
        apply(next);
        replace(next);
        return;
      }
      const after = () => {
        if (state === 'busy') busyCallback.current();
        else setPending({ location: next, index: target.index });
      };
      const delta = marker.current.index - target.index;
      if (delta) {
        // Restore the actual history position before asking: cancel keeps the same draft and URL.
        restoring.current = after;
        window.history.go(delta);
      } else {
        replace(current.current);
        after();
      }
    };
    window.addEventListener('popstate', pop, { capture: true });
    return () => window.removeEventListener('popstate', pop, { capture: true });
  }, [role]);
  return {
    ...location,
    ready,
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
      apply(safe);
    },
    replaceInspection(id: string) {
      if (id === current.current.inspectionId) return;
      const next = { ...current.current, inspectionId: id };
      apply(next);
      replace(next);
    },
    cancelHistory() {
      setPending(null);
    },
    confirmHistory() {
      if (!pending) return;
      if (draftNavigationState(window) === 'busy') {
        busyCallback.current();
        return;
      }
      bypass.current = pending.index;
      setPending(null);
      window.history.go(pending.index - marker.current.index);
    },
  };
}
