'use client';
import { useEffect } from 'react';
/** Protect only real unsaved input; opening/reading/retrying does not mark dirty. */
export function useDraftProtection(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: Event) => event.preventDefault();
    window.addEventListener('beforeunload', unload);
    window.addEventListener('solarscope:navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('solarscope:navigate', navigate);
    };
  }, [dirty]);
}
