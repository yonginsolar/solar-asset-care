'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { Button } from '@/components/ui/button';
import { problem } from '@/lib/service-access';
type EventRow = {
  id: number;
  occurred_at: string;
  action: string;
  entity_type: string;
  actor_user_id: string | null;
};
const actions: Record<string, string> = {
  'settings.save': '운영 설정 초안 저장',
  'settings.publish': '새 약관 적용',
  'customers.create': '고객 등록',
  'customers.link_contact': '고객 담당자 연결',
  'customers.unlink_contact': '고객 담당자 연결 해제',
  'customers.link_plant': '고객 발전소 연결',
  'customers.unlink_plant': '고객 발전소 연결 해제',
  'account.profile_completed': '기본정보·동의 처리',
  'organization.member_removed': '관리자 접근권한 해제',
  'organization.super_admin_transferred': '최고관리자 양도',
  'organization.member_updated': '계정 역할·상태 변경',
};
export function AuditView({
  supabase,
  organizationId,
}: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
}) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    let current = true;
    const timer = setTimeout(() => c.abort(), 20000);
    setLoading(true);
    setError('');
    void supabase
      .from('audit_events')
      .select('id,occurred_at,action,entity_type,actor_user_id')
      .eq('organization_id', organizationId)
      .order('occurred_at', { ascending: false })
      .limit(100)
      .abortSignal(c.signal)
      .then(({ data, error }) => {
        if (!current) return;
        if (error)
          setError(
            c.signal.aborted
              ? '조회가 지연됩니다. 다시 불러와 주세요.'
              : problem(error),
          );
        else setRows(data ?? []);
        setLoading(false);
      });
    return () => {
      current = false;
      clearTimeout(timer);
      c.abort();
    };
  }, [supabase, organizationId, retry]);
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-teal-700">AUDIT</p>
          <h1 className="mt-2 text-2xl font-bold">운영 이력</h1>
          <p className="mt-2 text-sm text-slate-500">
            최근 100건의 업무 변경 기록입니다.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRetry(retry + 1)}
        >
          다시 불러오기
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="divide-y rounded-2xl border bg-white px-5">
        {loading ? (
          <p role="status" className="py-8 text-sm text-slate-500">
            이력을 불러오는 중입니다.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-sm text-slate-500">표시할 이력이 없습니다.</p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div>
                <h2 className="text-sm font-semibold">
                  {actions[row.action] ?? row.action}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{row.entity_type}</p>
              </div>
              <time
                className="text-xs text-slate-500"
                dateTime={row.occurred_at}
              >
                {new Date(row.occurred_at).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}
              </time>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
