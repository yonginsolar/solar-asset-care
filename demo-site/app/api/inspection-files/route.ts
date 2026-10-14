import { requestClient, privateHeaders } from '@/lib/supabase/request-client';
import {
  inspectionPreviewPath,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_EDGE,
} from '@/lib/inspection-preview';
import { cleanReportJpeg } from '@/lib/report-visuals';

const uuid = (s: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const fail = (error: string, status: number, code?: string) =>
  Response.json(
    { error, ...(code ? { code } : {}) },
    { status, headers: privateHeaders },
  );
async function sourceFile(
  client: Awaited<ReturnType<typeof requestClient>>,
  id: string,
) {
  if (!uuid(id)) return null;
  const { data, error } = await client
    .from('inspection_files')
    .select('*')
    .eq('id', id)
    .in('kind', ['thermal_original', 'visible_original'])
    .maybeSingle();
  return error ? null : data;
}
function smallJpeg(bytes: Uint8Array) {
  if (bytes.length > PREVIEW_MAX_BYTES)
    throw new Error('미리보기 용량을 줄여 주세요.');
  const jpeg = cleanReportJpeg(bytes);
  if (jpeg.width > PREVIEW_MAX_EDGE || jpeg.height > PREVIEW_MAX_EDGE)
    throw new Error('미리보기 크기를 줄여 주세요.');
  return jpeg;
}
export async function POST(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return fail('다시 로그인해 주세요.', 401);
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return fail('사진이 없습니다.', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > PREVIEW_MAX_BYTES + 16_000) {
        await reader.cancel();
        return fail('미리보기 용량을 줄여 주세요.', 413);
      }
      chunks.push(part.value);
    }
    const form = await new Response(new Blob(chunks as BlobPart[]), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
    const id = form.get('id'),
      image = form.get('image');
    if (typeof id !== 'string' || !(image instanceof Blob))
      return fail('사진을 확인해 주세요.', 400);
    const source = await sourceFile(client, id);
    if (!source) return fail('사진에 접근할 수 없습니다.', 404);
    if (!['image/jpeg', 'image/png'].includes(source.mime_type || ''))
      return fail('JPG·PNG 사진만 미리보기를 만들 수 있습니다.', 400);
    const path = inspectionPreviewPath(source),
      jpeg = smallJpeg(new Uint8Array(await image.arrayBuffer()));
    const { error } = await client.storage
      .from('inspection-derived')
      .upload(path, jpeg.bytes, {
        contentType: 'image/jpeg',
        upsert: false,
        cacheControl: '0',
      });
    if (error) {
      // A retry reuses the existing safe derivative instead of overwriting it.
      const previous = await client.storage
        .from('inspection-derived')
        .download(
          path,
          { cacheNonce: crypto.randomUUID() },
          { cache: 'no-store', signal: AbortSignal.timeout(20_000) },
        );
      if (
        previous.error ||
        !previous.data ||
        previous.data.size > PREVIEW_MAX_BYTES
      )
        return fail('사진 미리보기를 저장하지 못했습니다.', 503);
      smallJpeg(new Uint8Array(await previous.data.arrayBuffer()));
    }
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch {
    return fail('JPG 사진의 크기·형식과 연결 권한을 확인해 주세요.', 400);
  }
}
export async function GET(request: Request) {
  let client;
  try {
    client = await requestClient(request);
  } catch {
    return fail('다시 로그인해 주세요.', 401);
  }
  const params = new URL(request.url).searchParams;
  const source = await sourceFile(client, params.get('id') || '');
  if (!source) return fail('사진에 접근할 수 없습니다.', 404);
  try {
    if (params.get('original') === '1') {
      if (
        source.storage_bucket !== 'inspection-originals' ||
        !source.bytes ||
        source.bytes > 50 * 1024 * 1024
      )
        return fail('원본 정보를 확인해 주세요.', 409);
      const { data, error } = await client.storage
        .from(source.storage_bucket)
        .download(
          source.storage_path,
          { cacheNonce: crypto.randomUUID() },
          { cache: 'no-store', signal: AbortSignal.timeout(30_000) },
        );
      if (error || !data || data.size !== source.bytes)
        return fail('원본을 불러오지 못했습니다.', 503);
      return new Response(data, {
        headers: {
          ...privateHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="original"; filename*=UTF-8''${encodeURIComponent(source.original_name).replaceAll("'", '%27')}`,
        },
      });
    }
    const { data, error } = await client.storage
      .from('inspection-derived')
      .download(
        inspectionPreviewPath(source),
        { cacheNonce: crypto.randomUUID() },
        { cache: 'no-store', signal: AbortSignal.timeout(20_000) },
      );
    if (error) {
      if (
        'statusCode' in error &&
        (String(error.statusCode) === '404' ||
          (String(error.statusCode) === '400' &&
            /not found|does not exist/i.test(error.message)))
      )
        return fail('사진 미리보기를 준비해 주세요.', 404, 'preview_missing');
      return fail('사진 미리보기를 불러오지 못했습니다.', 503);
    }
    if (!data)
      return fail('사진 미리보기를 준비해 주세요.', 404, 'preview_missing');
    const jpeg = smallJpeg(new Uint8Array(await data.arrayBuffer()));
    return new Response(Uint8Array.from(jpeg.bytes), {
      headers: { ...privateHeaders, 'Content-Type': 'image/jpeg' },
    });
  } catch {
    return fail('사진 미리보기 정보를 확인해 주세요.', 400);
  }
}
