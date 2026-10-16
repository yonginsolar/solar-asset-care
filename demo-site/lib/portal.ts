export type Portal = 'auto' | 'admin' | 'expert' | 'client';
export function portalForRole(role: string): Exclude<Portal, 'auto'> | null {
  return role === 'owner'
    ? 'admin'
    : role === 'expert'
      ? 'expert'
      : role === 'client'
        ? 'client'
        : null;
}
export function portalPath(role: string) {
  const portal = portalForRole(role);
  return portal ? `/${portal}` : '/login';
}
export function portalTitle(role: string) {
  return role === 'owner'
    ? '관리자 운영센터'
    : role === 'expert'
      ? '전문가 작업실'
      : '내 발전소 관리';
}
export function portalLabel(role: string, view: string, fallback: string) {
  const labels: Record<string, Record<string, string>> = {
    client: {
      dashboard: '나의 현황',
      plants: '내 발전소',
      inspections: '점검 의뢰',
      reports: '진단 보고서',
      maintenance: '조치 진행',
      partners: '견적 비교·업체 선택',
      recycling: '재활용 인증서',
    },
    expert: {
      dashboard: '검토 현황',
      plants: '배정 발전소',
      inspections: '배정 점검',
      files: '점검 자료',
      findings: '후보 검토·판정',
      reports: '보고서 작성',
      maintenance: '후속 조치',
    },
  };
  return labels[role]?.[view] ?? fallback;
}
