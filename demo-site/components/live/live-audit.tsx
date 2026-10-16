'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { Button } from '@/components/ui/button';
import { problem } from '@/lib/service-access';
import {
  auditLabels,
  type AuditContext,
  type AuditEntry,
} from '@/lib/audit-display';
import { loadAuditContext } from '@/lib/audit-context';
export function AuditView({
  supabase,
  organizationId,
}: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
}) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [context, setContext] = useState<AuditContext>({
    actors: {},
    targets: {},
    partial: false,
  });
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
      .select('id,occurred_at,action,entity_type,entity_id,actor_user_id')
      .eq('organization_id', organizationId)
      .order('occurred_at', { ascending: false })
      .limit(100)
      .abortSignal(c.signal)
      .then(async ({ data, error }) => {
        if (!current) return;
        if (error)
          setError(
            c.signal.aborted
              ? '조회가 지연됩니다. 다시 불러와 주세요.'
              : problem(error),
          );
        else {
          setRows(data ?? []);
          const labels = await loadAuditContext(
            supabase,
            organizationId,
            data ?? [],
            c.signal,
          );
          if (current) setContext(labels);
        }
        if (current) setLoading(false);
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
      {!loading && context.partial && (
        <p role="status" className="mb-4 text-sm text-amber-800">
          일부 항목 이름을 불러오지 못해 기록번호로 표시합니다. 다시 불러올 수
          있습니다.
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
          rows.map((row) => {
            const labels = auditLabels(row, context);
            return (
              <article
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-4"
              >
                <div>
                  <h2 className="break-words text-sm font-semibold">
                    {labels.action}
                  </h2>
                  <p className="mt-1 break-words text-sm text-slate-600">
                    {labels.target}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    작업자: {labels.actor}
                  </p>
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
            );
          })
        )}
      </div>
    </section>
  );
}
