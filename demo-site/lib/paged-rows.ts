export type RowPage<T> = {
  data: T[] | null;
  error: unknown;
  count: number | null;
};
/** Fetch each required collection in bounded pages, never trust the API row cap
 * as a complete result. The caller keeps its RLS scope and a unique total order.
 * Changed/partial pages fail closed rather than replacing complete UI state. */
export async function collectPagedRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<RowPage<T>>,
  signal: AbortSignal,
  rowKey: (row: T) => string,
  pageSize = 500,
) {
  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  while (true) {
    signal.throwIfAborted();
    const result = await fetchPage(rows.length, rows.length + pageSize - 1);
    signal.throwIfAborted();
    if (result.error) throw result.error;
    if (
      (total === null &&
        (!Number.isSafeInteger(result.count) || result.count! < 0)) ||
      !result.data
    )
      throw new Error(
        '목록 전체 건수를 확인하지 못했습니다. 다시 불러와 주세요.',
      );
    if (total !== null && result.count !== null && total !== result.count)
      throw new Error('조회 중 목록이 변경됐습니다. 다시 불러와 주세요.');
    total ??= result.count!;
    for (const row of result.data) {
      const key = rowKey(row);
      if (!key || seen.has(key))
        throw new Error(
          '조회 중 목록 순서가 변경됐습니다. 다시 불러와 주세요.',
        );
      seen.add(key);
      rows.push(row);
    }
    if (rows.length === total) return { data: rows, error: null };
    if (!result.data.length || rows.length > total)
      throw new Error('목록 일부를 불러오지 못했습니다. 다시 불러와 주세요.');
  }
}

export function collectionRowKey(row: unknown) {
  const value = row as {
    id?: string;
    user_id?: string;
    organization_id?: string;
    plant_id?: string;
    requester_user_id?: string;
    partner_id?: string;
  };
  return (
    value.id ??
    (value.plant_id && value.requester_user_id
      ? `${value.plant_id}:${value.requester_user_id}`
      : value.user_id
        ? `${value.organization_id ?? ''}:${value.user_id}`
        : (value.partner_id ?? ''))
  );
}
