'use client';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useInspectionSelection } from '@/lib/inspection-context';
import { useDraftProtection } from '@/lib/use-draft-protection';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Database, Tables } from '@/lib/supabase/database.types';
import { validRect, type Rect, type ReportImage } from '@/lib/report-visuals';
import { ReportPhoto } from './report-visuals';
import { loadInspectionPreview } from '@/lib/inspection-preview';

export function ReportImagesView({
  supabase,
  inspections,
  files,
  isOwner,
}: {
  supabase: SupabaseClient<Database>;
  inspections: Tables<'inspections'>[];
  files: Tables<'inspection_files'>[];
  isOwner: boolean;
}) {
  const [inspectionId, setInspection] = useInspectionSelection(inspections);
  const [sourceId, setSourceId] = useState('');
  const [photos, setPhotos] = useState<ReportImage[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [caption, setCaption] = useState('');
  const [masks, setMasks] = useState<Rect[]>([]);
  const [rectangle, setRectangle] = useState({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  useDraftProtection(Boolean(sourceId || caption || masks.length), busy);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestId = useRef('');
  const sources = files.filter(
    (file) =>
      file.inspection_id === inspectionId &&
      ['image/jpeg', 'image/png'].includes(file.mime_type || ''),
  );
  const selectedSource = sources.find((f) => f.id === sourceId);
  function selectSource(id: string) {
    setSourceId(id);
    setImage(null);
    setMasks([]);
    setCaption('');
    requestId.current = '';
    setNotice('');
  }

  useEffect(() => {
    let active = true;
    if (inspectionId)
      void supabase
        .from('report_images')
        .select('*')
        .eq('inspection_id', inspectionId)
        .order('created_at')
        .then(({ data, error }) => {
          if (active) {
            setPhotosLoading(false);
            if (error) setNotice('사진 목록을 불러오지 못했습니다.');
            else setPhotos((data || []) as unknown as ReportImage[]);
          }
        });
    return () => {
      active = false;
    };
  }, [supabase, inspectionId, revision]);
  useEffect(() => {
    let active = true,
      url = '';
    const controller = new AbortController();
    const source = selectedSource;
    if (source)
      void (async () => {
        try {
          const data = await loadInspectionPreview(
            supabase,
            source,
            controller.signal,
          );
          if (!active) return;
          url = URL.createObjectURL(data);
          const img = new Image();
          img.src = url;
          await img.decode();
          if (img.naturalWidth * img.naturalHeight > 40000000)
            throw new Error('사진은 4,000만 화소 이하로 준비해 주세요.');
          if (active) setImage(img);
          else URL.revokeObjectURL(url);
        } catch (e) {
          if (active)
            setNotice(e instanceof Error ? e.message : '사진 읽기 실패');
        }
      })();
    return () => {
      active = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [supabase, selectedSource]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const scale = Math.min(
      1,
      1280 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (const r of masks)
      ctx.fillRect(
        Math.floor(r.x * canvas.width),
        Math.floor(r.y * canvas.height),
        Math.ceil((r.x + r.width) * canvas.width) -
          Math.floor(r.x * canvas.width),
        Math.ceil((r.y + r.height) * canvas.height) -
          Math.floor(r.y * canvas.height),
      );
  }, [image, masks]);

  function addMask() {
    const r = Object.fromEntries(
      Object.entries(rectangle).map(([k, v]) => [k, v / 100]),
    ) as Rect;
    if (!validRect(r) || masks.length >= 20) {
      setNotice('영역은 사진 안에 지정하고 최대 20개까지 추가해 주세요.');
      return;
    }
    setMasks([...masks, r]);
    setNotice('');
    requestId.current = '';
  }
  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !image || !canvasRef.current || !caption.trim()) return;
    setBusy(true);
    setNotice('보고서 사진을 저장하는 중…');
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvasRef.current!.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.')),
          'image/jpeg',
          0.82,
        ),
      );
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('다시 로그인해 주세요.');
      requestId.current ||= crypto.randomUUID();
      const form = new FormData();
      form.set('id', requestId.current);
      form.set('sourceId', sourceId);
      form.set('caption', caption.trim());
      form.set('masks', JSON.stringify(masks));
      form.set('image', blob, 'report.jpg');
      const response = await fetch('/api/report-images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        body: form,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '사진 저장 실패');
      selectSource('');
      setRevision((n) => n + 1);
      setNotice(
        '저장했습니다. 아래의 저장된 사진을 확인하고 관리자가 승인해 주세요.',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '사진 저장 실패');
    } finally {
      setBusy(false);
    }
  }
  async function review(photo: ReportImage, approve: boolean) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('review_report_image', {
        p_id: photo.id,
        p_sha256: photo.sha256,
        p_approve: approve,
      });
      if (error) throw new Error(error.message);
      setRevision((n) => n + 1);
      setNotice(
        approve
          ? '승인했습니다. 다음 검토 요청부터 보고서에 포함됩니다.'
          : '다음 보고서에서 제외했습니다. 이미 검토·발행된 보고서의 사진은 바뀌지 않습니다.',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '승인 처리 실패');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">보고서 사진</h1>
      <label className="block text-sm">
        점검 선택
        <select
          className="mt-2 block w-full rounded-lg border bg-white p-3"
          value={inspectionId}
          disabled={busy}
          onChange={(e) => {
            if (!setInspection(e.target.value)) return;
            selectSource('');
            setVerified({});
            setPhotos([]);
            setPhotosLoading(true);
          }}
        >
          <option value="" disabled>
            점검을 선택하세요
          </option>
          {inspections.map((i) => (
            <option key={i.id} value={i.id}>
              {i.inspection_code}
            </option>
          ))}
        </select>
      </label>
      {notice && (
        <output className="block rounded-xl border bg-white p-4 text-sm">
          {notice}
        </output>
      )}
      <form
        onSubmit={save}
        className="space-y-4 rounded-2xl border bg-white p-5"
      >
        <h2 className="font-bold">고객에게 보여줄 사진 준비</h2>
        <p className="text-sm text-slate-600">
          번호판·얼굴·개인정보는 검은 영역으로 가려 주세요. 원본은 유지하고
          위치정보 등 부가정보를 뺀 별도 사진을 저장합니다.
        </p>
        <fieldset disabled={busy} className="space-y-4">
          <label className="block text-sm">
            원본 사진
            <select
              className="mt-2 block w-full rounded-lg border bg-white p-3"
              value={sourceId}
              onChange={(e) => selectSource(e.target.value)}
            >
              <option value="">JPG·PNG 원본 선택</option>
              {sources.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.original_name}
                </option>
              ))}
            </select>
          </label>
          {image && (
            <>
              <canvas
                ref={canvasRef}
                aria-label="가림 처리된 보고서 사진 미리보기"
                className="h-auto max-h-[600px] max-w-full rounded border"
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['x', 'y', 'width', 'height'] as const).map((k, i) => (
                  <label className="text-sm" key={k} htmlFor={`mask-${k}`}>
                    {
                      [
                        '왼쪽 위치 (%)',
                        '위쪽 위치 (%)',
                        '너비 (%)',
                        '높이 (%)',
                      ][i]
                    }
                    <Input
                      id={`mask-${k}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={rectangle[k]}
                      onChange={(e) =>
                        setRectangle({
                          ...rectangle,
                          [k]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <Button type="button" variant="outline" onClick={addMask}>
                가림 영역 추가
              </Button>
              {masks.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {masks.map((r, i) => (
                    <li key={i} className="flex items-center gap-3">
                      영역 {i + 1}: {(r.x * 100).toFixed(1)}%,{' '}
                      {(r.y * 100).toFixed(1)}%{' '}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMasks(masks.filter((_, index) => i !== index));
                          setNotice('');
                          requestId.current = '';
                        }}
                      >
                        영역 {i + 1} 삭제
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <label className="block text-sm" htmlFor="report-image-caption">
            사진 설명
            <Input
              id="report-image-caption"
              required
              maxLength={300}
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                requestId.current = '';
              }}
              placeholder="예: A열 1번 모듈 열화상"
            />
          </label>
          <Button type="submit" disabled={!image || !caption.trim() || busy}>
            {busy ? '처리 중…' : '가림 처리된 사진 저장'}
          </Button>
        </fieldset>
      </form>
      <h2 className="font-bold">저장된 사진 확인·승인</h2>
      <p className="text-sm text-slate-600">
        승인 사진은 점검당 최대 12장입니다. 사진이나 가림 영역을 바꾸려면 새
        사진으로 저장해 주세요.
      </p>
      {inspectionId && photosLoading && (
        <output className="block text-base">
          저장된 사진을 불러오는 중입니다.
        </output>
      )}
      {(!inspectionId || !photosLoading) && !photos.length && (
        <p className="rounded-xl border bg-white p-5 text-sm">
          아직 준비한 보고서 사진이 없습니다.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {photos.map((photo) => (
          <section
            key={photo.id}
            className="space-y-3 rounded-2xl border bg-white p-4"
          >
            <ReportPhoto
              client={supabase}
              photo={photo}
              onVerified={() =>
                setVerified((v) =>
                  v[photo.id] ? v : { ...v, [photo.id]: true },
                )
              }
            />
            <p className="text-sm font-semibold">
              {
                {
                  pending: '승인 대기',
                  approved: '보고서 포함 승인',
                  excluded: '다음 보고서에서 제외',
                }[photo.status]
              }
            </p>
            {isOwner && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    busy || !verified[photo.id] || photo.status === 'approved'
                  }
                  onClick={() => void review(photo, true)}
                >
                  사진 확인·포함 승인
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || photo.status === 'excluded'}
                  onClick={() => void review(photo, false)}
                >
                  다음 보고서에서 제외
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
