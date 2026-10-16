export const CERTIFICATE_MAX_BYTES = 10000000;
export const certificateStatus = {
  pending: '확인 대기',
  published: '의뢰인 공개',
  withdrawn: '회수',
} as const;

/** A background refresh after saving one card must not replace another draft's
 * original revision or unmount it when a newly inserted row shifts the page. */
export function preserveCertificateDrafts<T extends { id: string }>(
  previous: T[],
  incoming: T[],
  protectedIds: ReadonlySet<string>,
  savedId?: string,
) {
  const retained = new Map(
    previous
      .filter((row) => row.id !== savedId && protectedIds.has(row.id))
      .map((row) => [row.id, row]),
  );
  const next = incoming.map((row) => {
    const old = retained.get(row.id);
    retained.delete(row.id);
    return old ?? row;
  });
  return [...next, ...retained.values()];
}
export function certificateExtension(mime: string) {
  return (
    {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
    } as Record<string, string>
  )[mime];
}
export function validCertificateDate(value: string, today: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > today
  )
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function certificateFilename(id: string, mime: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !certificateExtension(mime))
    throw new Error('파일 정보가 올바르지 않습니다.');
  return `recycling-certificate-${id}.${certificateExtension(mime)}`;
}
