export const maintenanceStatuses = [
  ['requested', '요청'],
  ['assigned', '담당 배정'],
  ['quoted', '견적'],
  ['scheduled', '일정 확정'],
  ['in_progress', '작업 중'],
  ['completed', '완료'],
  ['cancelled', '취소'],
] as const;

export function maintenanceStatusLabel(status: string) {
  return (
    maintenanceStatuses.find(([value]) => value === status)?.[1] ??
    '상태 확인 필요'
  );
}
