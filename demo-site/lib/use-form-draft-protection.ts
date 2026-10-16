'use client';
import { useEffect, useRef, useState } from 'react';
import { useDraftProtection } from './use-draft-protection';

/** Memory-only guard for named, uncontrolled text/number/select inputs. No autosave. */
export function useFormDraftProtection(busy: boolean) {
  const ref = useRef<HTMLFormElement>(null);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  function signature() {
    return ref.current
      ? JSON.stringify(
          Array.from(new FormData(ref.current), ([k, v]) => [
            k,
            typeof v === 'string' ? v : v.name,
          ]),
        )
      : '';
  }
  function update() {
    if (busy || !ref.current) return;
    const value = signature();
    baseline.current ??= value;
    setDirty(value !== baseline.current);
  }
  useEffect(update);
  useDraftProtection(dirty, busy);
  return {
    ref,
    onInput: update,
    onChange: update,
    markSaved() {
      baseline.current = signature();
      setDirty(false);
    },
  };
}
