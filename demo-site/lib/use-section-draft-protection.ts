'use client';
import { useEffect, useRef, useState } from 'react';
import { useDraftProtection } from './use-draft-protection';

/** Independent baselines per form: saving one never clears another form's draft. */
export function useSectionDraftProtection(busy: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const baselines = useRef(new Map<HTMLFormElement, string>());
  const saved = useRef(new Set<HTMLFormElement>());
  const [dirty, setDirty] = useState(false);
  function signature(form: HTMLFormElement) {
    return JSON.stringify(
      Array.from(form.querySelectorAll('input,select,textarea'), (element) => {
        const field = element as HTMLInputElement;
        return [
          field.name || field.id,
          field.type === 'checkbox' || field.type === 'radio'
            ? field.checked
            : field.value,
        ];
      }),
    );
  }
  function update() {
    const forms = Array.from(ref.current?.querySelectorAll('form') || []);
    for (const form of forms) {
      if (!baselines.current.has(form) || saved.current.has(form))
        baselines.current.set(form, signature(form));
    }
    for (const form of baselines.current.keys())
      if (!forms.includes(form)) baselines.current.delete(form);
    saved.current.clear();
    setDirty(
      forms.some((form) => baselines.current.get(form) !== signature(form)),
    );
  }
  useEffect(update);
  useDraftProtection(dirty, busy);
  return {
    ref,
    onInput: update,
    onChange: update,
    markSaved(form: HTMLFormElement) {
      saved.current.add(form);
    },
  };
}
