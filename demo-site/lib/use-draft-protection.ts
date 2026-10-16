'use client';
import { useEffect } from 'react';
import { protectDraftNavigation } from './draft-navigation';
/** Protect only real unsaved input; opening/reading/retrying does not mark dirty. */
export function useDraftProtection(dirty: boolean, busy = false) {
  useEffect(() => {
    return protectDraftNavigation(window, dirty, busy);
  }, [dirty, busy]);
}
