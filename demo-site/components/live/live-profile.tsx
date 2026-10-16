'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  customerKinds,
  problem,
  serviceRpc,
  validateAccountDetails,
  type AccountDetails,
  type CustomerKind,
  type Onboarding,
} from '@/lib/service-access';
import { PolicyText } from './live-service-settings';
import { useDraftProtection } from '@/lib/use-draft-protection';

export function AccountProfile({
  supabase,
  organizationId,
  initial,
  required = false,
  onComplete,
}: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  initial?: Onboarding;
  required?: boolean;
  onComplete?: () => void;
}) {
  const [data, setData] = useState<Onboarding | null>(initial ?? null);
  const [details, setDetails] = useState<AccountDetails>(
    initial
      ? { ...initial.profile, kind: initial.profile.kind ?? 'individual' }
      : { name: '', phone: '', kind: 'individual' },
  );
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const lock = useRef(false);
  async function load(signal?: AbortSignal) {
    const d = await serviceRpc<Onboarding>(
      supabase,
      'get_service_onboarding',
      { p_org: organizationId },
      signal,
    );
    setData(d);
    setDetails({ ...d.profile, kind: d.profile.kind ?? 'individual' });
    return d;
  }
  useEffect(() => {
    if (initial) return;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    void load(c.signal)
      .catch((e) =>
        setError(
          c.signal.aborted
            ? '조회가 지연됩니다. 다시 시도해 주세요.'
            : problem(e),
        ),
      )
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [supabase, organizationId, initial]);
  const isClient = data?.role === 'client';
  const alreadyAccepted = Boolean(
    data?.policy &&
    data.consents.some((c) => c.version === data.policy?.version),
  );
  useDraftProtection(
    Boolean(data) &&
      JSON.stringify(details) !==
        JSON.stringify({
          ...data?.profile,
          kind: data?.profile.kind ?? 'individual',
        }),
    busy,
  );
  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current || !data) return;
    const p = validateAccountDetails(details, isClient);
    if (p) {
      setError(p);
      return;
    }
    if (data.policy && !alreadyAccepted && (!terms || !privacy)) {
      setError('이용약관과 개인정보 수집·이용 동의를 각각 확인해 주세요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await serviceRpc(supabase, 'complete_service_profile', {
        p_org: organizationId,
        p_details: {
          ...details,
          phone: details.phone.replace(/\D/g, ''),
          business_number: details.business_number?.replace(/\D/g, '') ?? '',
        },
        p_policy_id: data.policy?.id ?? null,
        p_accept: Boolean(data.policy && terms && privacy),
      });
      await load();
      setMessage('기본정보를 저장했습니다.');
      onComplete?.();
    } catch (e) {
      setError(problem(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function field(
    key: keyof AccountDetails,
    label: string,
    opts?: { max?: number; type?: string },
  ) {
    return (
      <label className="block space-y-2 text-sm font-medium">
        <span>{label}</span>
        <Input
          autoComplete={
            key === 'name' ? 'name' : key === 'phone' ? 'tel' : 'off'
          }
          inputMode={
            key === 'phone' || key === 'business_number' ? 'tel' : undefined
          }
          type={opts?.type ?? 'text'}
          required
          maxLength={opts?.max ?? 160}
          value={details[key] ?? ''}
          onChange={(e) => setDetails({ ...details, [key]: e.target.value })}
        />
      </label>
    );
  }
  return (
    <section className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm sm:p-7">
      <h2 className="text-xl font-bold">
        {required ? '기본정보·이용 동의' : '내 정보·이용 동의'}
      </h2>
      {required && (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          필요한 정보를 입력하고 현재 적용된 약관을 확인해 주세요.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 text-sm text-teal-800">
          {message}
        </p>
      )}
      {!data ? (
        <Button
          className="mt-4"
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
        <form className="mt-6 space-y-5" onSubmit={save}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {field('name', '이름 / 담당자 이름', { max: 80 })}
              {field('phone', '연락처', { max: 15, type: 'tel' })}
            </div>
            {isClient && (
              <>
                <label className="block space-y-2 text-sm font-medium">
                  <span>고객 구분</span>
                  <select
                    className="min-h-11 w-full rounded-lg border px-3"
                    value={details.kind ?? 'individual'}
                    onChange={(e) =>
                      setDetails({
                        ...details,
                        kind: e.target.value as CustomerKind,
                      })
                    }
                  >
                    {Object.entries(customerKinds).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {details.kind && details.kind !== 'individual' && (
                  <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                    {field('business_name', '상호 / 법인명')}
                    {field('business_number', '사업자등록번호', { max: 12 })}
                    {field('representative', '대표자 이름', { max: 80 })}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setDetails({ ...details, representative: details.name })
                      }
                    >
                      담당자와 동일
                    </Button>
                    <p className="text-xs leading-5 text-slate-500">
                      등록번호 검사는 입력 오류를 확인하는 절차이며, 실제
                      사업자·대표자 인증은 아닙니다. 기존 사업자 연결은 관리자
                      확인 후 적용됩니다.
                    </p>
                  </div>
                )}
              </>
            )}
            {data.policy ? (
              <section className="space-y-4 rounded-xl border p-4">
                <h3 className="font-bold">현재 약관 v{data.policy.version}</h3>
                <details>
                  <summary className="cursor-pointer text-sm text-teal-800">
                    이용약관·개인정보 내용 확인
                  </summary>
                  <div className="mt-4">
                    <PolicyText content={data.policy.content} />
                  </div>
                </details>
                {alreadyAccepted ? (
                  <p className="text-sm text-teal-800">
                    현재 버전에 동의했습니다.
                  </p>
                ) : (
                  <>
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        className="mt-1 size-4 shrink-0"
                        type="checkbox"
                        required
                        checked={terms}
                        onChange={(e) => setTerms(e.target.checked)}
                      />
                      <span>[필수] 이용약관에 동의합니다.</span>
                    </label>
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        className="mt-1 size-4 shrink-0"
                        type="checkbox"
                        required
                        checked={privacy}
                        onChange={(e) => setPrivacy(e.target.checked)}
                      />
                      <span>[필수] 개인정보 수집·이용에 동의합니다.</span>
                    </label>
                  </>
                )}
              </section>
            ) : (
              <p className="text-xs text-slate-500">
                서비스 이용약관은 운영주체 확정 후 안내됩니다.
              </p>
            )}
          </fieldset>
          <Button type="submit" disabled={busy}>
            {busy ? '저장 중' : required ? '저장하고 시작하기' : '내 정보 저장'}
          </Button>
          {data.customers.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-sm font-bold">연결된 고객</h3>
              {data.customers.map((c, i) => (
                <p className="mt-2 text-sm" key={i}>
                  {c.name} · {customerKinds[c.kind]}
                </p>
              ))}
            </div>
          )}
          {data.consents.length > 0 && (
            <details className="border-t pt-4">
              <summary className="cursor-pointer text-sm font-bold">
                내 동의 이력
              </summary>
              {data.consents.map((c) => (
                <details
                  className="mt-3 rounded-lg bg-slate-50 p-3"
                  key={c.version}
                >
                  <summary className="cursor-pointer text-sm">
                    v{c.version} ·{' '}
                    {new Date(c.accepted_at).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                    })}
                  </summary>
                  <div className="mt-4">
                    <PolicyText content={c.content} />
                  </div>
                </details>
              ))}
            </details>
          )}
        </form>
      )}
    </section>
  );
}
