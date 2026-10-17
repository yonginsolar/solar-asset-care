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
export function manualInspectionStatuses(
  status: string,
  expert: boolean,
  reports?: { hasPublishedReport: boolean; hasOpenReport: boolean },
) {
  if (inspectionLocked(status)) return [];
  if (reports?.hasOpenReport) return [];
  if (reports?.hasPublishedReport ?? status === 'published')
    return expert ? [] : ['closed'];
  if (status === 'published') return [];
  if (status === 'approval') return [];
  if (
    ![
      'requested',
      'scheduled',
      'uploading',
      'quality_review',
      'analysis',
      'expert_review',
    ].includes(status)
  )
    return [];
  return expert
    ? ['expert_review']
    : ['requested', 'scheduled', 'expert_review', 'cancelled'];
}
