/** Display rules only. Server-side role and transition checks remain authoritative. */
export function inspectionLocked(status?: string) {
  return status === 'closed' || status === 'cancelled';
}
export function inspectionRows<T extends { inspection_id: string }>(
  rows: T[],
  id: string,
  all = false,
) {
  return all ? rows : rows.filter((row) => row.inspection_id === id);
}
export function manualInspectionStatuses(status: string, expert: boolean) {
  if (inspectionLocked(status)) return [];
  if (status === 'published') return expert ? [] : ['closed'];
  if (status === 'approval') return [];
  return expert
    ? ['expert_review']
    : [
        'requested',
        'scheduled',
        'uploaded',
        'analyzing',
        'expert_review',
        'closed',
        'cancelled',
      ];
}
