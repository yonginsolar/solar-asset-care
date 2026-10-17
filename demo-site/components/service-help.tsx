'use client';
import { useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { startClientRead } from '@/lib/client-read';
import { serviceRpc, type PublishedPolicy } from '@/lib/service-access';

export function ServiceContact() {
  const client = useMemo(() => getSupabaseBrowserClient(), []);
  const [state, setState] = useState({
    email: '',
    loading: Boolean(client),
    failed: false,
  });
  const [attempt, setAttempt] = useState(0);
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
        success: (policy) => {
          const email = policy?.content.contact_email.trim() || '';
          setState({
            email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
            loading: false,
            failed: false,
          });
        },
        error: () => setState({ email: '', loading: false, failed: true }),
        settled: () => {},
      },
      15000,
    );
  }, [client, attempt]);
  if (state.loading) return <output>문의처를 확인하고 있습니다.</output>;
  if (state.failed || !client)
    return (
      <div>
        <p role="alert">문의처를 불러오지 못했습니다.</p>
        {client && (
          <button
            type="button"
            className="mt-2 min-h-11 font-semibold text-teal-800 underline"
            onClick={() => {
              setState({ email: '', loading: true, failed: false });
              setAttempt((n) => n + 1);
            }}
          >
            다시 확인
          </button>
        )}
      </div>
    );
  return state.email ? (
    <a
      href={`mailto:${state.email}`}
      className="break-all font-semibold text-teal-800 underline"
    >
      {state.email}
    </a>
  ) : (
    <p>
      아직 사이트에 문의처가 등록되지 않았습니다. 안내받은 담당자에게 문의해
      주세요.
    </p>
  );
}
