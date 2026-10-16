'use client';
import { useEffect, useRef, useState } from 'react';
import { useDraftProtection } from './use-draft-protection';
import { formDraftFingerprint } from './form-draft';

/** Memory-only guard for named, uncontrolled text/number/select inputs. No autosave. */
export function useFormDraftProtection(busy: boolean) {
  const ref = useRef<HTMLFormElement>(null);
  const baseline = useRef<string | null>(null);
  const saved = useRef(false);
  const [dirty, setDirty] = useState(false);
  function signature() {
    return ref.current ? formDraftFingerprint(ref.current) : '';
  }
  function update() {
    if (busy || !ref.current) return;
    const value = signature();
    if (baseline.current === null || saved.current) baseline.current = value;
    saved.current = false;
    setDirty(value !== baseline.current);
  }
  useEffect(update);
  useDraftProtection(dirty, busy);
  return {
    ref,
    onInput: update,
    onChange: update,
    markSaved() {
      saved.current = true;
      if (!busy) update();
    },
    getState(): 'clean' | 'dirty' | 'busy' {
      if (busy) return 'busy';
      if (!ref.current || baseline.current === null || saved.current)
        return 'clean';
      return signature() === baseline.current ? 'clean' : 'dirty';
    },
  };
}
