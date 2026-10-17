export const inspectionStatuses = [
  ['requested', '접수'],
  ['scheduled', '일정 확정'],
  ['uploading', '자료 업로드'],
  ['quality_review', '품질 검토'],
  ['analysis', '규칙 분석'],
  ['expert_review', '전문가 판정'],
  ['approval', '승인 대기'],
  ['published', '발행'],
  ['closed', '종료'],
  ['cancelled', '취소'],
] as const;

export type InspectionStatusFilter =
  | 'all'
  | (typeof inspectionStatuses)[number][0];

type SearchableInspection = {
  plant_id: string;
  inspection_code: string;
  purpose: string | null;
  status: string;
};

function normalize(value: string) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Only filter the caller's already-authorized rows; never fetch a wider directory.
export function filterInspections<T extends SearchableInspection>(
  inspections: readonly T[],
  plants: readonly { id: string; name: string }[],
  query: string,
  status: InspectionStatusFilter,
): T[] {
  const names = new Map(plants.map((plant) => [plant.id, plant.name]));
  const words = normalize(query).split(' ').filter(Boolean);
  return inspections.filter((inspection) => {
    if (status !== 'all' && inspection.status !== status) return false;
    const fields = [
      names.get(inspection.plant_id) ?? '',
      inspection.inspection_code,
      inspection.purpose ?? '',
    ].map(normalize);
    return words.every((word) => fields.some((field) => field.includes(word)));
  });
}
