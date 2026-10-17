export const auditActions: Record<string, string> = {
  'email.accepted': '안내 메일 발송 접수',
  'email.failed': '안내 메일 발송 실패',
  'email.unknown': '안내 메일 발송 결과 확인 필요',
  'settings.save': '운영 설정 초안 저장',
  'settings.publish': '새 약관 적용',
  'customers.create': '고객 등록',
  'customers.link_contact': '고객 담당자 연결',
  'customers.unlink_contact': '고객 담당자 연결 해제',
  'customers.link_plant': '고객 발전소 연결',
  'customers.unlink_plant': '고객 발전소 연결 해제',
  'account.profile_completed': '기본정보·동의 처리',
  'organization.bootstrapped': '작업공간 개설',
  'organization.member_invited': '사용자 초대',
  'organization.member_saved': '사용자 등록·변경',
  'organization.member_removed': '사용자 접근권한 해제',
  'organization.super_admin_transferred': '최고관리자 양도',
  'organization.member_updated': '계정 역할·상태 변경',
  'requester.registered': '의뢰인 가입',
  'requester.plant_created': '의뢰인 발전소 등록',
  'requester.plant_updated': '의뢰인 발전소 정보 수정',
  'requester.plant_details_recorded': '발전소 상세정보 등록',
  'requester.inspection_requested': '점검 의뢰 접수',
  'plant.requester_assigned': '발전소 의뢰인 배정',
  'inspection.assessment_saved': '경제성·촬영조건 평가 저장',
  'inspection.schedule_updated': '점검 일정 변경',
  'inspection.status_changed': '점검 상태 변경',
  'analysis.relative_completed': '사진 상대 분석 완료',
  'finding.created': '소견·후보 등록',
  'finding.reviewed': '전문가 소견 판정',
  'calculation.settings_created': '계산·촬영 기준 등록',
  'report.draft_created': '보고서 초안 생성',
  'report.status_changed': '보고서 상태 변경',
  'report.image_created': '보고서 사진 등록',
  'report.image_reviewed': '보고서 사진 검토',
  'report.pdf_archived': '보고서 PDF 보관',
  'report.review_snapshot_superseded': '보고서 검토본 갱신',
  'report.superseded': '개정 보고서로 대체',
  'maintenance.status_changed': '유지보수 상태 변경',
  'partner.created': '업체 등록',
  'partner.updated': '업체 정보 변경',
  'quote.requested': '업체 견적 요청',
  'quote.response_recorded': '견적 회신 등록',
  'quote.selected': '견적 업체 선택',
  'recycling.registered': '재활용 인증서 등록',
  'recycling.corrected': '재활용 인증서 정보 수정',
  'recycling.published': '재활용 인증서 공개',
  'recycling.withdrawn': '재활용 인증서 회수',
};
export const auditEntities: Record<string, string> = {
  organization: '작업공간',
  organization_member: '사용자',
  profile: '계정 정보',
  service_settings: '운영 설정',
  service_policy: '이용약관',
  customer_account: '고객',
  customer: '고객',
  plant: '발전소',
  inspection: '점검',
  inspection_assessment: '점검 평가',
  inspection_file: '점검 원본',
  analysis_run: '사진 분석',
  finding: '소견·후보',
  report: '보고서',
  report_image: '보고서 사진',
  report_document: '보고서 PDF',
  calculation_settings: '계산·촬영 기준',
  maintenance_request: '유지보수',
  maintenance: '유지보수',
  partner: '업체',
  quote_request: '견적 요청',
  partner_quote: '업체 견적',
  recycling_certificate: '재활용 인증서',
};
export type AuditEntry = {
  id: number;
  occurred_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
};
export type AuditContext = {
  actors: Record<string, string>;
  targets: Record<string, string>;
  partial: boolean;
};
export function auditTargetKey(type: string, id: string) {
  return `${type}:${id}`;
}
export function auditLabels(row: AuditEntry, context: AuditContext) {
  return {
    action: Object.hasOwn(auditActions, row.action)
      ? auditActions[row.action]
      : '업무 변경',
    target:
      (row.entity_id &&
        context.targets[auditTargetKey(row.entity_type, row.entity_id)]) ||
      `${Object.hasOwn(auditEntities, row.entity_type) ? auditEntities[row.entity_type] : '업무 항목'}${row.entity_id ? ' · 기록 ' + row.entity_id.slice(0, 8) : ''}`,
    actor: row.actor_user_id
      ? context.actors[row.actor_user_id] ||
        `이름 확인 불가 · ${row.actor_user_id.slice(0, 8)}`
      : '시스템',
  };
}
