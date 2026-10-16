const files = new WeakMap<File, number>();
let sequence = 0;

/** Disabled fields still belong to a draft. Exact File identity is memory-only. */
export function formDraftFingerprint(form: HTMLFormElement) {
  return JSON.stringify(
    Array.from(form.elements).flatMap<unknown[]>((element) => {
      const field = element as HTMLInputElement;
      if (
        !field.name ||
        !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName)
      )
        return [];
      if (['submit', 'reset', 'button'].includes(field.type)) return [];
      if (field.type === 'file')
        return [
          [
            field.name,
            Array.from(field.files || [], (file) => {
              if (!files.has(file)) files.set(file, ++sequence);
              return [
                files.get(file),
                file.name,
                file.size,
                file.type,
                file.lastModified,
              ];
            }),
          ],
        ];
      if (field.type === 'checkbox' || field.type === 'radio')
        return [[field.name, field.value, field.checked]];
      if (field.tagName === 'SELECT')
        return [
          [
            field.name,
            Array.from(
              (element as unknown as HTMLSelectElement).selectedOptions,
              (o) => o.value,
            ),
          ],
        ];
      return [[field.name, field.value]];
    }),
  );
}
