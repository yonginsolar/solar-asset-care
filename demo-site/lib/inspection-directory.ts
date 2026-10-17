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

export function inspectionEmptyState(
  role: 'owner' | 'expert' | 'client',
  hasPlants: boolean,
) {
  if (role === 'expert')
    return {
      title: '아직 배정된 점검이 없습니다',
      copy: '관리자가 점검을 배정하면 이곳에서 자료를 확인하고 검토할 수 있습니다.',
    };
  return {
    title:
      role === 'client'
        ? '아직 의뢰한 점검이 없습니다'
        : '접수된 점검이 없습니다',
    copy: !hasPlants
      ? '먼저 발전소를 등록한 뒤 점검을 의뢰할 수 있습니다.'
      : role === 'client'
        ? '새 점검 요청에서 발전소를 선택하고 점검을 의뢰해 주세요.'
        : '새 점검 접수 양식에서 점검을 등록하세요.',
  };
}

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
