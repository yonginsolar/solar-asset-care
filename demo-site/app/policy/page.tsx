'use client';
import { useEffect, useMemo, useState } from 'react';
import { startClientRead } from '@/lib/client-read';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  serviceRpc,
  problem,
  type PublishedPolicy,
} from '@/lib/service-access';
import { PolicyText } from '@/components/live/live-service-settings';
export default function PolicyPage() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [policy, setPolicy] = useState<PublishedPolicy | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!client) return;
    return startClientRead(
      (signal) =>
        serviceRpc<PublishedPolicy | null>(
          client,
          'get_public_service_policy',
          {},
          signal,
        ),
      {
        success: setPolicy,
        error: (e, timedOut) =>
          setError(
            timedOut ? '조회가 지연됩니다. 다시 시도해 주세요.' : problem(e),
          ),
        settled: () => setLoading(false),
      },
      15000,
    );
  }, [client]);
  return (
    <main className="min-h-svh bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-3xl rounded-3xl border bg-white p-6 sm:p-10">
        <Link href="/" className="font-bold text-teal-800">
          SolarScope
        </Link>
        <h1 className="mt-8 text-2xl font-bold">이용약관·개인정보</h1>
        {!client || error ? (
          <p role="alert" className="mt-5 text-sm text-red-800">
            {!client ? '서비스 연결을 확인해 주세요.' : error}
          </p>
        ) : loading ? (
          <p className="mt-5 text-sm">불러오는 중</p>
        ) : policy ? (
          <div className="mt-6">
            <p className="mb-6 text-xs text-slate-500">
              적용 버전 v{policy.version} ·{' '}
              {new Date(policy.published_at).toLocaleDateString('ko-KR', {
                timeZone: 'Asia/Seoul',
              })}
            </p>
            <PolicyText content={policy.content} />
          </div>
        ) : (
          <p className="mt-6 text-sm leading-7 text-slate-600">
            운영주체와 이용약관을 준비 중입니다. 확정된 내용은 이 페이지에서
            안내합니다.
          </p>
        )}
      </section>
    </main>
  );
}
