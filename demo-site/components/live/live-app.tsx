'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type SyntheticEvent,
} from 'react';
import Link from 'next/link';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  Handshake,
  ImageIcon,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  SunMedium,
  ThermometerSun,
  UploadCloud,
  Users,
  Wrench,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  saveOriginal,
  originalImageType as verifiedImageType,
} from '@/lib/original-upload';
import { Textarea } from '@/components/ui/textarea';
import { backendConfig, getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Database, Json, Tables } from '@/lib/supabase/database.types';
import { AssessmentsView, CalculationSettingsView } from './live-assessments';
import { FindingsEditorView } from './live-findings';
import { ReportImagesView } from './live-report-images';
import { RecyclingView } from './live-recycling';
import { requestReportPdf } from '@/lib/report-download';
import { koreanDate, parseKoreanInput } from '@/lib/operational-assessment';

type Plant = Tables<'plants'>;
type Inspection = Tables<'inspections'>;
type InspectionFile = Tables<'inspection_files'>;
type AnalysisRun = Tables<'analysis_runs'>;
type Finding = Tables<'findings'>;
type Report = Tables<'reports'>;
type Maintenance = Tables<'maintenance_requests'>;
type Partner = Tables<'partners'>;
type PartnerPrivateDetails = Tables<'partner_private_details'>;
type PartnerQuote = Tables<'partner_quotes'>;
type QuoteRequest = Tables<'quote_requests'>;
type PlantRequester = Tables<'plant_requesters'>;
type Membership = Tables<'organization_members'>;
type Organization = Tables<'organizations'>;
type Profile = Tables<'profiles'>;

type Workspace = {
  organization: Organization;
  membership: Membership;
};

type View =
  | 'dashboard'
  | 'plants'
  | 'inspections'
  | 'files'
  | 'report-images'
  | 'recycling'
  | 'findings'
  | 'assessments'
  | 'calculation-settings'
  | 'reports'
  | 'maintenance'
  | 'partners'
  | 'members'
  | 'account';

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

type AnalysisResult = {
  disclaimer: string;
  summary: {
    heatIndex: number;
    contrast: number;
    hotCandidates: number;
    coldCandidates: number;
  };
  regions: Array<{
    id: string;
    kind: 'hot' | 'cold';
    x: number;
    y: number;
    width: number;
    height: number;
    areaPercent: number;
    score: number;
  }>;
  analyzedAt: string;
};

const inspectionStatuses = [
  ['requested', '접수'],
  ['scheduled', '일정 확정'],
  ['uploading', '자료 업로드'],
  ['quality_review', '품질 검토'],
  ['analysis', '규칙 분석'],
  ['expert_review', '전문가 판정'],
  ['approval', '승인 대기'],
  ['published', '발행'],
  ['closed', '종료'],
  ['cancelled', '취소'],
] as const;

const reportStatuses = [
  ['draft', '작성 중'],
  ['review', '검토 중'],
  ['approved', '승인'],
  ['published', '발행'],
  ['withdrawn', '회수'],
] as const;

const maintenanceStatuses = [
  ['requested', '요청'],
  ['assigned', '담당 배정'],
  ['quoted', '견적'],
  ['scheduled', '일정 확정'],
  ['in_progress', '작업 중'],
  ['completed', '완료'],
  ['cancelled', '취소'],
] as const;

const partnerTypeLabels: Record<string, string> = {
  construction: '시공',
  maintenance: '유지보수',
  electrical: '전기공사',
  cleaning: '청소·수목 정리',
  dismantling: '철거',
  recycling: '재활용',
};

const quoteRequestStatusLabels: Record<string, string> = {
  draft: '작성 중',
  requested: '견적 요청',
  collecting: '회신 수집',
  ready_for_selection: '선택 가능',
  selected: '업체 선택',
  completed: '완료',
  cancelled: '취소',
};

const partnerQuoteStatusLabels: Record<string, string> = {
  requested: '회신 대기',
  submitted: '제출 완료',
  selected: '선택',
  not_selected: '미선택',
  withdrawn: '철회',
  completed: '완료',
};

const roleLabels: Record<string, string> = {
  owner: '관리자',
  expert: '전문가',
  client: '의뢰인',
};

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: '운영 현황', icon: LayoutDashboard },
  { id: 'plants', label: '발전소', icon: Building2 },
  { id: 'inspections', label: '점검', icon: ClipboardCheck },
  { id: 'files', label: '열화상 업로드', icon: UploadCloud },
  { id: 'report-images', label: '보고서 사진', icon: ImageIcon },
  { id: 'findings', label: '후보 판정', icon: ThermometerSun },
  { id: 'assessments', label: '촬영조건·발전량', icon: Gauge },
  { id: 'calculation-settings', label: '계산·촬영 기준', icon: ClipboardCheck },
  { id: 'reports', label: '보고서', icon: FileText },
  { id: 'maintenance', label: '유지보수', icon: Wrench },
  { id: 'recycling', label: '재활용 인증서', icon: FileCheck2 },
  { id: 'partners', label: '업체·견적', icon: Handshake },
  { id: 'members', label: '관리자·사용자', icon: Users },
  { id: 'account', label: '내 계정', icon: KeyRound },
];

