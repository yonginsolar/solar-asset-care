'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  serviceRpc,
  problem,
  type PublishedPolicy,
} from '@/lib/service-access';
import { PolicyText } from '@/components/live/live-service-settings';
export default function PolicyPage() {
  const [policy, setPolicy] = useState<PublishedPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError('서비스 연결을 확인해 주세요.');
      setLoading(false);
      return;
    }
    void serviceRpc<PublishedPolicy | null>(
      client,
      'get_public_service_policy',
      {},
      c.signal,
    )
      .then(setPolicy)
      .catch((e) => setError(problem(e)))
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, []);
  return (
    <main className="min-h-svh bg-slate-50 px-4 py-10">
      <section className="mx-auto max-w-3xl rounded-3xl border bg-white p-6 sm:p-10">
        <Link href="/" className="font-bold text-teal-800">
          SolarScope
        </Link>
        <h1 className="mt-8 text-2xl font-bold">이용약관·개인정보</h1>
        {error ? (
          <p role="alert" className="mt-5 text-sm text-red-800">
            {error}
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
