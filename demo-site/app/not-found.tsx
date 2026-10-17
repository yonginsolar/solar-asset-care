import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-slate-50 px-4 py-10 text-slate-900">
      <section className="w-full max-w-lg space-y-5 rounded-3xl border bg-white p-7">
        <p className="text-sm font-semibold text-teal-700">SolarScope · 404</p>
        <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="text-sm leading-7 text-slate-600">
          주소가 변경되었거나 올바르지 않습니다. 홈이나 내 작업공간에서 다시
          확인해 주세요.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-xl bg-teal-800 px-5 text-sm font-semibold text-white"
          >
            홈으로 이동
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-xl border px-5 text-sm font-semibold"
          >
            내 작업공간
          </Link>
          <Link
            href="/help"
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-teal-800 underline"
          >
            이용 안내·문의
          </Link>
        </div>
      </section>
    </main>
  );
}
