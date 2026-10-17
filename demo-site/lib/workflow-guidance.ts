import type { WorkspaceLocation } from './workspace-navigation';

/** Presentation only: use the current RLS-filtered lists, never an ID as an access grant. */
export function inspectionShortcut(
  role: string,
  id: string,
  inspections: readonly { id: string; status: string }[],
  reports: readonly { inspection_id: string; status: string }[],
): WorkspaceLocation | null {
  const inspection = inspections.find((item) => item.id === id);
  if (!inspection || !['owner', 'expert', 'client'].includes(role)) return null;
  const published = reports.some(
    (report) => report.inspection_id === id && report.status === 'published',
  );
  return {
    inspectionId: id,
    view:
      role === 'client'
        ? published
          ? 'reports'
          : 'inspections'
        : ['published', 'closed'].includes(inspection.status)
          ? 'reports'
          : 'files',
  };
}

/** Empty screens describe actions the current role can actually perform. */
export function workflowEmptyState(
  kind: 'reports' | 'maintenance',
  options: {
    canWrite: boolean;
    hasInspections: boolean;
    hasOtherRows: boolean;
    locked?: boolean;
  },
): { title: string; copy: string; action?: string } {
  const { canWrite, hasInspections, hasOtherRows, locked } = options;
  if (kind === 'reports') {
    if (hasOtherRows)
      return {
        title: canWrite
          ? '선택한 점검에는 작성된 보고서가 없습니다'
          : '선택한 점검에는 발행된 보고서가 없습니다',
        copy: canWrite
          ? '다른 점검의 보고서는 전체 보고서에서 확인할 수 있습니다.'
          : '다른 점검의 발행본은 전체 보고서에서 확인할 수 있습니다.',
        action: '전체 보고서 보기',
      };
    if (!canWrite)
      return {
        title: '아직 발행된 보고서가 없습니다',
        copy: hasInspections
          ? '전문가 검토와 관리자 발행이 완료되면 이곳에서 보고서를 확인할 수 있습니다.'
          : '점검을 의뢰하고 보고서가 발행되면 이곳에서 확인할 수 있습니다.',
      };
    return {
      title: '작성된 보고서가 없습니다',
      copy: !hasInspections
        ? '점검을 접수한 뒤 보고서 초안을 만들 수 있습니다.'
        : locked
          ? '새 보고서가 필요하면 관리자가 점검을 재개한 뒤 초안을 만들어 주세요.'
          : '선택한 점검의 사진과 소견을 확인한 뒤 첫 초안을 만들어 주세요.',
    };
  }
  if (hasOtherRows)
    return {
      title: '선택한 점검에는 등록된 조치가 없습니다',
      copy: '다른 점검의 유지보수 진행 상황은 전체 조치에서 확인할 수 있습니다.',
      action: '전체 조치 보기',
    };
  return {
    title: '등록된 조치가 없습니다',
    copy: canWrite
      ? hasInspections
        ? '선택한 점검에 필요한 현장 조치를 등록해 주세요.'
        : '점검을 접수한 뒤 필요한 현장 조치를 등록할 수 있습니다.'
      : '관리자가 후속 조치를 등록하면 이곳에서 진행 상황을 확인할 수 있습니다.',
  };
}
