/** The immutable registered identity is checked at every original delivery/use. */
export async function verifyOriginal(
  blob: Blob,
  source: { bytes: number | null; sha256: string | null },
) {
  if (
    !source.bytes ||
    blob.size !== source.bytes ||
    !/^[a-f0-9]{64}$/.test(source.sha256 ?? '')
  )
    throw new Error(
      '원본 파일의 크기·확인 정보를 검증하지 못했습니다. 관리자에게 문의해 주세요.',
    );
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== source.sha256)
    throw new Error(
      '원본 파일의 확인값이 다릅니다. 다운로드·재분석을 중단했습니다. 관리자에게 문의해 주세요.',
    );
}
