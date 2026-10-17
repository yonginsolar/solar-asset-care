'use client';
import { useRef, useState } from 'react';
import {
  draftNavigationState,
  type DraftNavigationState,
} from './draft-navigation';

/** Internal editor changes must obey the same draft/write boundary as navigation. */
export function useGuardedAction(readState?: () => DraftNavigationState) {
  const action = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Read only in an event handler, using this committed render's callback.
  const state = () => readState?.() ?? draftNavigationState(window);
  function cancel() {
    action.current = null;
    setPending(false);
    setBlocked(false);
  }
  return {
    pending,
    blocked,
    cancel,
    request: (next: () => void) => {
      const value = state();
      setBlocked(value === 'busy');
      if (value === 'busy') return false;
      if (value === 'dirty') {
        action.current = next;
        setPending(true);
        return false;
      }
      next();
      return true;
    },
    confirm: () => {
      if (!action.current) return;
      // Recheck at confirmation time; a request may have begun while open.
      if (state() === 'busy') {
        setBlocked(true);
        return;
      }
      const next = action.current;
      cancel();
      next();
    },
  };
}
