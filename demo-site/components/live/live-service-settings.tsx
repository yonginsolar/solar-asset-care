'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  emptyServiceContent,
  serviceContentReady,
  problem,
  serviceRpc,
  type ServiceContent,
  type PublishedPolicy,
} from '@/lib/service-access';
import { useDraftProtection } from '@/lib/use-draft-protection';

const card = 'rounded-2xl border bg-white p-5 shadow-sm';
export function PolicyText({ content }: { content: ServiceContent }) {
  return (
    <div className="space-y-6 break-words text-sm leading-7">
      <dl>
        <dt className="font-bold">운영주체</dt>
        <dd>{content.operator_name || '미입력'}</dd>
        <dt className="mt-3 font-bold">문의 이메일</dt>
        <dd>{content.contact_email || '미입력'}</dd>
        <dt className="mt-3 font-bold">개인정보 담당 연락처</dt>
        <dd>{content.privacy_contact || '미입력'}</dd>
      </dl>
      <section>
        <h3 className="mb-2 font-bold">이용약관</h3>
        <p className="whitespace-pre-wrap">{content.terms || '작성 전'}</p>
      </section>
      <section>
        <h3 className="mb-2 font-bold">개인정보 수집·이용</h3>
        <p className="whitespace-pre-wrap">{content.privacy || '작성 전'}</p>
      </section>
    </div>
  );
}
type Config = {
  revision: number;
  draft: Partial<ServiceContent>;
  active_id: string | null;
  versions: PublishedPolicy[];
  members: Array<{
    user_id: string;
    name: string;
    role: string;
    status: string;
    profile_complete: boolean;
    accepted_at: string | null;
  }>;
};
export function ServiceSettingsView({
  supabase,
  organizationId,
  onPublished,
}: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  onPublished: () => void;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<ServiceContent>(emptyServiceContent);
  const [saved, setSaved] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [history, setHistory] = useState('');
  const lock = useRef(false);
  async function load(signal?: AbortSignal) {
    const r = await serviceRpc<Config>(
      supabase,
      'service_admin_action',
      { p_org: organizationId, p_action: 'settings.read' },
      signal,
    );
    const d = { ...emptyServiceContent, ...r.draft };
    setConfig(r);
    setDraft(d);
    setSaved(JSON.stringify(d));
  }
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    void load(c.signal)
      .catch((e) =>
        setError(
          c.signal.aborted
            ? '조회가 지연됩니다. 다시 불러와 주세요.'
            : problem(e),
        ),
      )
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(t);
      c.abort();
    };
    // Initial data only: never replace an edited draft through a background refresh.
  }, [supabase, organizationId]);
  const dirty = JSON.stringify(draft) !== saved;
  const canApply = Boolean(config?.revision) && serviceContentReady(draft);
  useDraftProtection(Boolean(config) && dirty && !busy);
  async function mutate(action: string) {
    if (lock.current || !config) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await serviceRpc(supabase, 'service_admin_action', {
        p_org: organizationId,
        p_action: action,
        p_payload: {
          revision: config.revision,
          ...(action === 'settings.save'
            ? { content: draft }
            : { confirm: 'APPLY' }),
        },
      });
      await load();
      setMessage(
        action === 'settings.save'
          ? '초안을 저장했습니다. 아직 이용자에게 적용되지 않았습니다.'
          : '새 약관을 적용했습니다.',
      );
      if (action === 'settings.publish') onPublished();
    } catch (e) {
      setError(problem(e));
    } finally {
      lock.current = false;
      setBusy(false);
      setConfirm(false);
    }
  }
  const historic = config?.versions.find((v) => v.id === history);
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-teal-700">SERVICE SETTINGS</p>
        <h1 className="mt-2 text-2xl font-bold">운영 설정·약관</h1>
        <p className="mt-2 text-sm text-slate-600">
          초안을 저장한 뒤 내용을 확인하고 적용해 주세요.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl bg-teal-50 p-4 text-sm text-teal-800"
        >
          {message}
        </p>
      )}
      {!config ? (
        <Button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load()
              .catch((e) => setError(problem(e)))
              .finally(() => setLoading(false));
          }}
        >
          {loading ? '불러오는 중' : '다시 불러오기'}
        </Button>
      ) : (
        <>
          <form
            className={card + ' space-y-5'}
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('settings.save');
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold">운영 정보·약관 초안</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                {config.active_id ? '적용된 약관 있음' : '아직 적용 전'}
              </span>
            </div>
            <fieldset disabled={busy} className="space-y-4">
              {(
                ['operator_name', 'contact_email', 'privacy_contact'] as const
              ).map((k, i) => (
                <label className="block space-y-2 text-sm font-medium" key={k}>
                  <span>
                    {
                      [
                        '운영주체 정식 명칭',
                        '문의 이메일',
                        '개인정보 담당 연락처',
                      ][i]
                    }
                  </span>
                  <Input
                    type={k === 'contact_email' ? 'email' : 'text'}
                    maxLength={200}
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
              {(['terms', 'privacy'] as const).map((k, i) => (
                <label className="block space-y-2 text-sm font-medium" key={k}>
                  <span>
                    {i === 0 ? '이용약관' : '개인정보 수집·이용 내용'}
                  </span>
                  <Textarea
                    rows={10}
                    maxLength={30000}
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.value })
                    }
                  />
                  <span className="block text-xs leading-5 text-slate-500">
                    {i === 0
                      ? '서비스 범위, 이용 절차, 책임과 문의 방법 등 확정된 내용을 입력해 주세요.'
                      : '수집 항목·목적·보유기간·동의 거부와 불이익 등 운영 기준을 확정해 입력해 주세요.'}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !dirty}>
                초안 저장
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreview(!preview)}
              >
                {preview ? '미리보기 닫기' : '초안 미리보기'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || dirty || !canApply}
                onClick={() => setConfirm(true)}
              >
                저장한 초안 적용
              </Button>
            </div>
            {dirty && (
              <p className="text-xs text-amber-800">
                저장하지 않은 변경사항이 있습니다.
              </p>
            )}
          </form>
          {preview && (
            <section className={card}>
              <h2 className="mb-5 font-bold">초안 미리보기 · 미적용</h2>
              <PolicyText content={draft} />
            </section>
          )}
          <section className={card}>
            <h2 className="font-bold">적용 이력</h2>
            {config.versions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                적용된 약관이 없습니다.
              </p>
            ) : (
              <>
                <select
                  aria-label="이전 약관 선택"
                  className="mt-4 min-h-11 w-full rounded-lg border px-3"
                  value={history}
                  onChange={(e) => setHistory(e.target.value)}
                >
                  <option value="">열람할 버전 선택</option>
                  {config.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version} ·{' '}
                      {new Date(v.published_at).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })}
                      {v.id === config.active_id ? ' · 현재 적용' : ''}
                    </option>
                  ))}
                </select>
                {historic && (
                  <div className="mt-5">
                    <PolicyText content={historic.content} />
                  </div>
                )}
              </>
            )}
          </section>
          <section className={card}>
            <h2 className="font-bold">계정 정보·현재 약관 동의 현황</h2>
            <div className="mt-4 divide-y">
              {config.members.map((m) => (
                <div
                  key={m.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="font-medium">
                    {m.name}{' '}
                    <span className="font-normal text-slate-500">
                      ·{' '}
                      {m.role === 'owner'
                        ? '관리자'
                        : m.role === 'expert'
                          ? '전문가'
                          : '고객'}
                    </span>
                  </span>
                  <span className="text-xs text-slate-600">
                    정보 {m.profile_complete ? '완료' : '미입력'} ·{' '}
                    {config.active_id
                      ? m.accepted_at
                        ? '동의 ' +
                          new Date(m.accepted_at).toLocaleDateString('ko-KR', {
                            timeZone: 'Asia/Seoul',
                          })
                        : '동의 필요'
                      : '약관 적용 전'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이 약관을 적용할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이용자에게 운영 정보와 약관이 공개됩니다. 관리자·전문가·고객 모두
              기본정보와 새 버전 동의를 완료해야 업무를 이용할 수 있습니다. 기존
              동의 이력은 보존됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void mutate('settings.publish')}
            >
              확인 후 적용
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
