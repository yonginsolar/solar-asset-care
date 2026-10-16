/** Display the current authorized database rows. The selection RPC rechecks all
 * permissions and work state transactionally; this helper grants no access. */
export function quoteSelectionLock(
  request: {
    status: string;
    requester_user_id: string;
    maintenance_request_id: string | null;
  },
  maintenance: readonly { id: string; status: string }[],
  userId: string,
) {
  if (request.requester_user_id !== userId)
    return '관리자가 지정한 견적 담당자만 업체를 선택할 수 있습니다.';
  if (
    !['requested', 'collecting', 'ready_for_selection', 'selected'].includes(
      request.status,
    )
  )
    return '종료·취소된 견적은 업체를 변경할 수 없습니다.';
  if (request.maintenance_request_id) {
    const work = maintenance.find(
      (item) => item.id === request.maintenance_request_id,
    );
    if (!work)
      return '연결된 작업 상태를 확인할 수 없습니다. 새로고침해 주세요.';
    if (['in_progress', 'completed', 'cancelled'].includes(work.status))
      return '작업 중·완료·취소된 유지보수의 업체는 변경할 수 없습니다.';
  }
  return null;
}
