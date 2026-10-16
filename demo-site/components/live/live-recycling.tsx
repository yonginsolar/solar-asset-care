'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Download, FileCheck2, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Database, Tables } from '@/lib/supabase/database.types';
import {
  CERTIFICATE_MAX_BYTES,
  certificateFilename,
  certificateStatus,
} from '@/lib/recycling-certificate';
import { koreanDate } from '@/lib/operational-assessment';
import { useFormDraftProtection } from '@/lib/use-form-draft-protection';

type Certificate = Tables<'recycling_certificates'>;
type Client = SupabaseClient<Database>;
const inputClass =
  'h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-base';
const fieldClass = 'grid min-w-0 gap-2 text-sm font-semibold';
async function requestFile(client: Client, id: string, body?: FormData) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('다시 로그인해 주세요.');
  const response = await fetch(
    `/api/recycling-certificates${body ? '' : `?id=${encodeURIComponent(id)}`}`,
    {
      method: body ? 'POST' : 'GET',
      body,
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(
      result &&
        typeof result === 'object' &&
        'error' in result &&
        typeof result.error === 'string'
        ? result.error
        : '인증서 요청을 처리하지 못했습니다.',
    );
  }
  return response;
}

export function RecyclingView({
  supabase,
  organizationId,
  plants,
  isOwner,
}: {
  supabase: Client;
  organizationId: string;
  plants: Tables<'plants'>[];
  isOwner: boolean;
}) {
  const [rows, setRows] = useState<Certificate[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(''),
    [failed, setFailed] = useState(false),
    [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [plantFilter, setPlantFilter] = useState(''),
    [status, setStatus] = useState('');
  const [uploadId, setUploadId] = useState('');
  const draft = useFormDraftProtection(saving);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestSequence = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current.value;
    setLoading(true);
    setFailed(false);
    let request = supabase
      .from('recycling_certificates')
      .select('*', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .order('id');
    if (plantFilter) request = request.eq('plant_id', plantFilter);
    if (status && isOwner) request = request.eq('status', status);
    if (search)
      request = request.ilike(
        'title',
        `%${search.replace(/[\\%_]/g, '\\$&')}%`,
      );
    const result = await request.range(page * 20, page * 20 + 19);
    if (sequence !== requestSequence.current.value) return;
    if (result.error) {
      setRows([]);
      setTotal(0);
      setFailed(true);
      setNotice(
        '인증서 목록을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.',
      );
    } else {
      setRows(result.data || []);
      setTotal(result.count || 0);
    }
    setLoading(false);
  }, [supabase, organizationId, plantFilter, status, isOwner, search, page]);
  useEffect(() => {
    const sequence = requestSequence.current;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      sequence.value++;
    };
  }, [refresh]);
  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget,
      body = new FormData(form),
      file = body.get('file');
    if (!(file instanceof File) || !file.size) {
      setNotice('인증서 파일을 선택해 주세요.');
      return;
    }
    if (file.size > CERTIFICATE_MAX_BYTES) {
      setNotice('인증서는 10MB 이하로 준비해 주세요.');
      return;
    }
    const id = uploadId || crypto.randomUUID();
    setUploadId(id);
    body.set('id', id);
    setSaving(true);
    setNotice('인증서를 저장하는 중입니다.');
    try {
      await requestFile(supabase, id, body);
      form.reset();
      draft.markSaved();
      setUploadId('');
      setNotice(
        '등록했습니다. 파일을 내려받아 확인한 뒤 의뢰인에게 공개해 주세요.',
      );
      setSearch('');
      setQuery('');
      setPlantFilter('');
      setStatus('');
      setPage(0);
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : '등록하지 못했습니다. 입력한 내용은 그대로 유지됩니다.',
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">재활용 인증서</h1>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} /> 다시 불러오기
        </Button>
      </div>
      {notice && (
        <output className="break-words rounded-xl border border-teal-200 bg-teal-50 p-4 text-base text-teal-950">
          {notice}
        </output>
      )}
      {isOwner && (
        <details
          className="rounded-2xl border bg-white p-4 sm:p-5"
          open={plants.length === 0 ? false : undefined}
        >
          <summary className="cursor-pointer py-2 text-base font-bold">
            인증서 등록
          </summary>
          {!plants.length ? (
            <p className="mt-3 text-base text-slate-600">
              먼저 발전소를 등록해 주세요.
            </p>
          ) : (
            <form
              ref={draft.ref}
              onInput={draft.onInput}
              onChange={draft.onChange}
              onSubmit={upload}
              className="mt-4 grid gap-4 sm:grid-cols-2"
            >
              <fieldset disabled={saving} className="contents">
                <label className={fieldClass}>
                  발전소
                  <select
                    name="plantId"
                    required
                    className={inputClass}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      발전소 선택
                    </option>
                    {plants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={fieldClass} htmlFor="certificate-title">
                  제목
                  <Input
                    id="certificate-title"
                    name="title"
                    required
                    maxLength={160}
                    className={inputClass}
                  />
                </label>
                <label className={fieldClass} htmlFor="certificate-issuer">
                  발급기관
                  <Input
                    id="certificate-issuer"
                    name="issuer"
                    required
                    maxLength={120}
                    className={inputClass}
                  />
                </label>
                <label className={fieldClass} htmlFor="certificate-number">
                  인증서 번호 (선택)
                  <Input
                    id="certificate-number"
                    name="number"
                    maxLength={120}
                    className={inputClass}
                  />
                </label>
                <label className={fieldClass} htmlFor="certificate-issuedOn">
                  발급일
                  <Input
                    id="certificate-issuedOn"
                    name="issuedOn"
                    type="date"
                    required
                    min="1900-01-01"
                    max={koreanDate()}
                    className={inputClass}
                  />
                </label>
                <label className={fieldClass} htmlFor="certificate-panelCount">
                  처리 패널 수 (선택)
                  <Input
                    id="certificate-panelCount"
                    name="panelCount"
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    className={inputClass}
                  />
                </label>
                <label
                  className={`${fieldClass} sm:col-span-2`}
                  htmlFor="certificate-file"
                >
                  인증서 파일
                  <Input
                    ref={fileInput}
                    id="certificate-file"
                    name="file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    required
                    className="h-auto min-h-11 min-w-0 py-2 text-base"
                    onChange={() => setUploadId('')}
                  />
                  <span className="font-normal text-slate-600">
                    PDF·JPG·PNG, 10MB 이하. 발급받은 파일을 등록하며 사이트에서
                    인증서를 발급하지는 않습니다.
                  </span>
                </label>
                <Button
                  type="submit"
                  disabled={saving}
                  className="min-h-11 sm:col-span-2"
                >
                  {saving ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FileCheck2 />
                  )}
                  {saving ? '등록 중…' : '확인 대기로 등록'}
                </Button>
              </fieldset>
            </form>
          )}
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query.trim());
          setPage(0);
        }}
        className="grid gap-3 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className={fieldClass} htmlFor="certificate-search">
          제목 검색
          <Input
            id="certificate-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={160}
            className={inputClass}
          />
        </label>
        <label className={fieldClass}>
          발전소 필터
          <select
            value={plantFilter}
            onChange={(e) => {
              setPlantFilter(e.target.value);
              setPage(0);
            }}
            className={inputClass}
          >
            <option value="">전체 발전소</option>
            {plants.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {isOwner && (
          <label className={fieldClass}>
            공개 상태
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              className={inputClass}
            >
              <option value="">전체 상태</option>
              {Object.entries(certificateStatus).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" className="min-h-11 self-end">
          검색
        </Button>
      </form>
      {loading ? (
        <output className="py-6 text-base">인증서를 불러오는 중입니다.</output>
      ) : failed ? null : rows.length === 0 ? (
        <p className="rounded-2xl border bg-white p-6 text-base text-slate-600">
          {search || plantFilter || status
            ? '검색 조건에 맞는 인증서가 없습니다.'
            : isOwner
              ? '등록된 인증서가 없습니다.'
              : '조회할 수 있는 재활용 인증서가 없습니다.'}
        </p>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            총 {total.toLocaleString('ko-KR')}건
          </p>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {rows.map((row) => (
              <CertificateCard
                key={`${row.id}-${row.revision}`}
                row={row}
                plants={plants}
                plantName={
                  plants.find((p) => p.id === row.plant_id)?.name || '발전소'
                }
                supabase={supabase}
                isOwner={isOwner}
                onChanged={refresh}
                onNotice={setNotice}
              />
            ))}
          </div>
        </>
      )}
      {total > 20 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={loading || page === 0}
            onClick={() => setPage(page - 1)}
          >
            이전
          </Button>
          <span className="text-base">
            {page + 1} / {Math.ceil(total / 20)}
          </span>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={loading || (page + 1) * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            다음
          </Button>
        </div>
      )}
    </section>
  );
}

function CertificateCard({
  row,
  plants,
  plantName,
  supabase,
  isOwner,
  onChanged,
  onNotice,
}: {
  row: Certificate;
  plants: Tables<'plants'>[];
  plantName: string;
  supabase: Client;
  isOwner: boolean;
  onChanged: () => Promise<void>;
  onNotice: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [downloaded, setDownloaded] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [reason, setReason] = useState('');
  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await requestFile(supabase, row.id),
        blob = await response.blob(),
        url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = certificateFilename(row.id, row.mime_type);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setDownloaded(true);
      onNotice('인증서 파일을 내려받았습니다.');
    } catch (e) {
      setDownloaded(false);
      setConfirmed(false);
      onNotice(e instanceof Error ? e.message : '다운로드하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }
  async function review(publish: boolean) {
    if (busy || !reason.trim() || (publish && (!downloaded || !confirmed)))
      return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('review_recycling_certificate', {
        p_id: row.id,
        p_revision: row.revision,
        p_sha256: row.sha256,
        p_publish: publish,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      onNotice(
        publish
          ? '해당 발전소 의뢰인에게 공개했습니다.'
          : '인증서를 회수했습니다. 새 조회·다운로드는 차단됩니다. 이미 내려받은 사본은 삭제되지 않습니다.',
      );
      await onChanged();
    } catch (e) {
      onNotice(
        typeof e === 'object' && e && 'message' in e
          ? String(e.message)
          : '처리하지 못했습니다. 다시 불러온 뒤 시도해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function correct(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget),
      text = (key: string) => {
        const value = form.get(key);
        return typeof value === 'string' ? value.trim() : '';
      };
    setBusy(true);
    try {
      const { error } = await supabase.rpc('correct_recycling_certificate', {
        p_id: row.id,
        p_revision: row.revision,
        p_plant_id: text('plantId'),
        p_title: text('title'),
        p_issuer: text('issuer'),
        p_number: text('number'),
        p_issued_on: text('issuedOn'),
        p_panel_count: text('panelCount') ? Number(text('panelCount')) : null,
        p_reason: text('reason'),
      });
      if (error) throw error;
      onNotice(
        '정보를 수정하고 확인 대기로 돌렸습니다. 파일과 수정 내용을 다시 확인한 뒤 공개해 주세요.',
      );
      await onChanged();
    } catch (e) {
      onNotice(
        typeof e === 'object' && e && 'message' in e
          ? String(e.message)
          : '정보를 수정하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-lg font-bold">{row.title}</h2>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${row.status === 'published' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-700'}`}
        >
          {certificateStatus[row.status as keyof typeof certificateStatus]}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-base">
        <dt className="text-slate-500">발전소</dt>
        <dd className="break-words">{plantName}</dd>
        <dt className="text-slate-500">발급기관</dt>
        <dd className="break-words">{row.issuer}</dd>
        <dt className="text-slate-500">발급일</dt>
        <dd>{row.issued_on}</dd>
        {row.certificate_number && (
          <>
            <dt className="text-slate-500">인증서 번호</dt>
            <dd className="break-all">{row.certificate_number}</dd>
          </>
        )}
        {row.panel_count !== null && (
          <>
            <dt className="text-slate-500">패널 수</dt>
            <dd>{row.panel_count.toLocaleString('ko-KR')}장</dd>
          </>
        )}
      </dl>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Download />} 인증서
        다운로드
      </Button>
      {isOwner && (
        <div className="grid gap-3 border-t pt-4">
          {row.status !== 'published' && (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer py-2 text-base font-semibold">
                등록 정보 수정
              </summary>
              <form onSubmit={correct} className="mt-3 grid gap-3">
                <fieldset disabled={busy} className="contents">
                  <label
                    className={fieldClass}
                    htmlFor={`edit-plant-${row.id}`}
                  >
                    대상 발전소
                    <select
                      id={`edit-plant-${row.id}`}
                      name="plantId"
                      className={inputClass}
                      defaultValue={row.plant_id}
                      required
                    >
                      {plants.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-title-${row.id}`}
                  >
                    제목 수정
                    <Input
                      id={`edit-title-${row.id}`}
                      name="title"
                      defaultValue={row.title}
                      required
                      maxLength={160}
                      className={inputClass}
                    />
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-issuer-${row.id}`}
                  >
                    발급기관 수정
                    <Input
                      id={`edit-issuer-${row.id}`}
                      name="issuer"
                      defaultValue={row.issuer}
                      required
                      maxLength={120}
                      className={inputClass}
                    />
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-number-${row.id}`}
                  >
                    인증서 번호 수정
                    <Input
                      id={`edit-number-${row.id}`}
                      name="number"
                      defaultValue={row.certificate_number}
                      maxLength={120}
                      className={inputClass}
                    />
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-issued-${row.id}`}
                  >
                    발급일 수정
                    <Input
                      id={`edit-issued-${row.id}`}
                      name="issuedOn"
                      type="date"
                      defaultValue={row.issued_on}
                      required
                      min="1900-01-01"
                      max={koreanDate()}
                      className={inputClass}
                    />
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-count-${row.id}`}
                  >
                    처리 패널 수 수정
                    <Input
                      id={`edit-count-${row.id}`}
                      name="panelCount"
                      type="number"
                      defaultValue={row.panel_count ?? ''}
                      min={1}
                      max={1000000}
                      step={1}
                      className={inputClass}
                    />
                  </label>
                  <label
                    className={fieldClass}
                    htmlFor={`edit-reason-${row.id}`}
                  >
                    수정 사유
                    <Textarea
                      id={`edit-reason-${row.id}`}
                      name="reason"
                      required
                      minLength={2}
                      maxLength={500}
                      className="text-base"
                    />
                  </label>
                  <Button type="submit" className="min-h-11" disabled={busy}>
                    수정하고 재확인
                  </Button>
                </fieldset>
              </form>
            </details>
          )}
          {row.status !== 'published' && (
            <label
              className="flex min-h-11 items-start gap-3 text-sm leading-6"
              htmlFor={`certificate-confirm-${row.id}`}
            >
              <Checkbox
                id={`certificate-confirm-${row.id}`}
                checked={confirmed}
                disabled={!downloaded || busy}
                onCheckedChange={setConfirmed}
                className="mt-1"
              />
              파일을 열어 발급기관·대상 발전소·개인정보 공개 범위를
              확인했습니다.
            </label>
          )}
          <label
            className={fieldClass}
            htmlFor={`certificate-reason-${row.id}`}
          >
            {row.status === 'published' ? '회수 사유' : '확인 내용'}
            <Textarea
              id={`certificate-reason-${row.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={2}
              maxLength={500}
              disabled={busy}
              className="min-h-20 text-base"
            />
          </label>
          <Button
            type="button"
            variant={row.status === 'published' ? 'destructive' : 'default'}
            className="min-h-11"
            disabled={
              busy ||
              reason.trim().length < 2 ||
              (row.status !== 'published' && (!downloaded || !confirmed))
            }
            onClick={() => void review(row.status !== 'published')}
          >
            {row.status === 'published' ? '공개 회수' : '의뢰인에게 공개'}
          </Button>
          {!downloaded && row.status !== 'published' && (
            <p className="text-sm text-slate-600">
              먼저 인증서를 내려받아 내용을 확인해 주세요.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
