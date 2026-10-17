/** Stable for a single form attempt, independent across remounts and browser tabs.
 * The database's organization/code unique constraint remains the final guard. */
export function newInspectionCode(day: string, uuid = crypto.randomUUID()) {
  return `INS-${day.replaceAll('-', '')}-${uuid.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}

/** Only report detail routes are resumable; never accept an origin, query or hash. */
export function reportReturnPath(value: string | null) {
  return value &&
    value.length === 45 &&
    /^\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function reportLoginPath(reportId: string) {
  const path = reportReturnPath(`/reports/${reportId}`);
  return path ? `/login?next=${encodeURIComponent(path)}` : '/login';
}

export function inspectionNextStep(status: string) {
  const guidance: Record<string, string> = {
    requested:
      '접수 내용을 확인하는 단계입니다. 사진이 있다면 담당자에게 원본 전달 방법을 확인해 주세요.',
    scheduled:
      '점검 일정이 정해졌습니다. 일정 변경이 필요하면 담당자에게 문의해 주세요.',
    uploading: '점검 사진을 등록하는 단계입니다.',
    quality_review: '사진과 촬영 조건을 확인하는 단계입니다.',
    analysis: '사진에서 상대적인 이상 후보를 분석하는 단계입니다.',
    expert_review: '전문가가 사진과 이상 후보를 검토하는 단계입니다.',
    approval: '보고서의 최종 검토를 진행하는 단계입니다.',
    published: '진단 보고서에서 발행된 결과를 확인할 수 있습니다.',
    closed: '종료된 점검입니다. 발행된 보고서는 진단 보고서에서 확인해 주세요.',
    cancelled: '취소된 점검입니다. 다시 점검이 필요하면 새로 의뢰해 주세요.',
  };
  return Object.hasOwn(guidance, status)
    ? guidance[status]
    : '진행 상황은 담당자에게 확인해 주세요.';
}
