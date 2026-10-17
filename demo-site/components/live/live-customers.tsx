'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { startClientRead } from '@/lib/client-read';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables, Json } from '@/lib/supabase/database.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  customerKinds,
  businessNumberValid,
  problem,
  serviceRpc,
  type CustomerKind,
  type AccountDetails,
} from '@/lib/service-access';
import { useDraftProtection } from '@/lib/use-draft-protection';
import { ErrorNotice } from './error-notice';
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
type Customer = {
  id: string;
  kind: CustomerKind;
  name: string;
  business_number: string | null;
  representative: string | null;
  revision: number;
};
type Contact = { customer_id: string; user_id: string; active: boolean };
type Data = {
  customers: Customer[];
  contacts: Contact[];
  plants: Array<{ customer_id: string; plant_id: string }>;
  applicants: Array<{
    user_id: string;
    name: string;
    email: string;
    details: AccountDetails | null;
  }>;
};
const card = 'rounded-2xl border bg-white p-5 shadow-sm';
export function CustomersView({
  supabase,
  organizationId,
  plants,
}: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  plants: Tables<'plants'>[];
}) {
  const [data, setData] = useState<Data | null>(null);
  const fieldId = useId();
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [error, setErrorState] = useState('');
  const [errorAttempt, setErrorAttempt] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const setError = useCallback((message: string) => {
    setErrorState(message);
    if (message) setErrorAttempt((n) => n + 1);
  }, []);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [kind, setKind] = useState<CustomerKind>('individual');
  const [name, setName] = useState('');
  const [bn, setBn] = useState('');
  const [representative, setRepresentative] = useState('');
  const [user, setUser] = useState('');
  const [plant, setPlant] = useState('');
  const [pending, setPending] = useState<{
    action: string;
    payload: Record<string, Json>;
    label: string;
  } | null>(null);
  useDraftProtection(Boolean(name || bn || representative), busy);
  const read = useCallback(
    (signal?: AbortSignal) =>
      serviceRpc<Data>(
        supabase,
        'service_admin_action',
        { p_org: organizationId, p_action: 'customers.read' },
        signal,
      ),
    [supabase, organizationId],
  );
  async function load() {
    setData(await read());
  }
  useEffect(() => {
    return startClientRead(read, {
      success: setData,
      error: (e, timedOut) =>
        setError(
          timedOut ? '조회가 지연됩니다. 다시 불러와 주세요.' : problem(e),
        ),
      settled: () => setLoading(false),
    });
  }, [read, setError]);
  const current = data?.customers.find((c) => c.id === selected);
  async function act(action: string, payload: Record<string, Json>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await serviceRpc(supabase, 'service_admin_action', {
        p_org: organizationId,
        p_action: action,
        p_payload: payload,
      });
      await load();
      setMessage('저장했습니다.');
      if (action === 'customers.create') {
        setName('');
        setBn('');
        setRepresentative('');
      }
    } catch (e) {
      setError(problem(e));
    } finally {
      lock.current = false;
      setBusy(false);
      setPending(null);
    }
  }
  const options =
    data?.customers.filter((c) =>
      [c.name, c.business_number, c.representative]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  function revision() {
    return { customer_id: current!.id, revision: current!.revision };
  }
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold text-teal-700">CUSTOMERS</p>
        <h1 className="mt-2 text-2xl font-bold">고객 관리</h1>
        <p className="mt-2 text-sm text-slate-600">
          고객과 담당자 계정·발전소를 연결합니다. 담당자는 각자 로그인합니다.
        </p>
      </div>
      {error && (
        <ErrorNotice
          message={error}
          identity={errorAttempt}
          finalFocus={!name.trim() ? nameRef : undefined}
        />
      )}
      {message && (
        <output className="block text-sm text-teal-800">{message}</output>
      )}
      {!data ? (
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
          <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr]">
            <section className={card}>
              <h2 className="font-bold">고객 목록</h2>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(query);
                }}
              >
                <Input
                  aria-label="고객 검색"
                  placeholder="고객명·등록번호·대표자"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button type="submit" variant="outline">
                  검색
                </Button>
              </form>
              <div className="mt-4 space-y-2">
                {options.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    등록된 고객이 없습니다.
                  </p>
                ) : (
                  options.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      disabled={busy}
                      onClick={() => {
                        setSelected(c.id);
                        setUser('');
                        setPlant('');
                      }}
                      className={
                        'w-full rounded-xl border p-4 text-left ' +
                        (c.id === selected
                          ? 'border-teal-500 bg-teal-50'
                          : 'hover:bg-slate-50')
                      }
                    >
                      <strong className="block break-words text-sm">
                        {c.name}
                      </strong>
                      <span className="mt-1 block text-xs text-slate-500">
                        {customerKinds[c.kind]}
                        {c.business_number ? ' · ' + c.business_number : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
            <section className={card}>
              <h2 className="font-bold">{current?.name ?? '고객 연결'}</h2>
              {!current ? (
                <p className="mt-4 text-sm text-slate-500">
                  고객을 선택하면 담당자와 발전소를 연결할 수 있습니다.
                </p>
              ) : (
                <div className="mt-5 space-y-6">
                  <div>
                    <h3 className="text-sm font-bold">담당자 계정</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      연결하면 이 고객에 배정된 발전소·점검·발행 보고서에
                      접근합니다. 실제 담당자인지 확인 후 연결해 주세요.
                    </p>
                    {data.contacts
                      .filter((c) => c.customer_id === current.id && c.active)
                      .map((c) => (
                        <div
                          key={c.user_id}
                          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"
                        >
                          <span>
                            {data.applicants.find(
                              (a) => a.user_id === c.user_id,
                            )?.name ?? '비활성 계정'}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                action: 'customers.unlink_contact',
                                payload: { ...revision(), user_id: c.user_id },
                                label:
                                  '이 담당자와 고객의 연결을 해제할까요? 고객 자료와 다른 담당자 계정은 보존되며, 별도로 부여된 개인 발전소 권한은 유지됩니다.',
                              })
                            }
                          >
                            연결 해제
                          </Button>
                        </div>
                      ))}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <select
                        aria-label="연결할 담당자"
                        className="min-h-11 min-w-0 flex-1 rounded-lg border px-3"
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                      >
                        <option value="">담당자 선택</option>
                        {data.applicants
                          .filter(
                            (a) =>
                              !data.contacts.some(
                                (c) =>
                                  c.customer_id === current.id &&
                                  c.user_id === a.user_id &&
                                  c.active,
                              ),
                          )
                          .map((a) => (
                            <option key={a.user_id} value={a.user_id}>
                              {a.name} · {a.email}
                            </option>
                          ))}
                      </select>
                      <Button
                        disabled={busy || !user}
                        onClick={() =>
                          setPending({
                            action: 'customers.link_contact',
                            payload: { ...revision(), user_id: user },
                            label:
                              '선택한 계정을 이 고객의 담당자로 승인할까요? 연결된 고객 발전소 자료의 접근권한이 부여됩니다.',
                          })
                        }
                      >
                        담당자 연결
                      </Button>
                    </div>
                  </div>
                  <div className="border-t pt-5">
                    <h3 className="text-sm font-bold">고객 발전소</h3>
                    {data.plants
                      .filter((p) => p.customer_id === current.id)
                      .map((p) => (
                        <div
                          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"
                          key={p.plant_id}
                        >
                          <span>
                            {plants.find((x) => x.id === p.plant_id)?.name ??
                              '발전소'}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                action: 'customers.unlink_plant',
                                payload: {
                                  ...revision(),
                                  plant_id: p.plant_id,
                                },
                                label:
                                  '고객과 발전소의 연결을 해제할까요? 발전소와 점검 원본은 삭제하지 않습니다.',
                              })
                            }
                          >
                            연결 해제
                          </Button>
                        </div>
                      ))}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <select
                        aria-label="연결할 발전소"
                        className="min-h-11 min-w-0 flex-1 rounded-lg border px-3"
                        value={plant}
                        onChange={(e) => setPlant(e.target.value)}
                      >
                        <option value="">발전소 선택</option>
                        {plants
                          .filter(
                            (p) =>
                              !data.plants.some(
                                (x) =>
                                  x.customer_id === current.id &&
                                  x.plant_id === p.id,
                              ),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                      <Button
                        disabled={busy || !plant}
                        onClick={() =>
                          setPending({
                            action: 'customers.link_plant',
                            payload: { ...revision(), plant_id: plant },
                            label:
                              '선택한 발전소를 이 고객에게 연결할까요? 연결된 활성 담당자들이 접근할 수 있습니다.',
                          })
                        }
                      >
                        발전소 연결
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
          <form
            className={card + ' space-y-4'}
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                setError(
                  kind === 'individual'
                    ? '고객명을 입력해 주세요.'
                    : '상호 / 법인명을 입력해 주세요.',
                );
                return;
              }
              if (kind !== 'individual' && !businessNumberValid(bn)) {
                setError('사업자등록번호를 확인해 주세요.');
                return;
              }
              void act('customers.create', {
                kind,
                name: name.trim(),
                business_number: bn,
                representative,
              });
            }}
          >
            <h2 className="font-bold">고객 등록</h2>
            <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="block">고객 구분</span>
                <select
                  className="min-h-11 w-full rounded-lg border px-3"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as CustomerKind)}
                >
                  {Object.entries(customerKinds).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="block">
                  {kind === 'individual' ? '고객명' : '상호 / 법인명'}
                </span>
                <Input
                  ref={nameRef}
                  required
                  maxLength={160}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {kind !== 'individual' && (
                <>
                  <label
                    htmlFor={`${fieldId}-business-number`}
                    className="space-y-2 text-sm"
                  >
                    <span className="block">사업자등록번호</span>
                    <Input
                      id={`${fieldId}-business-number`}
                      required
                      maxLength={12}
                      value={bn}
                      onChange={(e) => setBn(e.target.value)}
                      inputMode="numeric"
                    />
                  </label>
                  <label
                    htmlFor={`${fieldId}-representative`}
                    className="space-y-2 text-sm"
                  >
                    <span className="block">대표자 (선택)</span>
                    <Input
                      id={`${fieldId}-representative`}
                      maxLength={80}
                      value={representative}
                      onChange={(e) => setRepresentative(e.target.value)}
                    />
                  </label>
                </>
              )}
            </fieldset>
            <Button type="submit" disabled={busy}>
              고객 등록
            </Button>
          </form>
          <section className={card}>
            <h2 className="font-bold">가입 고객·담당자 신청정보</h2>
            <div className="mt-4 divide-y">
              {data.applicants.length === 0 ? (
                <p className="text-sm text-slate-500">
                  가입한 고객이 없습니다.
                </p>
              ) : (
                data.applicants.map((a) => (
                  <div className="py-4 text-sm" key={a.user_id}>
                    <strong>{a.name}</strong>
                    <span className="ml-2 break-all text-slate-500">
                      {a.email}
                    </span>
                    <p className="mt-2 text-xs leading-6 text-slate-600">
                      {a.details
                        ? `${customerKinds[a.details.kind ?? 'individual']} · ${a.details.phone}${a.details.business_name ? ' · ' + a.details.business_name + ' · ' + a.details.business_number + (a.details.representative ? ' · 대표 ' + a.details.representative : '') : ''}`
                        : '기본정보 미입력'}
                    </p>
                    {a.details && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={busy}
                        onClick={() => {
                          setKind(a.details!.kind ?? 'individual');
                          setName(a.details!.business_name ?? a.details!.name);
                          setBn(a.details!.business_number ?? '');
                          setRepresentative(a.details!.representative ?? '');
                        }}
                      >
                        등록 양식에 가져오기
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}
      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>고객 연결 변경</AlertDialogTitle>
            <AlertDialogDescription>{pending?.label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (pending) void act(pending.action, pending.payload);
              }}
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