const roleViews: Record<string, View[]> = {
  owner: navItems.map((item) => item.id),
  expert: [
    'dashboard',
    'plants',
    'inspections',
    'files',
    'report-images',
    'findings',
    'assessments',
    'reports',
    'maintenance',
    'recycling',
    'account',
  ],
  client: [
    'dashboard',
    'plants',
    'inspections',
    'reports',
    'maintenance',
    'partners',
    'recycling',
    'account',
  ],
};

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    const authMessages: Record<string, string> = {
      invalid_credentials: '이메일 또는 비밀번호를 확인해 주세요.',
      email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.',
      same_password: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.',
      weak_password:
        '비밀번호가 너무 단순합니다. 다른 비밀번호를 입력해 주세요.',
      over_request_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    };
    const message = authMessages[String(error.code)];
    if (message) return message;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message);
  }
  return '처리 중 알 수 없는 오류가 발생했습니다.';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: backendConfig.displayTimezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatWon(value: number | null | undefined) {
  if (value == null) return '금액 미입력';
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

function jsonRecord(value: Json): Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function jsonText(value: Json | undefined, fallback = '') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function splitRegions(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function statusLabel(
  value: string,
  items: ReadonlyArray<readonly [string, string]>,
) {
  return items.find(([key]) => key === value)?.[1] ?? value;
}

function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const style =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : notice.tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-800'
        : 'border-sky-200 bg-sky-50 text-sky-800';
  const Icon = notice.tone === 'error' ? AlertTriangle : CheckCircle2;
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`mb-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${style}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{notice.text}</span>
    </div>
  );
}

export function LiveApp() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (loading) return <FullScreenLoading label="불러오는 중입니다." />;
  if (!supabase) return <ConfigurationMissing />;
  if (recoveringPassword && session) {
    return (
      <UpdatePasswordPanel
        supabase={supabase}
        onComplete={() => setRecoveringPassword(false)}
      />
    );
  }
  if (!session) return <AuthPanel supabase={supabase} />;
  return <WorkspaceGate supabase={supabase} session={session} />;
}

function FullScreenLoading({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#eef3f5] px-6">
      <div className="flex items-center gap-3 rounded-2xl border bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
        <Loader2 className="size-5 animate-spin text-teal-600" />
        {label}
      </div>
    </main>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3"
      aria-label="SolarScope 홈"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-teal-600 text-white shadow-sm">
        <SunMedium className="size-5" />
      </span>
      <span>
        <strong className="block text-lg tracking-tight text-slate-900">
          SolarScope
        </strong>
        <span className="block text-xs font-medium tracking-[0.12em] text-teal-700">
          SOLAR ASSET CARE
        </span>
      </span>
    </Link>
  );
}

function ConfigurationMissing() {
  return (
    <main className="min-h-screen bg-[#eef3f5] px-6 py-16">
      <div className="mx-auto max-w-xl rounded-3xl border bg-white p-8 shadow-sm">
        <Brand />
        <AlertTriangle className="mt-12 size-10 text-amber-500" />
        <h1 className="mt-5 text-2xl font-bold">서비스에 연결할 수 없습니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.
        </p>
      </div>
    </main>
  );
}

function AuthPanel({ supabase }: { supabase: SupabaseClient<Database> }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const redirectTo =
      process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL?.trim() ||
      `${window.location.origin}/`;
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo,
          },
        );
        if (error) throw error;
        setNotice({
          tone: 'success',
          text: '비밀번호 변경 메일을 보냈습니다. 메일의 링크는 한 번만 사용해 주세요.',
        });
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: { name: name.trim(), account_type: 'requester' },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice({
            tone: 'success',
            text: '가입 메일을 보냈습니다. 메일의 인증 링크를 누른 뒤 이 화면으로 돌아와 로그인해 주세요.',
          });
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-[#eef3f5] px-4 py-8">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-sm">
        <section className="p-6 sm:p-9">
          <div className="mx-auto max-w-sm">
            <div className="mb-9">
              <Brand />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {mode === 'signin'
                ? '로그인'
                : mode === 'signup'
                  ? '회원가입'
                  : '비밀번호 재설정'}
            </h1>
            {mode !== 'signin' && (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {mode === 'signup'
                  ? '전문가·관리자는 초대 메일로 가입해 주세요.'
                  : '가입한 이메일로 비밀번호 변경 링크를 보내드립니다.'}
              </p>
            )}
            <div className="mt-7">
              <NoticeBar notice={notice} />
            </div>
            <form onSubmit={submit} className="space-y-4">
              {mode === 'signup' && (
                <Field label="이름">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
              )}
              <Field label="이메일">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>
              {mode !== 'forgot' && (
                <Field
                  label="비밀번호"
                  hint={mode === 'signup' ? '8자 이상' : undefined}
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === 'signin' ? 'current-password' : 'new-password'
                    }
                    minLength={8}
                    required
                  />
                </Field>
              )}
              <Button type="submit" className="h-11 w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy
                  ? mode === 'signin'
                    ? '로그인 중…'
                    : '메일 발송 중…'
                  : mode === 'signin'
                    ? '로그인'
                    : mode === 'signup'
                      ? '가입 메일 받기'
                      : '변경 메일 받기'}
                {!busy && <ArrowRight />}
              </Button>
            </form>
            <Link
              href="/guest"
              prefetch={false}
              className={buttonVariants({
                variant: 'outline',
                className: 'mt-4 min-h-11 w-full',
              })}
            >
              게스트로 둘러보기
              <ArrowRight aria-hidden="true" />
            </Link>
            <div className="mt-5 flex flex-col items-center gap-3 text-sm">
              <button
                className="text-slate-600 hover:text-teal-700"
                type="button"
                onClick={() => {
                  setMode(mode === 'signup' ? 'signin' : 'signup');
                  setNotice(null);
                }}
              >
                {mode === 'signup' ? '이미 계정이 있나요? 로그인' : '회원가입'}
              </button>
              <button
                className="text-slate-500 underline-offset-4 hover:text-teal-700 hover:underline"
                type="button"
                onClick={() => {
                  setMode(mode === 'forgot' ? 'signin' : 'forgot');
                  setNotice(null);
                }}
              >
                {mode === 'forgot'
                  ? '로그인으로 돌아가기'
                  : '비밀번호를 잊으셨나요?'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function UpdatePasswordPanel({
  supabase,
  onComplete,
  embedded = false,
}: {
  supabase: SupabaseClient<Database>;
  onComplete?: () => void;
  embedded?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function updatePassword(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setNotice({ tone: 'error', text: '두 비밀번호가 일치하지 않습니다.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmation('');
      setNotice({ tone: 'success', text: '비밀번호를 변경했습니다.' });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const Heading = embedded ? 'h2' : 'h1';
  const content = (
    <section className="w-full max-w-md rounded-3xl border bg-white p-6 shadow-sm sm:p-8">
      <span className="grid size-11 place-items-center rounded-2xl bg-teal-50 text-teal-700">
        <KeyRound className="size-5" />
      </span>
      <Heading className="mt-5 text-2xl font-bold">비밀번호 변경</Heading>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        다른 서비스에서 사용하지 않는 8자 이상의 비밀번호를 입력하세요.
      </p>
      <div className="mt-5">
        <NoticeBar notice={notice} />
      </div>
      <form className="space-y-4" onSubmit={updatePassword}>
        <Field label="새 비밀번호">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="새 비밀번호 확인">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {busy ? '변경 중…' : '비밀번호 변경'}
        </Button>
      </form>
      {onComplete && notice?.tone === 'success' && (
        <Button
          type="button"
          variant="outline"
          className="mt-3 h-11 w-full"
          onClick={onComplete}
        >
          계속하기
        </Button>
      )}
    </section>
  );

  return embedded ? (
    content
  ) : (
    <main className="grid min-h-screen place-items-center bg-[#eef3f5] px-4 py-8">
      {content}
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        {label}
        {hint && (
          <small className="text-xs font-normal text-slate-400">{hint}</small>
        )}
      </span>
      {children}
    </label>
  );
}

function WorkspaceGate({
  supabase,
  session,
}: {
  supabase: SupabaseClient<Database>;
  session: Session;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const { data: membership, error: memberError } = await supabase
        .from('organization_members')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!membership) {
        setWorkspace(null);
        return;
      }
      const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .single();
      if (organizationError) throw organizationError;
      setWorkspace({ membership, organization });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [session.user.id, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  if (loading) return <FullScreenLoading label="불러오는 중입니다." />;
  if (!workspace) {
    return (
      <OrganizationOnboarding
        supabase={supabase}
        session={session}
        notice={notice}
        onReady={loadWorkspace}
      />
    );
  }
  return (
    <AdminConsole
      supabase={supabase}
      session={session}
      initialWorkspace={workspace}
    />
  );
}

function OrganizationOnboarding({
  supabase,
  session,
  notice: initialNotice,
  onReady,
}: {
  supabase: SupabaseClient<Database>;
  session: Session;
  notice: Notice;
  onReady: () => Promise<void>;
}) {
  const [name, setName] = useState('솔라이음');
  const [slug, setSlug] = useState('solar-ieum');
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [requesterBusy, setRequesterBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialNotice);

  async function registerRequester() {
    setRequesterBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('register_requester');
      if (error) throw error;
      setNotice({
        tone: 'success',
        text: '의뢰인 계정을 만들었습니다. 이제 본인 발전소를 등록할 수 있습니다.',
      });
      await onReady();
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setRequesterBusy(false);
    }
  }

  async function bootstrap(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('bootstrap_organization', {
        p_name: name,
        p_slug: slug,
        p_setup_code: setupCode,
      });
      if (error) throw error;
      setNotice({
        tone: 'success',
        text: '조직과 최초 관리자 권한을 만들었습니다.',
      });
      await onReady();
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#eef3f5] px-5 py-10">
      <div className="mx-auto max-w-2xl rounded-3xl border bg-white p-7 shadow-sm md:p-10">
        <div className="flex items-center justify-between gap-4">
          <Brand />
          <Button variant="outline" onClick={() => supabase.auth.signOut()}>
            <LogOut /> 로그아웃
          </Button>
        </div>
        <div className="mt-12 grid gap-8 md:grid-cols-[0.85fr_1.15fr]">
          <div>
            <LockKeyhole className="size-9 text-teal-600" />
            <h1 className="mt-4 text-2xl font-bold tracking-tight">
              작업공간 연결
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              로그인 계정 <strong>{session.user.email}</strong>은 아직 조직에
              연결되지 않았습니다.
            </p>
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              직접 가입한 사용자는 의뢰인으로 시작합니다. 전문가와 추가 관리자는
              기존 관리자가 보낸 초대 메일로만 계정을 만듭니다.
            </p>
          </div>
          <div className="space-y-4 rounded-2xl border p-5">
            <NoticeBar notice={notice} />
            <div className="rounded-2xl bg-teal-50 p-5">
              <h2 className="font-bold text-teal-950">의뢰인으로 시작</h2>
              <p className="mt-2 text-xs leading-5 text-teal-800">
                본인 발전소만 보이는 의뢰인 계정을 연결합니다. 발전소 등록과
                점검 요청은 다음 화면에서 진행합니다.
              </p>
              <Button
                className="mt-4 h-10 w-full"
                type="button"
                disabled={requesterBusy}
                onClick={() => void registerRequester()}
              >
                {requesterBusy ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowRight />
                )}
                의뢰인 계정 연결
              </Button>
            </div>
            <details className="rounded-2xl border bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-slate-700">
                최초 관리자 작업공간 개설
              </summary>
              <form onSubmit={bootstrap} className="mt-4 space-y-4">
                <Field label="조직명">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="조직 식별자" hint="영문 소문자·숫자·하이픈">
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    pattern="[a-z0-9][a-z0-9-]{1,62}"
                    required
                  />
                </Field>
                <Field label="1회용 개설 코드">
                  <Input
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.toUpperCase())}
                    autoComplete="off"
                    required
                  />
                </Field>
                <Button type="submit" className="h-10 w-full" disabled={busy}>
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ShieldCheck />
                  )}
                  최초 관리자 만들기
                </Button>
              </form>
            </details>
          </div>
        </div>
      </div>
    </main>
  );
}

function AdminConsole({
  supabase,
  session,
  initialWorkspace,
}: {
  supabase: SupabaseClient<Database>;
  session: Session;
  initialWorkspace: Workspace;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [view, setView] = useState<View>('dashboard');
  const [plants, setPlants] = useState<Plant[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [files, setFiles] = useState<InspectionFile[]>([]);
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRun[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerPrivateDetails, setPartnerPrivateDetails] = useState<
    PartnerPrivateDetails[]
  >([]);
  const [quoteRequests, setQuoteRequests] = useState<QuoteRequest[]>([]);
  const [partnerQuotes, setPartnerQuotes] = useState<PartnerQuote[]>([]);
  const [plantRequesters, setPlantRequesters] = useState<PlantRequester[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const organizationId = workspace.organization.id;
  const role = workspace.membership.role;
  const isOwner = role === 'owner';
  const isExpert = role === 'expert';
  const isRequester = role === 'client';
  const canOperate = isOwner;
  const canCreateInspection = isOwner || isRequester;
  const canUpdateInspection = isOwner || isExpert;
  const canUpload = isOwner || isExpert;
  const canReview = isOwner || isExpert;
  const canCreateReport = isOwner || isExpert;
  const canApprove = isOwner;
  const canMaintain = isOwner;
  const visibleNavItems = navItems.filter((item) =>
    (roleViews[role] ?? ['dashboard']).includes(item.id),
  );

  const refresh = useCallback(async () => {
    try {
      const scoped = <T,>(
        request: PromiseLike<{ data: T | null; error: unknown }>,
      ) => request;
      const [
        plantResult,
        inspectionResult,
        fileResult,
        runResult,
        findingResult,
        reportResult,
        maintenanceResult,
        partnerResult,
        partnerPrivateResult,
        quoteRequestResult,
        partnerQuoteResult,
        plantRequesterResult,
        memberResult,
      ] = await Promise.all([
        scoped(
          supabase
            .from('plants')
            .select('*')
            .eq('organization_id', organizationId)
            .order('name'),
        ),
        scoped(
          supabase
            .from('inspections')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('inspection_files')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('analysis_runs')
            .select('*')
            .eq('organization_id', organizationId)
            .order('requested_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('findings')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('reports')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('maintenance_requests')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('partners')
            .select('*')
            .eq('organization_id', organizationId)
            .order('name'),
        ),
        scoped(
          supabase
            .from('partner_private_details')
            .select('*')
            .order('created_at'),
        ),
        scoped(
          supabase
            .from('quote_requests')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase
            .from('partner_quotes')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        ),
        scoped(
          supabase.from('plant_requesters').select('*').order('created_at'),
        ),
        scoped(
          supabase
            .from('organization_members')
            .select('*')
            .eq('organization_id', organizationId)
            .order('created_at'),
        ),
      ]);
      const results = [
        plantResult,
        inspectionResult,
        fileResult,
        runResult,
        findingResult,
        reportResult,
        maintenanceResult,
        partnerResult,
        partnerPrivateResult,
        quoteRequestResult,
        partnerQuoteResult,
        plantRequesterResult,
        memberResult,
      ];
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      setPlants((plantResult.data ?? []) as Plant[]);
      setInspections((inspectionResult.data ?? []) as Inspection[]);
      setFiles((fileResult.data ?? []) as InspectionFile[]);
      setAnalysisRuns((runResult.data ?? []) as AnalysisRun[]);
      setFindings((findingResult.data ?? []) as Finding[]);
      setReports((reportResult.data ?? []) as Report[]);
      setMaintenance((maintenanceResult.data ?? []) as Maintenance[]);
      setPartners((partnerResult.data ?? []) as Partner[]);
      setPartnerPrivateDetails(
        (partnerPrivateResult.data ?? []) as PartnerPrivateDetails[],
      );
      setQuoteRequests((quoteRequestResult.data ?? []) as QuoteRequest[]);
      setPartnerQuotes((partnerQuoteResult.data ?? []) as PartnerQuote[]);
      setPlantRequesters((plantRequesterResult.data ?? []) as PlantRequester[]);
      const nextMembers = (memberResult.data ?? []) as Membership[];
      setMembers(nextMembers);
      if (nextMembers.length) {
        const { data: profileRows, error } = await supabase
          .from('profiles')
          .select('*')
          .in(
            'user_id',
            nextMembers.map((member) => member.user_id),
          );
        if (error) throw error;
        setProfiles(
          Object.fromEntries(
            (profileRows ?? []).map((profile) => [profile.user_id, profile]),
          ),
        );
      }
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [organizationId, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const shared = {
    supabase,
    session,
    organizationId,
    plants,
    inspections,
    files,
    analysisRuns,
    findings,
    reports,
    maintenance,
    partners,
    partnerPrivateDetails,
    quoteRequests,
    partnerQuotes,
    plantRequesters,
    members,
    profiles,
    refresh,
    setNotice,
  };

  return (
    <div className="min-h-screen bg-[#f2f5f6] text-slate-900">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 md:px-6">
          <Brand />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <strong className="block text-sm">
                {workspace.organization.name}
              </strong>
              <span className="block text-xs text-slate-500">
                {roleLabels[role]} · {session.user.email}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label="새로고침"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              <span className="hidden md:inline">새로고침</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="로그아웃"
              onClick={() => supabase.auth.signOut()}
            >
              <LogOut /> <span className="hidden md:inline">로그아웃</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="sticky top-16 z-20 border-b bg-white px-3 py-2 md:hidden">
        <label className="flex items-center gap-3">
          <span className="shrink-0 text-sm font-bold text-slate-700">
            메뉴
          </span>
          <select
            className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 text-base font-semibold text-slate-800"
            value={view}
            onChange={(event) => {
              setView(event.target.value as View);
              setNotice(null);
            }}
            aria-label="작업 메뉴"
          >
            {visibleNavItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mx-auto grid max-w-[1500px] md:grid-cols-[220px_1fr]">
        <aside className="hidden bg-white p-4 md:block md:min-h-[calc(100vh-4rem)] md:border-r">
          <nav className="flex flex-col gap-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setView(item.id);
                    setNotice(null);
                  }}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition md:w-full ${
                    view === item.id
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon className="size-4" /> {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 p-3 sm:p-4 md:p-6 lg:p-8">
          <NoticeBar notice={notice} />
          {loading && plants.length === 0 ? (
            <div className="grid min-h-[55vh] place-items-center">
              <Loader2 className="size-7 animate-spin text-teal-600" />
            </div>
          ) : (
            <>
              {view === 'account' && (
                <>
                  <PageHeading eyebrow="ACCOUNT" title="내 계정" />
                  <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border bg-white p-5 text-sm">
                    <div>
                      <dt className="text-slate-500">이메일</dt>
                      <dd className="mt-1 break-all font-semibold">
                        {session.user.email}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">역할</dt>
                      <dd className="mt-1 font-semibold">{roleLabels[role]}</dd>
                    </div>
                  </dl>
                  <UpdatePasswordPanel supabase={supabase} embedded />
                </>
              )}
              {view === 'dashboard' && (
                <DashboardView {...shared} setView={setView} />
              )}
              {view === 'plants' && (
                <PlantsView
                  {...shared}
                  canWrite={canOperate || isRequester}
                  requesterMode={isRequester}
                />
              )}
              {view === 'inspections' && (
                <InspectionsView
                  {...shared}
                  canCreate={canCreateInspection}
                  canUpdate={canUpdateInspection}
                  requesterMode={isRequester}
                  expertMode={isExpert}
                />
              )}
              {view === 'files' && (
                <FilesView {...shared} canWrite={canUpload} />
              )}
              {view === 'report-images' && canUpload && (
                <ReportImagesView {...shared} isOwner={isOwner} />
              )}
              {view === 'findings' && (
                <FindingsEditorView {...shared} canWrite={canReview} />
              )}
              {view === 'assessments' && (
                <AssessmentsView {...shared} isOwner={isOwner} />
              )}
              {view === 'calculation-settings' && isOwner && (
                <CalculationSettingsView {...shared} />
              )}
              {view === 'reports' && (
                <ReportsView
                  {...shared}
                  canCreate={canCreateReport}
                  canApprove={canApprove}
                  requesterMode={isRequester}
                />
              )}
              {view === 'maintenance' && (
                <MaintenanceView {...shared} canWrite={canMaintain} />
              )}
              {view === 'recycling' && (
                <RecyclingView {...shared} isOwner={isOwner} />
              )}
              {view === 'partners' && (
                <PartnerQuotesView
                  {...shared}
                  canWrite={isOwner}
                  requesterMode={isRequester}
                />
              )}
              {view === 'members' && (
                <MembersView
                  {...shared}
                  workspace={workspace}
                  setWorkspace={setWorkspace}
                  canWrite={isOwner}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

type SharedProps = {
  supabase: SupabaseClient<Database>;
  session: Session;
  organizationId: string;
  plants: Plant[];
  inspections: Inspection[];
  files: InspectionFile[];
  analysisRuns: AnalysisRun[];
  findings: Finding[];
  reports: Report[];
  maintenance: Maintenance[];
  partners: Partner[];
  partnerPrivateDetails: PartnerPrivateDetails[];
  quoteRequests: QuoteRequest[];
  partnerQuotes: PartnerQuote[];
  plantRequesters: PlantRequester[];
  members: Membership[];
  profiles: Record<string, Profile>;
  refresh: () => Promise<void>;
  setNotice: (notice: Notice) => void;
};

function PageHeading({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="text-xs font-bold tracking-[0.14em] text-teal-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
          {title}
        </h1>
        {copy && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {copy}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Gauge;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">{label}</span>
        <span className="grid size-9 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Icon className="size-4" />
        </span>
      </div>
      <strong className="mt-5 block text-3xl tracking-tight">{value}</strong>
      <span className="mt-1 block text-xs text-slate-400">{note}</span>
    </div>
  );
}

function DashboardView(props: SharedProps & { setView: (view: View) => void }) {
  const activeInspections = props.inspections.filter(
    (item) => !['closed', 'cancelled'].includes(item.status),
  );
  const pendingFindings = props.findings.filter(
    (item) => item.disposition === 'pending',
  );
  const openMaintenance = props.maintenance.filter(
    (item) => !['completed', 'cancelled'].includes(item.status),
  );
  const plantName = (id: string) =>
    props.plants.find((plant) => plant.id === id)?.name ?? '발전소';

  return (
    <>
      <PageHeading eyebrow="DASHBOARD" title="운영 현황" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="등록 발전소"
          value={props.plants.length}
          note="조직 자산"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="진행 점검"
          value={activeInspections.length}
          note="취소·종료 제외"
        />
        <MetricCard
          icon={ThermometerSun}
          label="검토 후보"
          value={pendingFindings.length}
          note="전문가 판단 대기"
        />
        <MetricCard
          icon={Wrench}
          label="진행 조치"
          value={openMaintenance.length}
          note="완료·취소 제외"
        />
      </div>

      {props.plants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="첫 발전소부터 등록하세요"
          copy="발전소가 있어야 점검을 접수하고 열화상 원본을 연결할 수 있습니다."
          action="발전소 등록"
          onAction={() => props.setView('plants')}
        />
      ) : (
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">최근 점검</h2>
              <button
                className="text-xs font-semibold text-teal-700"
                onClick={() => props.setView('inspections')}
              >
                전체 보기
              </button>
            </div>
            <div className="mt-4 divide-y">
              {props.inspections.slice(0, 6).map((inspection) => (
                <div
                  key={inspection.id}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-sm">
                      {plantName(inspection.plant_id)}
                    </strong>
                    <span className="mt-1 block text-xs text-slate-500">
                      {inspection.inspection_code} ·{' '}
                      {inspection.purpose || '목적 미입력'}
                    </span>
                  </div>
                  <StatusPill>
                    {statusLabel(inspection.status, inspectionStatuses)}
                  </StatusPill>
                </div>
              ))}
              {props.inspections.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">
                  아직 접수된 점검이 없습니다.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-2xl bg-[#123e42] p-6 text-white shadow-sm">
            <FileCheck2 className="size-7 text-teal-300" />
            <h2 className="mt-5 text-xl font-bold">운영 시작 순서</h2>
            <ol className="mt-5 space-y-4 text-sm text-slate-200">
              {[
                '발전소 정보 등록',
                '점검 접수와 일정 지정',
                '열화상 원본 업로드·상대 분석',
                '전문가 판정 후 보고서·조치 연결',
              ].map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-bold text-teal-200">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{item}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </>
  );
}

function EmptyState({
  icon: Icon,
  title,
  copy,
  action,
  onAction,
}: {
  icon: typeof Building2;
  title: string;
  copy: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed bg-white px-6 py-14 text-center">
      <Icon className="mx-auto size-9 text-slate-300" />
      <h2 className="mt-4 font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
        {copy}
      </p>
      {action && onAction && (
        <Button className="mt-5" onClick={onAction}>
          <Plus /> {action}
        </Button>
      )}
    </div>
  );
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800">
      {children}
    </span>
  );
}

function PlantsView(
  props: SharedProps & { canWrite: boolean; requesterMode: boolean },
) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('');
  const [commissionedOn, setCommissionedOn] = useState('');
  const [operatorType, setOperatorType] = useState('개인');
  const [moduleModel, setModuleModel] = useState('');
  const [inverterModel, setInverterModel] = useState('');
  const [dataUseConsent, setDataUseConsent] = useState(false);
  const [requesterId, setRequesterId] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setEditingId(null);
    setName('');
    setCode('');
    setAddress('');
    setCapacity('');
    setCommissionedOn('');
    setOperatorType('개인');
    setModuleModel('');
    setInverterModel('');
    setDataUseConsent(false);
    setRequesterId('');
  }

  function edit(plant: Plant) {
    setEditingId(plant.id);
    setName(plant.name);
    setCode(plant.code ?? '');
    setAddress(plant.address ?? '');
    setCapacity(plant.capacity_kw == null ? '' : String(plant.capacity_kw));
    setCommissionedOn(plant.commissioned_on ?? '');
    const metadata = jsonRecord(plant.metadata);
    setOperatorType(jsonText(metadata.operator_type, '개인'));
    setModuleModel(jsonText(metadata.module_model));
    setInverterModel(jsonText(metadata.inverter_model));
    setDataUseConsent(Boolean(metadata.data_use_consent_at));
  }

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    props.setNotice(null);
    try {
      const previousMetadata = editingId
        ? jsonRecord(
            props.plants.find((plant) => plant.id === editingId)?.metadata ??
              {},
          )
        : {};
      const metadata = {
        ...previousMetadata,
        operator_type: operatorType.trim() || null,
        module_model: moduleModel.trim() || null,
        inverter_model: inverterModel.trim() || null,
        data_use_consent_at:
          previousMetadata.data_use_consent_at || new Date().toISOString(),
        data_use_consent_version: 'operational-registration-v1',
      } as Json;
      const result = props.requesterMode
        ? await props.supabase.rpc('create_requester_plant_with_details', {
            p_name: name.trim(),
            p_address: address.trim(),
            p_capacity_kw: Number(capacity),
            p_commissioned_on: commissionedOn,
            p_operator_type: operatorType.trim(),
            p_module_model: moduleModel.trim(),
            p_inverter_model: inverterModel.trim(),
            p_data_use_consent: dataUseConsent,
          })
        : editingId
          ? await props.supabase
              .from('plants')
              .update({
                organization_id: props.organizationId,
                name: name.trim(),
                code: code.trim() || null,
                address: address.trim() || null,
                capacity_kw: capacity ? Number(capacity) : null,
                commissioned_on: commissionedOn || null,
                timezone: backendConfig.displayTimezone,
                metadata,
              })
              .eq('id', editingId)
          : await props.supabase
              .from('plants')
              .insert({
                organization_id: props.organizationId,
                name: name.trim(),
                code: code.trim() || null,
                address: address.trim() || null,
                capacity_kw: capacity ? Number(capacity) : null,
                commissioned_on: commissionedOn || null,
                timezone: backendConfig.displayTimezone,
                metadata,
              })
              .select('id')
              .single();
      if (result.error) throw result.error;
      if (
        !props.requesterMode &&
        !editingId &&
        requesterId &&
        result.data &&
        'id' in result.data
      ) {
        const { error } = await props.supabase.rpc(
          'assign_requester_to_plant',
          {
            p_plant_id: result.data.id,
            p_requester_user_id: requesterId,
          },
        );
        if (error) throw error;
      }
      props.setNotice({
        tone: 'success',
        text: editingId
          ? '발전소 정보를 수정했습니다.'
          : props.requesterMode
            ? '내 발전소를 등록했습니다.'
            : '발전소를 등록했습니다.',
      });
      reset();
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ASSET REGISTRY"
        title={props.requesterMode ? '내 발전소' : '발전소 관리'}
        copy={
          props.requesterMode
            ? '본인이 소유하거나 관리하는 발전소만 표시됩니다. 발전소를 등록하면 점검을 요청할 수 있습니다.'
            : '점검과 보고서가 연결될 기준 자산을 등록합니다. 용량은 kW, 시간은 발전소의 현지 시간대를 기준으로 표시합니다.'
        }
      />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <form
          onSubmit={save}
          className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold">
              {editingId
                ? '발전소 수정'
                : props.requesterMode
                  ? '내 발전소 등록'
                  : '새 발전소'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={reset}
                className="text-xs text-slate-500 underline"
              >
                취소
              </button>
            )}
          </div>
          {!props.canWrite && <ReadOnlyNote />}
          <Field label="발전소명">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!props.canWrite}
              required
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {!props.requesterMode && (
              <Field label="관리 코드">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={!props.canWrite}
                  placeholder="PLANT-001"
                />
              </Field>
            )}
            <Field label="설비용량(kW)">
              <Input
                type="number"
                min="0"
                step="0.001"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                disabled={!props.canWrite}
                required={props.requesterMode}
              />
            </Field>
          </div>
          <Field label="주소">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!props.canWrite}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="운영 형태">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                value={operatorType}
                onChange={(event) => setOperatorType(event.target.value)}
                disabled={!props.canWrite}
              >
                <option value="개인">개인</option>
                <option value="법인">법인</option>
                <option value="협동조합">협동조합</option>
                <option value="공공">공공</option>
                <option value="기타">기타</option>
              </select>
            </Field>
            <Field label="모듈 모델" hint="알면 입력">
              <Input
                value={moduleModel}
                onChange={(event) => setModuleModel(event.target.value)}
                disabled={!props.canWrite}
              />
            </Field>
          </div>
          <Field label="인버터 모델" hint="알면 입력">
            <Input
              value={inverterModel}
              onChange={(event) => setInverterModel(event.target.value)}
              disabled={!props.canWrite}
            />
          </Field>
          {!props.requesterMode && !editingId && (
            <Field label="의뢰인 연결" hint="선택 사항">
              <select
                className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                value={requesterId}
                onChange={(e) => setRequesterId(e.target.value)}
                disabled={!props.canWrite}
              >
                <option value="">나중에 연결</option>
                {props.members
                  .filter(
                    (member) =>
                      member.role === 'client' && member.status === 'active',
                  )
                  .map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {props.profiles[member.user_id]?.display_name ||
                        props.profiles[member.user_id]?.email ||
                        member.user_id}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label="상업운전 시작일">
            <Input
              type="date"
              value={commissionedOn}
              onChange={(e) => setCommissionedOn(e.target.value)}
              disabled={!props.canWrite}
              required={props.requesterMode}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl bg-teal-50 p-3 text-sm leading-6 text-teal-950">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-teal-600"
              checked={dataUseConsent}
              onChange={(event) => setDataUseConsent(event.target.checked)}
              disabled={!props.canWrite || Boolean(editingId && dataUseConsent)}
              required
            />
            <span>
              점검 접수와 보고서 작성을 위해 발전소 정보와 업로드 자료를
              처리하는 데 동의합니다.
            </span>
          </label>
          <Button
            type="submit"
            className="w-full"
            disabled={!props.canWrite || !dataUseConsent || busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {editingId ? '변경 저장' : '발전소 등록'}
          </Button>
        </form>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-bold">등록 자산 {props.plants.length}곳</h2>
          </div>
          <div className="divide-y">
            {props.plants.map((plant) => (
              <div
                key={plant.id}
                className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <strong>{plant.name}</strong>
                    {plant.code && <StatusPill>{plant.code}</StatusPill>}
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {plant.address || '주소 미입력'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {plant.capacity_kw == null
                      ? '용량 미입력'
                      : `${Number(plant.capacity_kw).toLocaleString()} kW`}{' '}
                    · {plant.timezone}
                  </p>
                  {(() => {
                    const metadata = jsonRecord(plant.metadata);
                    const equipment = [
                      jsonText(metadata.operator_type),
                      jsonText(metadata.module_model),
                      jsonText(metadata.inverter_model),
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return equipment ? (
                      <p className="mt-1 text-xs text-slate-500">{equipment}</p>
                    ) : null;
                  })()}
                </div>
                {props.canWrite && !props.requesterMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => edit(plant)}
                  >
                    수정
                  </Button>
                )}
              </div>
            ))}
            {props.plants.length === 0 && (
              <p className="px-5 py-16 text-center text-sm text-slate-400">
                등록된 발전소가 없습니다.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ReadOnlyNote() {
  return (
    <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
      현재 역할은 이 항목을 조회할 수 있지만 변경할 수 없습니다.
    </p>
  );
}

function InspectionsView(
  props: SharedProps & {
    canCreate: boolean;
    canUpdate: boolean;
    requesterMode: boolean;
    expertMode: boolean;
  },
) {
  const [plantId, setPlantId] = useState('');
  const [code, setCode] = useState(
    () => `INS-${koreanDate().replaceAll('-', '')}`,
  );
  const [purpose, setPurpose] = useState('정기 열화상 점검');
  const [scheduledAt, setScheduledAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [expertId, setExpertId] = useState('');
  const [busy, setBusy] = useState(false);

  const effectivePlantId = plantId || props.plants[0]?.id || '';

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    props.setNotice(null);
    try {
      const { error } = props.requesterMode
        ? await props.supabase.rpc('request_inspection', {
            p_plant_id: effectivePlantId,
            p_purpose: purpose.trim(),
            p_notes: notes.trim(),
          })
        : await props.supabase.from('inspections').insert({
            organization_id: props.organizationId,
            plant_id: effectivePlantId,
            inspection_code: code.trim(),
            purpose: purpose.trim() || null,
            status: scheduledAt ? 'scheduled' : 'requested',
            scheduled_at: scheduledAt
              ? parseKoreanInput(scheduledAt, '예정 일시')
              : null,
            due_at: dueAt ? parseKoreanInput(dueAt, '완료 목표') : null,
            capture_timezone: 'Asia/Seoul',
            assigned_expert_user_id: expertId || null,
            created_by: props.session.user.id,
            notes: notes.trim() || null,
          });
      if (error) throw error;
      props.setNotice({ tone: 'success', text: '점검을 접수했습니다.' });
      setCode(`INS-${Date.now().toString().slice(-8)}`);
      setNotes('');
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    props.setNotice(null);
    const { error } = await props.supabase
      .from('inspections')
      .update({ status })
      .eq('id', id);
    if (error) props.setNotice({ tone: 'error', text: errorMessage(error) });
    else {
      props.setNotice({ tone: 'success', text: '점검 상태를 변경했습니다.' });
      await props.refresh();
    }
  }

  async function assignExpert(id: string, assignedExpertUserId: string) {
    props.setNotice(null);
    const { error } = await props.supabase
      .from('inspections')
      .update({ assigned_expert_user_id: assignedExpertUserId || null })
      .eq('id', id);
    if (error) props.setNotice({ tone: 'error', text: errorMessage(error) });
    else {
      props.setNotice({ tone: 'success', text: '담당 전문가를 변경했습니다.' });
      await props.refresh();
    }
  }

  const plantName = (id: string) =>
    props.plants.find((plant) => plant.id === id)?.name ?? '삭제된 발전소';
  const activeExperts = props.members.filter(
    (member) => member.role === 'expert' && member.status === 'active',
  );
  const availableStatuses = props.expertMode
    ? inspectionStatuses.filter(([key]) =>
        ['expert_review', 'approval'].includes(key),
      )
    : inspectionStatuses;

  return (
    <>
      <PageHeading
        eyebrow="INSPECTION WORKFLOW"
        title={props.requesterMode ? '내 점검 요청' : '점검 접수·진행 관리'}
        copy={
          props.requesterMode
            ? '내 발전소의 열화상 점검을 요청하고 진행 상태와 발행 결과를 확인합니다.'
            : '모든 일정은 한국 시간 기준입니다.'
        }
      />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <form
          onSubmit={create}
          className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold">
            {props.requesterMode ? '새 점검 요청' : '새 점검 접수'}
          </h2>
          {!props.canCreate && <ReadOnlyNote />}
          {props.plants.length === 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              먼저 발전소를 등록해야 합니다.
            </p>
          )}
          <Field label="대상 발전소">
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
              value={effectivePlantId}
              onChange={(e) => setPlantId(e.target.value)}
              disabled={!props.canCreate}
            >
              {props.plants.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.name}
                </option>
              ))}
            </select>
          </Field>
          {!props.requesterMode && (
            <Field label="점검 번호">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!props.canCreate}
                required
              />
            </Field>
          )}
          <Field label="점검 목적">
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              disabled={!props.canCreate}
            />
          </Field>
          {!props.requesterMode && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="예정 일시">
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    disabled={!props.canCreate}
                  />
                </Field>
                <Field label="완료 목표">
                  <Input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    disabled={!props.canCreate}
                  />
                </Field>
              </div>
              <Field label="담당 전문가">
                <select
                  className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                  value={expertId}
                  onChange={(e) => setExpertId(e.target.value)}
                  disabled={!props.canCreate}
                >
                  <option value="">미배정</option>
                  {activeExperts.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {props.profiles[member.user_id]?.display_name ||
                        props.profiles[member.user_id]?.email ||
                        member.user_id}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="현장 메모">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!props.canCreate}
              rows={3}
            />
          </Field>
          <Button
            type="submit"
            className="w-full"
            disabled={!props.canCreate || !effectivePlantId || busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
            {props.requesterMode ? '점검 요청' : '점검 접수'}
          </Button>
        </form>
        <section className="space-y-3">
          {props.inspections.map((inspection) => (
            <article
              key={inspection.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{plantName(inspection.plant_id)}</strong>
                    <StatusPill>{inspection.inspection_code}</StatusPill>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {inspection.purpose || '목적 미입력'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    예정 {formatDateTime(inspection.scheduled_at)} · 마감{' '}
                    {formatDateTime(inspection.due_at)}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  {!props.requesterMode && !props.expertMode && (
                    <select
                      className="h-9 max-w-56 rounded-lg border bg-white px-3 text-xs"
                      value={inspection.assigned_expert_user_id ?? ''}
                      onChange={(e) =>
                        void assignExpert(inspection.id, e.target.value)
                      }
                      disabled={!props.canUpdate}
                      aria-label="담당 전문가"
                    >
                      <option value="">전문가 미배정</option>
                      {activeExperts.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {props.profiles[member.user_id]?.display_name ||
                            props.profiles[member.user_id]?.email ||
                            member.user_id}
                        </option>
                      ))}
                    </select>
                  )}
                  {props.canUpdate ? (
                    <select
                      className="h-9 rounded-lg border bg-white px-3 text-sm font-semibold text-slate-700"
                      value={inspection.status}
                      onChange={(e) =>
                        void updateStatus(inspection.id, e.target.value)
                      }
                    >
                      {!availableStatuses.some(
                        ([key]) => key === inspection.status,
                      ) && (
                        <option value={inspection.status}>
                          {statusLabel(inspection.status, inspectionStatuses)}
                        </option>
                      )}
                      {availableStatuses.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusPill>
                      {statusLabel(inspection.status, inspectionStatuses)}
                    </StatusPill>
                  )}
                </div>
              </div>
              {inspection.notes && (
                <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                  {inspection.notes}
                </p>
              )}
            </article>
          ))}
          {props.inspections.length === 0 && (
            <EmptyState
              icon={ClipboardCheck}
              title="접수된 점검이 없습니다"
              copy="새 점검 접수 양식에서 점검을 등록하세요."
            />
          )}
        </section>
      </div>
    </>
  );
}

async function imageValues(file: File) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 320 / bitmap.width, 300 / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이미지 분석용 캔버스를 만들 수 없습니다.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const values: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    values.push(
      (pixels[index] * 0.2126 +
        pixels[index + 1] * 0.7152 +
        pixels[index + 2] * 0.0722) /
        255,
    );
  }
  return { width, height, values };
}

function FilesView(props: SharedProps & { canWrite: boolean }) {
  const [inspectionId, setInspectionId] = useState('');
  const [kind, setKind] = useState<'thermal_original' | 'visible_original'>(
    'thermal_original',
  );
  const [queue, setQueue] = useState<
    Array<{
      id: string;
      file: File;
      status: 'waiting' | 'uploading' | 'analyzing' | 'done' | 'failed';
      progress: number;
      message: string;
    }>
  >([]);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const [runAnalysis, setRunAnalysis] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analyzingFileId, setAnalyzingFileId] = useState<string | null>(null);

  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';

  const hasSuccessfulAnalysis = (fileId: string) =>
    props.analysisRuns.some((run) => {
      const manifest = jsonRecord(run.input_manifest);
      return (
        run.status === 'succeeded' &&
        jsonText(manifest.inspection_file_id) === fileId
      );
    });

  async function analyzeFile(file: File, fileRow: InspectionFile) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      throw new Error(
        '상대 분석은 JPG 또는 PNG 원본에서만 실행할 수 있습니다.',
      );
    }
    if (hasSuccessfulAnalysis(fileRow.id)) {
      throw new Error('이 원본의 상대 분석이 이미 완료됐습니다.');
    }

    const pixels = await imageValues(file);
    const { data: run, error: createRunError } = await props.supabase.rpc(
      'start_relative_analysis',
      {
        p_inspection_file_id: fileRow.id,
        p_normalized_pixels: pixels.width * pixels.height,
      },
    );
    if (createRunError) throw createRunError;

    try {
      const response = await fetch('/api/thermal/analyze', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${props.session.access_token}`,
        },
        body: JSON.stringify({ ...pixels, sensitivity: 72 }),
      });
      const analysis = (await response.json()) as AnalysisResult & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(analysis.error || '상대 분석에 실패했습니다.');

      const { error: finishRunError } = await props.supabase.rpc(
        'complete_relative_analysis',
        {
          p_analysis_run_id: run.id,
          p_result_summary: {
            ...analysis.summary,
            disclaimer: analysis.disclaimer,
            analyzed_at: analysis.analyzedAt,
          } as Json,
          p_regions: analysis.regions.map((region) => ({
            kind: region.kind,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            area_percent: region.areaPercent,
            score: region.score,
          })) as Json,
        },
      );
      if (finishRunError) throw finishRunError;

      return analysis.regions.length;
    } catch (error) {
      await props.supabase.rpc('fail_relative_analysis', {
        p_analysis_run_id: run.id,
        p_message: errorMessage(error).slice(0, 300),
      });
      throw error;
    }
  }

  async function retryAnalysis(fileRow: InspectionFile) {
    setAnalyzingFileId(fileRow.id);
    props.setNotice({ tone: 'info', text: '저장된 원본을 다시 분석합니다.' });
    try {
      const { data, error } = await props.supabase.storage
        .from(fileRow.storage_bucket)
        .download(fileRow.storage_path);
      if (error) throw error;
      const file = new File([data], fileRow.original_name, {
        type: fileRow.mime_type ?? data.type,
      });
      await verifiedImageType(file);
      const candidateCount = await analyzeFile(file, fileRow);
      props.setNotice({
        tone: 'success',
        text: `상대 분석 후보 ${candidateCount}건을 만들었습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
      await props.refresh();
    } finally {
      setAnalyzingFileId(null);
    }
  }

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !effectiveInspectionId || !queue.length) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setBusy(true);
    props.setNotice(null);
    let completed = 0,
      failed = 0;
    const update = (id: string, patch: Partial<(typeof queue)[number]>) =>
      setQueue((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
    try {
      for (const item of queue.filter((row) => row.status !== 'done')) {
        if (controller.signal.aborted) break;
        update(item.id, { status: 'uploading', message: '파일 확인·전송 중' });
        try {
          const fileRow = await saveOriginal({
            file: item.file,
            client: props.supabase,
            userId: props.session.user.id,
            projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            organizationId: props.organizationId,
            inspectionId: effectiveInspectionId,
            kind,
            signal: controller.signal,
            onProgress: (progress) => update(item.id, { progress }),
          });
          let message = '저장 완료';
          if (
            !controller.signal.aborted &&
            runAnalysis &&
            kind === 'thermal_original' &&
            ['image/jpeg', 'image/png'].includes(fileRow.mime_type || '') &&
            !hasSuccessfulAnalysis(fileRow.id)
          ) {
            update(item.id, {
              status: 'analyzing',
              message: '원본 저장 완료 · 상대 분석 중',
            });
            try {
              const normalized = new File([item.file], item.file.name, {
                type: fileRow.mime_type || '',
              });
              const count = await analyzeFile(normalized, fileRow);
              message += ` · 후보 ${count}건`;
            } catch {
              message += ' · 분석은 아래 원본 목록에서 다시 실행해 주세요.';
            }
          }
          update(item.id, { status: 'done', progress: 100, message });
          completed++;
        } catch (error) {
          if (controller.signal.aborted) {
            update(item.id, {
              status: 'waiting',
              message: '일시정지 · 같은 파일로 이어 올릴 수 있습니다.',
            });
            break;
          }
          update(item.id, { status: 'failed', message: errorMessage(error) });
          failed++;
        }
      }
      props.setNotice({
        tone: failed ? 'error' : 'success',
        text: `${completed}개 저장 완료${failed ? ` · ${failed}개는 다시 시도해 주세요.` : ''}${controller.signal.aborted ? ' · 나머지는 일시정지했습니다.' : ''}`,
      });
      await props.refresh();
    } finally {
      setBusy(false);
      uploadController.current = null;
    }
  }

  async function download(file: InspectionFile) {
    const { data, error } = await props.supabase.storage
      .from(file.storage_bucket)
      .createSignedUrl(file.storage_path, 60);
    if (error) props.setNotice({ tone: 'error', text: errorMessage(error) });
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  const inspectionLabel = (id: string) => {
    const inspection = props.inspections.find((item) => item.id === id);
    const plant = props.plants.find((item) => item.id === inspection?.plant_id);
    return inspection
      ? `${plant?.name ?? '발전소'} · ${inspection.inspection_code}`
      : '삭제된 점검';
  };

  return (
    <>
      <PageHeading eyebrow="FILES" title="열화상·가시광 원본 업로드" />
      <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <form
          onSubmit={upload}
          className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold">점검 파일 저장</h2>
          {!props.canWrite && <ReadOnlyNote />}
          <Field label="연결할 점검">
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
              value={effectiveInspectionId}
              onChange={(e) => {
                setInspectionId(e.target.value);
                setQueue([]);
              }}
              disabled={!props.canWrite || busy || queue.length > 0}
            >
              {props.inspections.map((inspection) => (
                <option key={inspection.id} value={inspection.id}>
                  {inspectionLabel(inspection.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="파일 종류">
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              disabled={!props.canWrite || busy || queue.length > 0}
            >
              <option value="thermal_original">열화상 원본</option>
              <option value="visible_original">가시광 원본</option>
            </select>
          </Field>
          <label className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border-2 border-dashed bg-slate-50 px-5 text-center hover:border-teal-300">
            <span>
              <ImageIcon className="mx-auto size-8 text-slate-300" />
              <strong className="mt-3 block text-sm">
                {queue.length
                  ? `${queue.length}개 파일 선택됨`
                  : '이미지를 여러 장 선택하세요'}
              </strong>
              <span className="mt-1 block text-xs text-slate-400">
                JPG·PNG·TIFF, 파일당 50MB · 한 번에 20개
              </span>
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/tiff,.tif,.tiff"
              multiple
              disabled={!props.canWrite || busy}
              onChange={(e) => {
                const selected = Array.from(e.target.files || []);
                if (selected.length > 20)
                  props.setNotice({
                    tone: 'error',
                    text: '한 번에 최대 20개까지 선택해 주세요.',
                  });
                else
                  setQueue(
                    selected.map((file) => ({
                      id: crypto.randomUUID(),
                      file,
                      status: 'waiting',
                      progress: 0,
                      message: '대기 중',
                    })),
                  );
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-sm leading-6 text-slate-600">
            중단되면 다시 시작하세요. 창을 닫았다면 같은 계정·점검·파일 종류에서
            같은 파일을 다시 선택하면 됩니다. 재개 정보가 만료되면 처음부터
            전송합니다.
          </p>
          {queue.length > 0 && (
            <div className="space-y-3">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className="min-w-0 rounded-lg border p-3 text-sm"
                >
                  <p className="break-all font-medium">{item.file.name}</p>
                  <output className="my-2 block text-slate-600">
                    {item.message}
                  </output>
                  <Progress
                    value={item.progress}
                    aria-label={`${item.file.name} 전송 진행률`}
                  />
                </div>
              ))}
              {busy ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uploadController.current?.abort()}
                >
                  업로드 일시정지
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setQueue([])}
                >
                  선택 목록 비우기
                </Button>
              )}
            </div>
          )}
          {kind === 'thermal_original' && (
            <label className="flex items-start gap-3 rounded-xl bg-teal-50 p-3 text-xs leading-5 text-teal-900">
              <input
                type="checkbox"
                className="mt-1"
                checked={runAnalysis}
                onChange={(e) => setRunAnalysis(e.target.checked)}
              />
              JPG·PNG이면 저장 직후 색상 분포 기반 상대 분석 후보도 만듭니다.
              실제 섭씨 온도나 고장 확정값은 아닙니다.
            </label>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={
              !props.canWrite ||
              !effectiveInspectionId ||
              !queue.some((item) => item.status !== 'done') ||
              busy
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : <UploadCloud />}원본
            저장
            {runAnalysis && kind === 'thermal_original' ? ' + 상대 분석' : ''}
          </Button>
        </form>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-bold">저장 파일 {props.files.length}개</h2>
          </div>
          <div className="divide-y">
            {props.files.map((file) => (
              <div
                key={file.id}
                className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-4 shrink-0 text-teal-600" />
                    <strong className="truncate text-sm">
                      {file.original_name}
                    </strong>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-500">
                    {inspectionLabel(file.inspection_id)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {file.bytes
                      ? `${Math.round(file.bytes / 1024).toLocaleString()} KB`
                      : '크기 미상'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {file.kind === 'thermal_original' &&
                    ['image/jpeg', 'image/png'].includes(
                      file.mime_type ?? '',
                    ) &&
                    !hasSuccessfulAnalysis(file.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !props.canWrite || analyzingFileId === file.id
                        }
                        onClick={() => void retryAnalysis(file)}
                      >
                        {analyzingFileId === file.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <ThermometerSun />
                        )}
                        상대 분석
                      </Button>
                    )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void download(file)}
                  >
                    <Download />
                    60초 다운로드
                  </Button>
                </div>
              </div>
            ))}
            {props.files.length === 0 && (
              <p className="px-5 py-16 text-center text-sm text-slate-400">
                저장된 원본 파일이 없습니다.
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ReportsView(
  props: SharedProps & {
    canCreate: boolean;
    canApprove: boolean;
    requesterMode: boolean;
  },
) {
  const [inspectionId, setInspectionId] = useState('');
  const [title, setTitle] = useState('태양광 발전설비 열화상 점검 보고서');
  const [busy, setBusy] = useState(false);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [reasonByReport, setReasonByReport] = useState<Record<string, string>>(
    {},
  );
  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await props.supabase.rpc('create_report_draft', {
        p_inspection_id: effectiveInspectionId,
        p_title: title.trim(),
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: `보고서 ${data.version}차 초안을 만들었습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function transitionStatus(report: Report, status: string) {
    setTransitioningId(report.id);
    props.setNotice(null);
    try {
      if (status === 'published')
        await requestReportPdf(props.supabase, report.id, true);
      const { error } = await props.supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_next_status: status,
        p_reason:
          status === 'draft' || status === 'withdrawn'
            ? reasonByReport[report.id]?.trim() || null
            : null,
      });
      if (error) throw error;
      setReasonByReport((current) => ({ ...current, [report.id]: '' }));
      props.setNotice({
        tone: 'success',
        text: `보고서를 ${statusLabel(status, reportStatuses)} 상태로 변경했습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setTransitioningId(null);
    }
  }
  const inspectionLabel = (id: string) =>
    props.inspections.find((item) => item.id === id)?.inspection_code ?? '점검';
  return (
    <>
      <PageHeading
        eyebrow="REPORT CONTROL"
        title={props.requesterMode ? '발행 보고서' : '보고서 버전·승인·발행'}
        copy={
          props.requesterMode
            ? undefined
            : '점검별로 버전을 나눠 보존하고 승인자와 발행 시각을 남깁니다. 전문가는 검토 요청까지, 최종 승인과 발행은 관리자만 처리합니다.'
        }
      />
      <div
        className={`grid gap-5 ${props.canCreate ? 'xl:grid-cols-[380px_1fr]' : ''}`}
      >
        {props.canCreate ? (
          <form
            onSubmit={create}
            className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">보고서 초안 만들기</h2>
            <Field label="점검">
              <select
                className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                value={effectiveInspectionId}
                onChange={(e) => setInspectionId(e.target.value)}
              >
                {props.inspections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {inspectionLabel(item.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="보고서 제목">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={!effectiveInspectionId || busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}초안 생성
            </Button>
          </form>
        ) : null}
        <section className="space-y-3">
          {props.reports.map((report) => (
            <article
              key={report.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{report.title}</strong>
                    <StatusPill>{report.version}차</StatusPill>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {inspectionLabel(report.inspection_id)} · 생성{' '}
                    {formatDateTime(report.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/reports/${report.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`${buttonVariants({ variant: 'outline', size: 'sm' })} min-h-11`}
                  >
                    <FileText /> 보고서 보기
                  </Link>
                  <StatusPill>
                    {statusLabel(report.status, reportStatuses)}
                  </StatusPill>
                </div>
              </div>
              {props.canCreate && report.status === 'draft' && (
                <div className="mt-4 flex justify-end border-t pt-4">
                  <Button
                    size="sm"
                    disabled={transitioningId === report.id}
                    onClick={() => void transitionStatus(report, 'review')}
                  >
                    {transitioningId === report.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <FileCheck2 />
                    )}
                    검토 요청
                  </Button>
                </div>
              )}
              {props.canApprove &&
                ['review', 'approved', 'published'].includes(report.status) && (
                  <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[1fr_auto] md:items-end">
                    <Field
                      label={
                        report.status === 'published'
                          ? '회수 사유'
                          : '수정·승인 취소 사유'
                      }
                      hint={
                        report.status === 'published'
                          ? '필수'
                          : report.status === 'review'
                            ? '수정 요청 시 필수'
                            : '승인 취소 시 필수'
                      }
                    >
                      <Input
                        value={reasonByReport[report.id] ?? ''}
                        onChange={(event) =>
                          setReasonByReport((current) => ({
                            ...current,
                            [report.id]: event.target.value,
                          }))
                        }
                        placeholder="변경 사유를 기록하세요"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {report.status === 'review' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={transitioningId === report.id}
                            onClick={() =>
                              void transitionStatus(report, 'draft')
                            }
                          >
                            수정 요청
                          </Button>
                          <Button
                            size="sm"
                            disabled={transitioningId === report.id}
                            onClick={() =>
                              void transitionStatus(report, 'approved')
                            }
                          >
                            보고서 승인
                          </Button>
                        </>
                      )}
                      {report.status === 'approved' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={transitioningId === report.id}
                            onClick={() =>
                              void transitionStatus(report, 'draft')
                            }
                          >
                            승인 취소
                          </Button>
                          <Button
                            size="sm"
                            disabled={transitioningId === report.id}
                            onClick={() =>
                              void transitionStatus(report, 'published')
                            }
                          >
                            최종 발행
                          </Button>
                        </>
                      )}
                      {report.status === 'published' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={transitioningId === report.id}
                          onClick={() =>
                            void transitionStatus(report, 'withdrawn')
                          }
                        >
                          발행본 회수
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              {report.change_reason && (
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  최근 변경 사유: {report.change_reason}
                </p>
              )}
            </article>
          ))}
          {props.reports.length === 0 && (
            <EmptyState
              icon={FileText}
              title="작성된 보고서가 없습니다"
              copy="완료할 점검을 선택하고 첫 초안을 만들어 보세요."
            />
          )}
        </section>
      </div>
    </>
  );
}

function MaintenanceView(props: SharedProps & { canWrite: boolean }) {
  const [inspectionId, setInspectionId] = useState('');
  const [title, setTitle] = useState('열화상 이상 후보 현장 점검');
  const [priority, setPriority] = useState('normal');
  const [vendor, setVendor] = useState('');
  const [busy, setBusy] = useState(false);
  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';
  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await props.supabase
        .from('maintenance_requests')
        .insert({
          organization_id: props.organizationId,
          inspection_id: effectiveInspectionId,
          title: title.trim(),
          priority,
          status: 'requested',
          vendor_name: vendor.trim() || null,
          created_by: props.session.user.id,
        });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '유지보수 요청을 등록했습니다.',
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  async function updateStatus(item: Maintenance, status: string) {
    const updates: Database['public']['Tables']['maintenance_requests']['Update'] =
      { status };
    if (status === 'completed') updates.completed_at = new Date().toISOString();
    const { error } = await props.supabase
      .from('maintenance_requests')
      .update(updates)
      .eq('id', item.id);
    if (error) props.setNotice({ tone: 'error', text: errorMessage(error) });
    else {
      props.setNotice({ tone: 'success', text: '조치 상태를 변경했습니다.' });
      await props.refresh();
    }
  }
  const inspectionLabel = (id: string) =>
    props.inspections.find((item) => item.id === id)?.inspection_code ?? '점검';
  return (
    <>
      <PageHeading
        eyebrow="MAINTENANCE LOOP"
        title="유지보수 요청·조치 이력"
        copy="판정 결과에서 후속 조치를 만들고, 배정·견적·일정·완료 상태를 한 흐름으로 남깁니다."
      />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <form
          onSubmit={create}
          className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold">새 조치 요청</h2>
          {!props.canWrite && <ReadOnlyNote />}
          <Field label="관련 점검">
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
              value={effectiveInspectionId}
              onChange={(e) => setInspectionId(e.target.value)}
              disabled={!props.canWrite}
            >
              {props.inspections.map((item) => (
                <option key={item.id} value={item.id}>
                  {inspectionLabel(item.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="작업명">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!props.canWrite}
              required
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="우선순위">
              <select
                className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={!props.canWrite}
              >
                <option value="low">낮음</option>
                <option value="normal">보통</option>
                <option value="high">높음</option>
                <option value="urgent">긴급</option>
              </select>
            </Field>
            <Field label="업체">
              <Input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                disabled={!props.canWrite}
              />
            </Field>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!props.canWrite || !effectiveInspectionId || busy}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}조치 요청
            등록
          </Button>
        </form>
        <section className="space-y-3">
          {props.maintenance.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <strong>{item.title}</strong>
                    <StatusPill>
                      {item.priority === 'urgent'
                        ? '긴급'
                        : item.priority === 'high'
                          ? '높음'
                          : item.priority === 'low'
                            ? '낮음'
                            : '보통'}
                    </StatusPill>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {inspectionLabel(item.inspection_id)} ·{' '}
                    {item.vendor_name || '업체 미정'} · 등록{' '}
                    {formatDateTime(item.created_at)}
                  </p>
                </div>
                <select
                  className="h-9 rounded-lg border bg-white px-3 text-sm font-semibold"
                  value={item.status}
                  onChange={(e) => void updateStatus(item, e.target.value)}
                  disabled={!props.canWrite}
                >
                  {maintenanceStatuses.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </article>
          ))}
          {props.maintenance.length === 0 && (
            <EmptyState
              icon={Wrench}
              title="등록된 조치가 없습니다"
              copy="판정이 끝난 점검에서 필요한 현장 조치를 등록하세요."
            />
          )}
        </section>
      </div>
    </>
  );
}

function PartnerQuotesView(
  props: SharedProps & { canWrite: boolean; requesterMode: boolean },
) {
  const [name, setName] = useState('');
  const [partnerType, setPartnerType] = useState('maintenance');
  const [serviceRegions, setServiceRegions] = useState('경기');
  const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingPartnerId, setSavingPartnerId] = useState<string | null>(null);
  const [quotePlantId, setQuotePlantId] = useState('');
  const [quoteRequesterId, setQuoteRequesterId] = useState('');
  const [quoteInspectionId, setQuoteInspectionId] = useState('');
  const [quoteMaintenanceId, setQuoteMaintenanceId] = useState('');
  const [quoteTitle, setQuoteTitle] = useState(
    '태양광 설비 유지보수 견적 요청',
  );
  const [quoteScope, setQuoteScope] = useState('');
  const [quoteDueAt, setQuoteDueAt] = useState('');
  const [commissionRate, setCommissionRate] = useState('0');
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [requestBusy, setRequestBusy] = useState(false);
  const [savingQuoteId, setSavingQuoteId] = useState<string | null>(null);
  const [selectingQuoteId, setSelectingQuoteId] = useState<string | null>(null);

  const partnerById = Object.fromEntries(
    props.partners.map((partner) => [partner.id, partner]),
  );
  const privateDetailsByPartnerId = Object.fromEntries(
    props.partnerPrivateDetails.map((detail) => [detail.partner_id, detail]),
  );
  const activePartners = props.partners.filter(
    (partner) => partner.status === 'active',
  );
  const linkedRequesters = props.plantRequesters.filter(
    (access) => access.plant_id === quotePlantId,
  );
  const linkedInspections = props.inspections.filter(
    (inspection) => inspection.plant_id === quotePlantId,
  );
  const linkedMaintenance = props.maintenance.filter((maintenance) =>
    linkedInspections.some(
      (inspection) => inspection.id === maintenance.inspection_id,
    ),
  );

  async function createPartner(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc('save_partner_profile', {
        p_organization_id: props.organizationId,
        p_partner_id: null,
        p_name: name,
        p_partner_type: partnerType,
        p_service_regions: splitRegions(serviceRegions),
        p_rating: rating ? Number(rating) : null,
        p_status: 'active',
        p_business_registration_number: formText(
          data,
          'business_registration_number',
        ),
        p_license_registration_number: formText(
          data,
          'license_registration_number',
        ),
        p_contact_name: formText(data, 'contact_name'),
        p_contact_email: formText(data, 'contact_email'),
        p_contact_phone: formText(data, 'contact_phone'),
        p_notes: formText(data, 'notes'),
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '업체의 기본정보와 담당자·면허 정보를 함께 등록했습니다.',
      });
      setName('');
      setRating('');
      form.reset();
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function updatePartner(
    event: SyntheticEvent<HTMLFormElement>,
    partner: Partner,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSavingPartnerId(partner.id);
    props.setNotice(null);
    try {
      const ratingValue = formText(data, 'rating').trim();
      const { error } = await props.supabase.rpc('save_partner_profile', {
        p_organization_id: props.organizationId,
        p_partner_id: partner.id,
        p_name: formText(data, 'name'),
        p_partner_type: formText(data, 'partner_type'),
        p_service_regions: splitRegions(formText(data, 'service_regions')),
        p_rating: ratingValue ? Number(ratingValue) : null,
        p_status: formText(data, 'status'),
        p_business_registration_number: formText(
          data,
          'business_registration_number',
        ),
        p_license_registration_number: formText(
          data,
          'license_registration_number',
        ),
        p_contact_name: formText(data, 'contact_name'),
        p_contact_email: formText(data, 'contact_email'),
        p_contact_phone: formText(data, 'contact_phone'),
        p_notes: formText(data, 'notes'),
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: `${partner.name} 업체 정보를 수정했습니다. 변경 기록도 저장했습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setSavingPartnerId(null);
    }
  }

  function togglePartner(partnerId: string) {
    setSelectedPartnerIds((current) =>
      current.includes(partnerId)
        ? current.filter((id) => id !== partnerId)
        : current.length < 3
          ? [...current, partnerId]
          : current,
    );
  }

  async function createQuoteRequest(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedPartnerIds.length !== 3) {
      props.setNotice({
        tone: 'error',
        text: '견적을 받을 업체 3곳을 선택하세요.',
      });
      return;
    }
    setRequestBusy(true);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc(
        'create_quote_request_with_partners',
        {
          p_plant_id: quotePlantId,
          p_requester_user_id: quoteRequesterId,
          p_title: quoteTitle.trim(),
          p_scope_summary: quoteScope.trim(),
          p_response_due_at: quoteDueAt
            ? new Date(quoteDueAt).toISOString()
            : null,
          p_partner_ids: selectedPartnerIds,
          p_inspection_id: quoteInspectionId || null,
          p_maintenance_request_id: quoteMaintenanceId || null,
          p_commission_rate: Number(commissionRate || 0),
        },
      );
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '견적 요청을 만들고 업체 3곳을 연결했습니다.',
      });
      setQuoteScope('');
      setQuoteDueAt('');
      setSelectedPartnerIds([]);
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setRequestBusy(false);
    }
  }

  async function saveQuote(
    event: SyntheticEvent<HTMLFormElement>,
    quoteId: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const days = formText(form, 'estimated_days').trim();
    setSavingQuoteId(quoteId);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc(
        'record_partner_quote_response',
        {
          p_quote_id: quoteId,
          p_amount_krw: Number(formText(form, 'amount_krw')),
          p_estimated_days: days ? Number(days) : null,
          p_proposed_start_on: formText(form, 'proposed_start_on') || null,
          p_valid_until: formText(form, 'valid_until') || null,
          p_scope: formText(form, 'scope'),
          p_conditions: formText(form, 'conditions'),
          p_commission_rate: Number(formText(form, 'commission_rate') || 0),
        },
      );
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '업체 견적 회신을 저장했습니다.',
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setSavingQuoteId(null);
    }
  }

  async function selectQuote(quoteId: string) {
    setSelectingQuoteId(quoteId);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc('select_partner_quote', {
        p_quote_id: quoteId,
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '업체를 선택했습니다. 선택 기록은 관리자 화면과 감사기록에 함께 남습니다.',
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setSelectingQuoteId(null);
    }
  }

  if (props.requesterMode) {
    return (
      <>
        <PageHeading
          eyebrow="QUOTE COMPARISON"
          title="업체 견적 비교·선택"
          copy="관리자가 회신을 확인한 견적만 표시됩니다. 금액·예상 기간·업체 평점을 비교하고 한 곳을 선택할 수 있습니다."
        />
        <section className="space-y-5">
          {props.quoteRequests.map((request) => {
            const quotes = props.partnerQuotes.filter(
              (quote) => quote.quote_request_id === request.id,
            );
            return (
              <article
                key={request.id}
                className="rounded-2xl border bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-3 border-b pb-4 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{request.title}</strong>
                      <StatusPill>
                        {quoteRequestStatusLabels[request.status] ??
                          request.status}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {request.scope_summary ||
                        '관리자가 작업 범위를 확인 중입니다.'}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">
                    {request.request_code}
                  </span>
                </div>
                {quotes.length > 0 ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {quotes.map((quote) => {
                      const partner = partnerById[quote.partner_id];
                      const selected = request.selected_quote_id === quote.id;
                      return (
                        <div
                          key={quote.id}
                          className={`rounded-2xl border p-4 ${
                            selected
                              ? 'border-teal-400 bg-teal-50'
                              : 'bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <strong className="text-sm">
                                {partner?.name || '업체 정보 확인 중'}
                              </strong>
                              <p className="mt-1 text-xs text-slate-500">
                                {partner
                                  ? partnerTypeLabels[partner.partner_type]
                                  : '업체'}{' '}
                                · 평점 {partner?.rating ?? '신규'}
                              </p>
                            </div>
                            {selected && <StatusPill>선택 완료</StatusPill>}
                          </div>
                          <strong className="mt-5 block text-xl text-slate-900">
                            {formatWon(quote.amount_krw)}
                          </strong>
                          <p className="mt-1 text-xs text-slate-500">
                            예상 기간{' '}
                            {quote.estimated_days
                              ? `${quote.estimated_days}일`
                              : '협의'}
                          </p>
                          {quote.scope && (
                            <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-600">
                              {quote.scope}
                            </p>
                          )}
                          <Button
                            className="mt-4 w-full"
                            size="sm"
                            variant={selected ? 'outline' : 'default'}
                            disabled={selected || selectingQuoteId !== null}
                            onClick={() => void selectQuote(quote.id)}
                          >
                            {selectingQuoteId === quote.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CheckCircle2 />
                            )}
                            {selected ? '선택한 업체' : '이 업체 선택'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    업체 회신을 기다리고 있습니다. 제출이 완료된 견적만 이곳에
                    표시됩니다.
                  </p>
                )}
              </article>
            );
          })}
          {props.quoteRequests.length === 0 && (
            <EmptyState
              icon={Handshake}
              title="진행 중인 견적 요청이 없습니다"
              copy="발행된 진단 결과에서 조치 항목을 정하면 관리자가 업체 3곳에 견적을 요청합니다."
            />
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="PARTNER & QUOTE"
        title="업체·견적 관리"
        copy="업체를 등록하고 견적 요청과 회신을 관리합니다."
      />
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <form
            onSubmit={createPartner}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <div>
              <h2 className="font-bold">업체 등록</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                공개 비교정보와 관리자 전용 연락처·등록정보를 함께 저장합니다.
              </p>
            </div>
            {!props.canWrite && <ReadOnlyNote />}
            <Field label="업체명">
              <Input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!props.canWrite}
                maxLength={160}
                required
              />
            </Field>
            <Field label="업체 유형">
              <select
                name="partner_type"
                className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                value={partnerType}
                onChange={(event) => setPartnerType(event.target.value)}
                disabled={!props.canWrite}
              >
                {Object.entries(partnerTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="가용 지역" hint="쉼표로 구분">
              <Input
                name="service_regions"
                value={serviceRegions}
                onChange={(event) => setServiceRegions(event.target.value)}
                disabled={!props.canWrite}
                placeholder="경기, 서울"
              />
            </Field>
            <Field label="평점" hint="신규 업체는 비워둘 수 있습니다.">
              <Input
                name="rating"
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={rating}
                onChange={(event) => setRating(event.target.value)}
                disabled={!props.canWrite}
              />
            </Field>
            <div className="border-t pt-4">
              <h3 className="text-sm font-bold text-slate-700">
                관리자 전용 상세정보
              </h3>
            </div>
            <Field label="사업자등록번호" hint="선택 사항 · 숫자 10자리">
              <Input
                name="business_registration_number"
                inputMode="numeric"
                maxLength={12}
                disabled={!props.canWrite}
                placeholder="123-45-67890"
              />
            </Field>
            <Field label="면허·등록번호" hint="선택 사항">
              <Input
                name="license_registration_number"
                maxLength={100}
                disabled={!props.canWrite}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="담당자명">
                <Input
                  name="contact_name"
                  maxLength={100}
                  disabled={!props.canWrite}
                />
              </Field>
              <Field label="담당자 연락처">
                <Input
                  name="contact_phone"
                  type="tel"
                  maxLength={50}
                  disabled={!props.canWrite}
                />
              </Field>
            </div>
            <Field label="담당자 이메일">
              <Input
                name="contact_email"
                type="email"
                maxLength={320}
                disabled={!props.canWrite}
              />
            </Field>
            <Field label="관리 메모">
              <Textarea
                name="notes"
                rows={3}
                maxLength={4000}
                disabled={!props.canWrite}
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={!props.canWrite || busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}
              업체 등록
            </Button>
          </form>
          <form
            onSubmit={createQuoteRequest}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <div>
              <h2 className="font-bold">새 견적 요청</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                의뢰인과 업체 3곳을 연결하면 요청과 회신 대기 건이 한 번에
                생성됩니다.
              </p>
            </div>
            <Field label="발전소">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                value={quotePlantId}
                onChange={(event) => {
                  const nextPlantId = event.target.value;
                  setQuotePlantId(nextPlantId);
                  setQuoteRequesterId(
                    props.plantRequesters.find(
                      (access) => access.plant_id === nextPlantId,
                    )?.requester_user_id ?? '',
                  );
                  setQuoteInspectionId('');
                  setQuoteMaintenanceId('');
                }}
                required
              >
                <option value="">발전소 선택</option>
                {props.plants.map((plant) => (
                  <option key={plant.id} value={plant.id}>
                    {plant.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="의뢰인">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                value={quoteRequesterId}
                onChange={(event) => setQuoteRequesterId(event.target.value)}
                disabled={!quotePlantId}
                required
              >
                <option value="">연결 의뢰인 선택</option>
                {linkedRequesters.map((access) => (
                  <option
                    key={access.requester_user_id}
                    value={access.requester_user_id}
                  >
                    {props.profiles[access.requester_user_id]?.display_name ||
                      props.profiles[access.requester_user_id]?.email ||
                      access.requester_user_id}
                  </option>
                ))}
              </select>
            </Field>
            {quotePlantId && linkedRequesters.length === 0 && (
              <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                이 발전소에 의뢰인이 연결되지 않았습니다. 발전소 관리에서 먼저
                의뢰인을 연결하세요.
              </p>
            )}
            <Field label="연결 점검" hint="선택 사항">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                value={quoteInspectionId}
                onChange={(event) => {
                  setQuoteInspectionId(event.target.value);
                  setQuoteMaintenanceId('');
                }}
                disabled={!quotePlantId}
              >
                <option value="">점검을 연결하지 않음</option>
                {linkedInspections.map((inspection) => (
                  <option key={inspection.id} value={inspection.id}>
                    {inspection.inspection_code} ·{' '}
                    {inspection.purpose || '점검'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="연결 유지보수" hint="선택 사항">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                value={quoteMaintenanceId}
                onChange={(event) => setQuoteMaintenanceId(event.target.value)}
                disabled={!quoteInspectionId}
              >
                <option value="">유지보수 항목을 연결하지 않음</option>
                {linkedMaintenance
                  .filter(
                    (maintenance) =>
                      maintenance.inspection_id === quoteInspectionId,
                  )
                  .map((maintenance) => (
                    <option key={maintenance.id} value={maintenance.id}>
                      {maintenance.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="요청 제목">
              <Input
                value={quoteTitle}
                onChange={(event) => setQuoteTitle(event.target.value)}
                maxLength={200}
                required
              />
            </Field>
            <Field label="작업 범위">
              <Textarea
                value={quoteScope}
                onChange={(event) => setQuoteScope(event.target.value)}
                rows={3}
                placeholder="교체·보수할 항목과 현장 조건"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="회신 마감">
                <Input
                  type="datetime-local"
                  value={quoteDueAt}
                  onChange={(event) => setQuoteDueAt(event.target.value)}
                />
              </Field>
              <Field label="수수료율(%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={commissionRate}
                  onChange={(event) => setCommissionRate(event.target.value)}
                  required
                />
              </Field>
            </div>
            <fieldset>
              <legend className="text-sm font-semibold text-slate-700">
                요청 업체 3곳
              </legend>
              <div className="mt-2 space-y-2">
                {activePartners.map((partner) => (
                  <label
                    key={partner.id}
                    aria-label={`${partner.name} 선택`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate">{partner.name}</strong>
                      <span className="text-xs text-slate-500">
                        {partnerTypeLabels[partner.partner_type] ||
                          partner.partner_type}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-teal-600"
                      checked={selectedPartnerIds.includes(partner.id)}
                      disabled={
                        !selectedPartnerIds.includes(partner.id) &&
                        selectedPartnerIds.length >= 3
                      }
                      onChange={() => togglePartner(partner.id)}
                    />
                  </label>
                ))}
                {activePartners.length < 3 && (
                  <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    사용 중인 업체를 최소 3곳 등록해야 견적 요청을 만들 수
                    있습니다.
                  </p>
                )}
              </div>
            </fieldset>
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={
                requestBusy ||
                !quotePlantId ||
                !quoteRequesterId ||
                selectedPartnerIds.length !== 3
              }
            >
              {requestBusy ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Handshake />
              )}
              업체 3곳에 요청 만들기
            </Button>
          </form>
        </div>

        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="font-bold">등록 업체 {props.partners.length}곳</h2>
              <span className="text-xs text-slate-400">관리자 전용</span>
            </div>
            <div className="divide-y">
              {props.partners.map((partner) => {
                const detail = privateDetailsByPartnerId[partner.id];
                return (
                  <details key={partner.id} className="group p-5">
                    <summary
                      aria-label={`${partner.name} 업체 정보 편집`}
                      className="flex cursor-pointer list-none flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
                    >
                      <div>
                        <strong className="text-sm">{partner.name}</strong>
                        <p className="mt-1 text-xs text-slate-500">
                          {partnerTypeLabels[partner.partner_type] ??
                            partner.partner_type}{' '}
                          ·{' '}
                          {partner.service_regions.join(', ') || '지역 미입력'}
                          {detail?.contact_name
                            ? ` · 담당 ${detail.contact_name}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill>
                          {partner.status === 'active'
                            ? `평점 ${partner.rating ?? '신규'}`
                            : partner.status === 'inactive'
                              ? '휴면'
                              : '차단'}
                        </StatusPill>
                        <span className="text-xs font-semibold text-teal-700 group-open:hidden">
                          정보 열기
                        </span>
                        <span className="hidden text-xs font-semibold text-teal-700 group-open:inline">
                          닫기
                        </span>
                      </div>
                    </summary>
                    <form
                      className="mt-5 space-y-4 border-t pt-5"
                      onSubmit={(event) => void updatePartner(event, partner)}
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="업체명">
                          <Input
                            name="name"
                            defaultValue={partner.name}
                            maxLength={160}
                            required
                          />
                        </Field>
                        <Field label="업체 유형">
                          <select
                            name="partner_type"
                            className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                            defaultValue={partner.partner_type}
                          >
                            {Object.entries(partnerTypeLabels).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                        <Field label="가용 지역" hint="쉼표로 구분">
                          <Input
                            name="service_regions"
                            defaultValue={partner.service_regions.join(', ')}
                            placeholder="경기, 서울"
                          />
                        </Field>
                        <Field label="평점">
                          <Input
                            name="rating"
                            type="number"
                            min="0"
                            max="5"
                            step="0.1"
                            defaultValue={partner.rating ?? ''}
                          />
                        </Field>
                        <Field label="업체 상태">
                          <select
                            name="status"
                            className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                            defaultValue={partner.status}
                          >
                            <option value="active">사용 중</option>
                            <option value="inactive">휴면</option>
                            <option value="blocked">차단</option>
                          </select>
                        </Field>
                        <Field
                          label="사업자등록번호"
                          hint="선택 사항 · 숫자 10자리"
                        >
                          <Input
                            name="business_registration_number"
                            inputMode="numeric"
                            maxLength={12}
                            defaultValue={
                              detail?.business_registration_number ?? ''
                            }
                          />
                        </Field>
                        <Field label="면허·등록번호">
                          <Input
                            name="license_registration_number"
                            maxLength={100}
                            defaultValue={
                              detail?.license_registration_number ?? ''
                            }
                          />
                        </Field>
                        <Field label="담당자명">
                          <Input
                            name="contact_name"
                            maxLength={100}
                            defaultValue={detail?.contact_name ?? ''}
                          />
                        </Field>
                        <Field label="담당자 연락처">
                          <Input
                            name="contact_phone"
                            type="tel"
                            maxLength={50}
                            defaultValue={detail?.contact_phone ?? ''}
                          />
                        </Field>
                        <Field label="담당자 이메일">
                          <Input
                            name="contact_email"
                            type="email"
                            maxLength={320}
                            defaultValue={detail?.contact_email ?? ''}
                          />
                        </Field>
                      </div>
                      <Field label="관리 메모">
                        <Textarea
                          name="notes"
                          rows={3}
                          maxLength={4000}
                          defaultValue={detail?.notes ?? ''}
                        />
                      </Field>
                      <Button
                        type="submit"
                        size="sm"
                        className="w-full sm:w-auto"
                        disabled={savingPartnerId !== null}
                      >
                        {savingPartnerId === partner.id ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <CheckCircle2 />
                        )}
                        업체 정보 저장
                      </Button>
                    </form>
                  </details>
                );
              })}
              {props.partners.length === 0 && (
                <p className="px-5 py-10 text-center text-sm text-slate-400">
                  왼쪽에서 첫 업체를 등록하세요.
                </p>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="font-bold">
                견적 요청 흐름 {props.quoteRequests.length}건
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                조치 항목 → 업체 3곳 요청 → 회신 → 의뢰인 선택 → 수수료 산정
              </p>
            </div>
            <div className="divide-y">
              {props.quoteRequests.map((request) => {
                const quotes = props.partnerQuotes.filter(
                  (quote) => quote.quote_request_id === request.id,
                );
                const requestLocked = [
                  'selected',
                  'completed',
                  'cancelled',
                ].includes(request.status);
                return (
                  <div key={request.id} className="p-4 sm:p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                      <div>
                        <strong className="text-sm">{request.title}</strong>
                        <p className="mt-1 text-xs text-slate-500">
                          {request.request_code} · 업체 {quotes.length}곳 연결 ·
                          회신{' '}
                          {
                            quotes.filter((quote) =>
                              [
                                'submitted',
                                'selected',
                                'not_selected',
                                'completed',
                              ].includes(quote.status),
                            ).length
                          }
                          건
                        </p>
                      </div>
                      <StatusPill>
                        {quoteRequestStatusLabels[request.status] ??
                          request.status}
                      </StatusPill>
                    </div>
                    {request.scope_summary && (
                      <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                        {request.scope_summary}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      회신 마감 {formatDateTime(request.response_due_at)}
                    </p>
                    <details className="mt-4 rounded-2xl border bg-slate-50">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
                        업체별 견적 입력·수정
                      </summary>
                      <div className="space-y-3 border-t p-3 sm:p-4">
                        {quotes.map((quote) => {
                          const partner = partnerById[quote.partner_id];
                          return (
                            <form
                              key={quote.id}
                              className="space-y-3 rounded-xl border bg-white p-4"
                              onSubmit={(event) =>
                                void saveQuote(event, quote.id)
                              }
                            >
                              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                                <div>
                                  <strong className="text-sm">
                                    {partner?.name || '업체 정보 확인 중'}
                                  </strong>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {partner
                                      ? partnerTypeLabels[partner.partner_type]
                                      : '업체'}{' '}
                                    ·{' '}
                                    {partnerQuoteStatusLabels[quote.status] ||
                                      quote.status}
                                  </p>
                                </div>
                                {quote.commission_amount_krw != null && (
                                  <span className="text-xs font-semibold text-slate-500">
                                    수수료{' '}
                                    {formatWon(quote.commission_amount_krw)}
                                  </span>
                                )}
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <Field label="견적 금액(원)">
                                  <Input
                                    name="amount_krw"
                                    type="number"
                                    min="0"
                                    step="1"
                                    defaultValue={quote.amount_krw ?? ''}
                                    disabled={requestLocked}
                                    required
                                  />
                                </Field>
                                <Field label="예상 기간(일)">
                                  <Input
                                    name="estimated_days"
                                    type="number"
                                    min="1"
                                    step="1"
                                    defaultValue={quote.estimated_days ?? ''}
                                    disabled={requestLocked}
                                  />
                                </Field>
                                <Field label="수수료율(%)">
                                  <Input
                                    name="commission_rate"
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    defaultValue={quote.commission_rate}
                                    disabled={requestLocked}
                                    required
                                  />
                                </Field>
                                <Field label="작업 시작 예정일">
                                  <Input
                                    name="proposed_start_on"
                                    type="date"
                                    defaultValue={quote.proposed_start_on ?? ''}
                                    disabled={requestLocked}
                                  />
                                </Field>
                                <Field label="견적 유효일">
                                  <Input
                                    name="valid_until"
                                    type="date"
                                    defaultValue={quote.valid_until ?? ''}
                                    disabled={requestLocked}
                                  />
                                </Field>
                              </div>
                              <Field label="작업 내용">
                                <Textarea
                                  name="scope"
                                  rows={2}
                                  defaultValue={quote.scope ?? ''}
                                  disabled={requestLocked}
                                />
                              </Field>
                              <Field label="조건·제외 사항">
                                <Textarea
                                  name="conditions"
                                  rows={2}
                                  defaultValue={quote.conditions ?? ''}
                                  disabled={requestLocked}
                                />
                              </Field>
                              <Button
                                type="submit"
                                size="sm"
                                className="w-full sm:w-auto"
                                disabled={
                                  requestLocked || savingQuoteId !== null
                                }
                              >
                                {savingQuoteId === quote.id ? (
                                  <Loader2 className="animate-spin" />
                                ) : (
                                  <CheckCircle2 />
                                )}
                                견적 회신 저장
                              </Button>
                            </form>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                );
              })}
              {props.quoteRequests.length === 0 && (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-semibold text-slate-600">
                    진행 중인 견적 요청이 없습니다.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    왼쪽 양식에서 발전소·의뢰인·업체 3곳을 선택해 요청을
                    시작하세요.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function MembersView(
  props: SharedProps & {
    workspace: Workspace;
    setWorkspace: (workspace: Workspace) => void;
    canWrite: boolean;
  },
) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'expert' | 'owner'>('expert');
  const [organizationName, setOrganizationName] = useState(
    props.workspace.organization.name,
  );
  const [busy, setBusy] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  async function addMember(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await props.supabase.functions.invoke(
        'invite-platform-user',
        {
          body: {
            organizationId: props.organizationId,
            email,
            role,
            displayName,
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      props.setNotice({
        tone: 'success',
        text: data?.invitationSent
          ? `${email.trim()} 주소로 ${roleLabels[role]} 초대 메일을 보냈습니다.`
          : '이미 가입된 계정에 권한을 바로 연결했습니다.',
      });
      setEmail('');
      setDisplayName('');
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  async function updateMember(
    member: Membership,
    updates: { role?: string; status?: string },
  ) {
    setBusyMemberId(member.user_id);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc('admin_update_member', {
        p_organization_id: props.organizationId,
        p_user_id: member.user_id,
        p_role: updates.role ?? member.role,
        p_status: updates.status ?? member.status,
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '사용자 역할과 계정 상태를 변경했습니다.',
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusyMemberId(null);
    }
  }
  async function saveOrganization(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const { data, error } = await props.supabase
      .from('organizations')
      .update({ name: organizationName.trim() })
      .eq('id', props.organizationId)
      .select('*')
      .single();
    if (error) props.setNotice({ tone: 'error', text: errorMessage(error) });
    else {
      props.setWorkspace({ ...props.workspace, organization: data });
      props.setNotice({ tone: 'success', text: '조직명을 변경했습니다.' });
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ACCESS CONTROL"
        title="계정·역할 관리"
        copy="의뢰인은 직접 가입하고, 전문가와 관리자는 초대 메일로 계정을 만듭니다. 관리자는 세 역할과 계정 상태를 모두 관리합니다."
      />
      <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <div className="space-y-5">
          <form
            onSubmit={addMember}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">전문가·관리자 초대</h2>
            {!props.canWrite && <ReadOnlyNote />}
            <p className="rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-800">
              초대받은 사용자가 메일의 링크를 열면 계정이 활성화됩니다. 의뢰인은
              로그인 화면에서 직접 가입합니다.
            </p>
            <Field label="이름">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!props.canWrite}
                maxLength={100}
              />
            </Field>
            <Field label="초대 이메일">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!props.canWrite}
                required
              />
            </Field>
            <Field label="역할">
              <select
                className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as 'expert' | 'owner')}
                disabled={!props.canWrite}
              >
                <option value="expert">전문가</option>
                <option value="owner">관리자</option>
              </select>
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={!props.canWrite || busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Users />}초대 메일
              보내기
            </Button>
          </form>
          <form
            onSubmit={saveOrganization}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">조직 설정</h2>
            <Field label="조직명">
              <Input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                disabled={!props.canWrite}
                required
              />
            </Field>
            <Field label="조직 식별자">
              <Input value={props.workspace.organization.slug} disabled />
            </Field>
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              disabled={!props.canWrite}
            >
              조직명 저장
            </Button>
          </form>
        </div>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-bold">연결 사용자 {props.members.length}명</h2>
          </div>
          <div className="divide-y">
            {props.members.map((member) => {
              const profile = props.profiles[member.user_id];
              return (
                <div
                  key={member.user_id}
                  className="flex flex-col items-stretch justify-between gap-4 p-5 sm:flex-row sm:items-center"
                >
                  <div>
                    <strong className="text-sm">
                      {profile?.display_name || '이름 미등록'}
                    </strong>
                    <p className="mt-1 text-xs text-slate-500">
                      {profile?.email || member.user_id}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-48 sm:flex-row">
                    <select
                      className="h-11 rounded-lg border bg-white px-3 text-sm font-semibold sm:h-9 sm:px-2 sm:text-xs"
                      value={member.role}
                      disabled={
                        !props.canWrite || busyMemberId === member.user_id
                      }
                      onChange={(e) =>
                        void updateMember(member, { role: e.target.value })
                      }
                      aria-label="사용자 역할"
                    >
                      <option value="client">의뢰인</option>
                      <option value="expert">전문가</option>
                      <option value="owner">관리자</option>
                    </select>
                    <select
                      className="h-11 rounded-lg border bg-white px-3 text-sm font-semibold sm:h-9 sm:px-2 sm:text-xs"
                      value={member.status}
                      disabled={
                        !props.canWrite || busyMemberId === member.user_id
                      }
                      onChange={(e) =>
                        void updateMember(member, { status: e.target.value })
                      }
                      aria-label="계정 상태"
                    >
                      <option value="invited">초대 대기</option>
                      <option value="active">사용 중</option>
                      <option value="suspended">사용 중지</option>
                    </select>
                    {busyMemberId === member.user_id && (
                      <Loader2 className="m-auto size-4 animate-spin text-teal-600" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
