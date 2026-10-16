'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowUpRight,
  SunMedium,
  ClipboardCheck,
  FileText,
  ShieldCheck,
} from 'lucide-react';
const CallbackApp = dynamic(
  () => import('./live/live-app').then((m) => m.LiveApp),
  { ssr: false },
);
export function PublicHome() {
  const [callback, setCallback] = useState(false);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    setCallback(
      fragment.has('access_token') ||
        fragment.has('error') ||
        query.has('code'),
    );
  }, []);
  if (callback) return <CallbackApp />;
  return (
    <div className="min-h-svh bg-[#f6f8f7] text-slate-900">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold tracking-tight"
        >
          <SunMedium className="size-7 text-teal-700" />
          SolarScope
        </Link>
        <nav
          aria-label="서비스 메뉴"
          className="flex items-center gap-5 text-sm font-semibold"
        >
          <Link href="/guest" className="text-slate-600">
            샘플 둘러보기
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-teal-800 px-5 py-3 text-white"
          >
            로그인
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        <section className="relative overflow-hidden rounded-[2rem] bg-[#123e42] px-6 py-12 text-white sm:px-12 sm:py-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
            <div className="relative z-10">
              <p className="text-xs font-semibold tracking-[.22em] text-teal-200">
                SOLAR ASSET CARE
              </p>
              <h1 className="mt-6 text-4xl font-bold leading-[1.3] tracking-tight sm:text-5xl">
                발전소의 상태를
                <br />
                확인하고,
                <br />
                <span className="text-teal-200">다음 조치까지.</span>
              </h1>
              <p className="mt-6 max-w-md text-sm leading-7 text-teal-50/80 sm:text-base">
                열화상 점검 의뢰부터 전문가 검토, 진단 보고서와 후속 조치까지
                연결하는 태양광 자산관리 서비스입니다.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="inline-flex min-h-12 items-center gap-3 rounded-full bg-[#d5f4aa] px-6 text-sm font-bold text-[#163c30]"
                >
                  고객 회원가입 <ArrowUpRight className="size-4" />
                </Link>
                <Link
                  href="/client"
                  className="inline-flex min-h-12 items-center rounded-full border border-white/30 px-6 text-sm font-semibold"
                >
                  내 발전소 관리
                </Link>
              </div>
            </div>
            <div
              aria-hidden="true"
              className="relative mx-auto w-full max-w-sm py-5"
            >
              <div className="absolute inset-0 rounded-full bg-teal-300/10 blur-3xl" />
              <div className="relative rotate-[-8deg] rounded-2xl border border-teal-200/30 bg-[#0c292e] p-5 shadow-2xl">
                <div className="mb-4 flex items-center justify-between text-[10px] tracking-[.16em] text-teal-100/60">
                  <span>THERMAL INSPECTION</span>
                  <span>SC / 01</span>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {Array.from({ length: 36 }, (_, i) => (
                    <div
                      key={i}
                      className={
                        'aspect-[.75] rounded-sm border ' +
                        (i === 15
                          ? 'border-amber-200/70 bg-amber-300/80 ring-4 ring-amber-300/20'
                          : i % 7 === 0
                            ? 'border-teal-300/40 bg-teal-300/30'
                            : 'border-teal-400/20 bg-teal-500/10')
                      }
                    />
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-2 text-xs text-teal-100">
                  <span className="size-2 rounded-full bg-amber-300" /> 상대적인
                  색상 차이 확인
                </div>
              </div>
              <p className="mt-7 text-center text-[10px] tracking-widest text-teal-100/40">
                서비스 흐름을 설명하는 예시 그래픽
              </p>
            </div>
          </div>
        </section>
        <section className="py-14 sm:py-20">
          <p className="text-xs font-bold tracking-widest text-teal-800">
            HOW IT WORKS
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">
            복잡한 점검 과정을 한 흐름으로
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            {[
              [
                ClipboardCheck,
                '01',
                '발전소 등록·점검 의뢰',
                '발전소 정보를 등록하고 필요한 점검을 요청합니다.',
              ],
              [
                ShieldCheck,
                '02',
                '자료 분석·전문가 검토',
                '자체 알고리즘이 상대적 이상 후보를 찾고, 전문가가 촬영 조건과 근거를 검토합니다.',
              ],
              [
                FileText,
                '03',
                '보고서·후속 조치',
                '발행된 진단 보고서를 확인하고 필요한 조치와 업체 견적을 살펴봅니다.',
              ],
            ].map(([Icon, n, title, copy]) => {
              const I = Icon as typeof ClipboardCheck;
              return (
                <article
                  key={String(n)}
                  className="border-t border-slate-300 pt-5"
                >
                  <div className="flex items-center justify-between">
                    <I className="size-6 text-teal-800" />
                    <span className="text-xs font-semibold text-slate-400">
                      {String(n)}
                    </span>
                  </div>
                  <h3 className="mt-5 font-bold">{String(title)}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">
                    {String(copy)}
                  </p>
                </article>
              );
            })}
          </div>
          <p className="mt-8 text-xs leading-6 text-slate-500">
            일반 열화상 이미지의 색상 차이는 상대적 검토 자료입니다. 실제 온도와
            고장 원인 확정에는 원본 정보와 현장·전문가 확인이 필요합니다.
          </p>
        </section>
        <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border bg-white p-6 sm:p-8">
          <div>
            <h2 className="text-lg font-bold">처음 방문하셨나요?</h2>
            <p className="mt-2 text-sm text-slate-600">
              샘플 발전소와 출력 가능한 샘플 보고서를 먼저 확인하세요.
            </p>
          </div>
          <Link
            href="/guest"
            className="inline-flex min-h-11 items-center gap-3 text-sm font-bold text-teal-800"
          >
            게스트로 둘러보기 <ArrowUpRight className="size-4" />
          </Link>
        </section>
      </main>
      <footer className="border-t px-5 py-7">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-5 text-xs text-slate-500">
          <span>SolarScope · Solar Asset Care</span>
          <div className="flex flex-wrap gap-5">
            <Link href="/policy">이용약관·개인정보</Link>
            <Link href="/expert">전문가 작업실</Link>
            <Link href="/admin">관리자 운영센터</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
