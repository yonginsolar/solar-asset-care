import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from './supabase/database.types';
import { verifyOriginal } from './original-integrity';

export const PREVIEW_MAX_EDGE = 960;
export const PREVIEW_MAX_BYTES = 350_000;
export type PreviewSource = Tables<'inspection_files'>;
export function previewDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 40_000_000
  )
    throw new Error('사진은 4,000만 화소 이하로 준비해 주세요.');
  const ratio = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
export function inspectionPreviewPath(
  source: Pick<
    PreviewSource,
    'id' | 'organization_id' | 'inspection_id' | 'sha256'
  >,
) {
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (
    ![source.id, source.organization_id, source.inspection_id].every((x) =>
      uuid.test(x),
    ) ||
    !/^[a-f0-9]{64}$/.test(source.sha256 || '')
  )
    throw new Error('원본 사진의 확인 정보가 없습니다.');
  return `${source.organization_id}/${source.inspection_id}/${source.id}-${source.sha256}.jpg`;
}
async function checksum(blob: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
/** Export a separate JPEG; the source bytes, metadata and thermal data stay intact. */
export async function createInspectionPreview(original: Blob) {
  const bitmap = await createImageBitmap(original);
  try {
    const size = previewDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('사진 미리보기를 만들 수 없습니다.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (blob && blob.size <= PREVIEW_MAX_BYTES) return blob;
    }
    throw new Error('사진 미리보기 용량을 줄이지 못했습니다.');
  } finally {
    bitmap.close();
  }
}
async function authHeaders(client: SupabaseClient<Database>) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('다시 로그인해 주세요.');
  return { Authorization: `Bearer ${data.session.access_token}` };
}
async function responseProblem(response: Response) {
  const value: unknown = await response.json().catch(() => null);
  return value && typeof value === 'object'
    ? (value as { error?: string; code?: string })
    : null;
}
export async function saveInspectionPreview(
  client: SupabaseClient<Database>,
  source: PreviewSource,
  original: Blob,
  signal?: AbortSignal,
) {
  if ((await checksum(original)) !== source.sha256)
    throw new Error('원본 사진의 확인값이 다릅니다.');
  const form = new FormData();
  form.set('id', source.id);
  form.set('image', await createInspectionPreview(original), 'preview.jpg');
  const response = await fetch('/api/inspection-files', {
    method: 'POST',
    headers: await authHeaders(client),
    body: form,
    signal,
  });
  if (!response.ok) {
    const result = await responseProblem(response);
    throw new Error(result?.error || '사진 미리보기를 저장하지 못했습니다.');
  }
}
/** Old uploads are converted once, on demand. Later views fetch only the small JPEG. */
export async function loadInspectionPreview(
  client: SupabaseClient<Database>,
  source: PreviewSource,
  signal?: AbortSignal,
) {
  const headers = await authHeaders(client);
  const url = `/api/inspection-files?id=${encodeURIComponent(source.id)}`;
  let response = await fetch(url, { headers, signal, cache: 'no-store' });
  if (response.status === 404) {
    const missing = await responseProblem(response.clone());
    if (missing?.code === 'preview_missing') {
      const result = await client.storage
        .from(source.storage_bucket)
        .download(source.storage_path, {}, { signal, cache: 'no-store' });
      if (result.error || !result.data)
        throw new Error('원본 사진을 불러오지 못했습니다.');
      await saveInspectionPreview(client, source, result.data, signal);
      response = await fetch(url, { headers, signal, cache: 'no-store' });
    }
  }
  if (!response.ok) {
    const result = await responseProblem(response);
    throw new Error(result?.error || '사진 미리보기를 불러오지 못했습니다.');
  }
  return response.blob();
}
export async function downloadInspectionOriginal(
  client: SupabaseClient<Database>,
  source: PreviewSource,
) {
  const response = await fetch(
    `/api/inspection-files?id=${encodeURIComponent(source.id)}&original=1`,
    { headers: await authHeaders(client), cache: 'no-store' },
  );
  if (!response.ok) {
    const result = await responseProblem(response);
    throw new Error(result?.error || '원본 사진을 내려받지 못했습니다.');
  }
  const original = await response.blob();
  await verifyOriginal(original, source);
  const url = URL.createObjectURL(original);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = source.original_name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
