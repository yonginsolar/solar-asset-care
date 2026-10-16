'use client';

import { createContext, useContext, type ReactNode } from 'react';

type Selection = { id: string; select: (id: string) => boolean };
const InspectionContext = createContext<Selection>({
  id: '',
  select: () => false,
});
export function InspectionSelectionProvider({
  value,
  children,
}: {
  value: Selection;
  children: ReactNode;
}) {
  return (
    <InspectionContext.Provider value={value}>
      {children}
    </InspectionContext.Provider>
  );
}
/** Only resolve identifiers against the freshly authorized list. Never restore a role or data from storage. */
export function resolveInspectionSelection(id: string, rows: { id: string }[]) {
  return rows.some((row) => row.id === id) ? id : rows[0]?.id || '';
}
export function useInspectionSelection(rows: { id: string }[]) {
  const selection = useContext(InspectionContext);
  return [
    resolveInspectionSelection(selection.id, rows),
    selection.select,
  ] as const;
}
