'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  Children,
  isValidElement,
  type SyntheticEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SunMedium,
  ThermometerSun,
  Trash2,
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
import { parseAccountState, type AccountState } from '@/lib/account-access';
import {
  directoryMembers,
  directoryRoleCounts,
  memberRoleTabs,
  type MemberRoleTab,
} from '@/lib/member-directory';
import {
  workspaceCollections,
  type WorkspaceCollection,
} from '@/lib/workspace-load-plan';
import { backendConfig, getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Database, Json, Tables } from '@/lib/supabase/database.types';
import { AssessmentsView, CalculationSettingsView } from './live-assessments';
import { FindingsEditorView } from './live-findings';
import { ReportImagesView } from './live-report-images';
import { RecyclingView } from './live-recycling';
import { requestReportPdf } from '@/lib/report-download';
import { koreanDate, parseKoreanInput } from '@/lib/operational-assessment';
import {
  saveInspectionPreview,
  downloadInspectionOriginal,
} from '@/lib/inspection-preview';
import { InspectionPreviewButton } from './inspection-preview';
import { AccountProfile } from './live-profile';
import { InspectionScheduleEditor } from './live-inspection-schedule';
import { quoteSelectionLock } from '@/lib/quote-selection';
import { useDraftProtection } from '@/lib/use-draft-protection';
import { collectPagedRows, collectionRowKey } from '@/lib/paged-rows';
import { useGuardedAction } from '@/lib/use-guarded-action';
import { analyzePixels } from '@/lib/relative-analysis';
import { verifyOriginal } from '@/lib/original-integrity';
import { DraftChangeDialog } from './draft-change-dialog';
import { useSectionDraftProtection } from '@/lib/use-section-draft-protection';
import {
  inspectionLocked,
  inspectionRows,
  manualInspectionStatuses,
} from '@/lib/inspection-workflow';
import { draftNavigationState } from '@/lib/draft-navigation';
import { useWorkspaceLocation } from '@/lib/use-workspace-location';
import { roleViews, type WorkspaceView } from '@/lib/workspace-navigation';
import {
  InspectionSelectionProvider,
  useInspectionSelection,
  resolveInspectionSelection,
} from '@/lib/inspection-context';
import { ServiceSettingsView } from './live-service-settings';
import { CustomersView } from './live-customers';
import { AuditView } from './live-audit';
import { serviceRpc, type Onboarding } from '@/lib/service-access';
import {
  portalForRole,
  portalLabel,
  portalPath,
  portalTitle,
  type Portal,
} from '@/lib/portal';

type Plant = Tables<'plants'>;
type Inspection = Tables<'inspections'>;
type InspectionFile = Tables<'inspection_files'>;
type AnalysisRun = Tables<'analysis_runs'>;
type Finding = Tables<'findings'>;
type Report = Tables<'reports'> & {
  report_snapshots?: { sha256: string } | null;
};
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
  superAdminUserId: string | null;
};

type View = WorkspaceView;

type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

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
  { id: 'assessments', label: '경제성 분석·촬영조건', icon: Gauge },
  { id: 'calculation-settings', label: '계산·촬영 기준', icon: ClipboardCheck },
  { id: 'reports', label: '보고서', icon: FileText },
  { id: 'maintenance', label: '유지보수', icon: Wrench },
  { id: 'recycling', label: '재활용 인증서', icon: FileCheck2 },
  { id: 'partners', label: '업체·견적', icon: Handshake },
  { id: 'members', label: '관리자·사용자', icon: Users },
  { id: 'customers', label: '고객 관리', icon: Building2 },
  { id: 'service-settings', label: '운영 설정·약관', icon: ShieldCheck },
  { id: 'audit', label: '운영 이력', icon: FileCheck2 },
  { id: 'account', label: '내 계정', icon: KeyRound },
];

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    const authMessages: Record<string, string> = {
      invalid_credentials: '이메일 또는 비밀번호를 확인해 주세요.',
      email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.',
      same_password: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.',
      weak_password:
        '비밀번호가 너무 단순합니다. 다른 비밀번호를 입력해 주세요.',
      over_request_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
      email_address_not_authorized:
        '가입·초대 메일 발송 설정이 아직 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      over_email_send_rate_limit:
        '메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
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

export function LiveApp({
  portal = 'auto',
  signup = false,
}: {
  portal?: Portal;
  signup?: boolean;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [authProblem, setAuthProblem] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let current = true;
    const deadline = window.setTimeout(() => {
      if (current) {
        setAuthProblem(
          '로그인 정보를 불러오지 못했습니다. 다시 시도해 주세요.',
        );
        setLoading(false);
      }
    }, 20000);
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!current) return;
        window.clearTimeout(deadline);
        if (error)
          setAuthProblem(
            '로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.',
          );
        else {
          setSession(data.session);
          setAuthProblem('');
        }
        setLoading(false);
      })
      .catch(() => {
        if (current) {
          window.clearTimeout(deadline);
          setAuthProblem(
            '로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.',
          );
          setLoading(false);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthProblem('');
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
    });
    return () => {
      current = false;
      window.clearTimeout(deadline);
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  if (loading) return <FullScreenLoading label="불러오는 중입니다." />;
  if (!supabase) return <ConfigurationMissing />;
  if (authProblem)
    return (
      <main className="grid min-h-svh place-items-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-3xl border bg-white p-7">
          <Brand />
          <p role="alert" className="mt-7 text-sm">
            {authProblem}
          </p>
          <Button className="mt-5" onClick={() => window.location.reload()}>
            다시 불러오기
          </Button>
        </section>
      </main>
    );
  if (recoveringPassword && session) {
    return (
      <UpdatePasswordPanel
        supabase={supabase}
        onComplete={() => setRecoveringPassword(false)}
      />
    );
  }
  if (!session) return <AuthPanel supabase={supabase} signup={signup} />;
  return (
    <WorkspaceGate supabase={supabase} session={session} portal={portal} />
  );
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

function Brand({ onHome }: { onHome?: () => void } = {}) {
  return (
    <Link
      href="/"
      className="flex items-center gap-3"
      aria-label="SolarScope 홈"
      onClick={(event) => {
        // Modified clicks open another tab without destroying this draft.
        if (
          onHome &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onHome();
        }
      }}
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

function AuthPanel({
  supabase,
  signup = false,
}: {
  supabase: SupabaseClient<Database>;
  signup?: boolean;
}) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'resend'>(
    signup ? 'signup' : 'signin',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const authLock = useRef(false);
  const [busy, setBusy] = useState(false);
  // AuthPanel mounts only after LiveApp's client Auth read, never in the initial SSR tree.
  const [notice, setNotice] = useState<Notice>(() =>
    new URLSearchParams(window.location.hash.slice(1)).has('error')
      ? {
          tone: 'error',
          text: '링크가 만료되었거나 이미 사용되었습니다. 초대는 관리자에게 다시 요청하고, 비밀번호 재설정은 아래 메뉴를 이용해 주세요.',
        }
      : null,
  );

  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(
      () => setResendSeconds((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.has('error')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authLock.current || (mode === 'resend' && resendSeconds > 0)) return;
    authLock.current = true;
    setBusy(true);
    setNotice(null);
    const redirectTo =
      process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL?.trim() ||
      `${window.location.origin}/`;
    try {
      if (mode === 'resend') {
        setResendSeconds(60);
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email: email.trim(),
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        setNotice({
          tone: 'success',
          text: '인증 대기 중인 이메일이면 가입 인증 메일이 발송됩니다. 스팸함도 확인해 주세요. 관리자·전문가 초대는 관리자에게 재발송을 요청해 주세요.',
        });
      } else if (mode === 'forgot') {
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
        if (password !== passwordConfirm) {
          event.currentTarget
            .querySelector<HTMLInputElement>('[name="passwordConfirm"]')
            ?.focus();
          throw new Error('비밀번호 확인이 일치하지 않습니다.');
        }
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
          setResendSeconds(60);
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
      authLock.current = false;
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
                  : mode === 'resend'
                    ? '가입 인증 메일 다시 받기'
                    : '비밀번호 재설정'}
            </h1>
            {mode !== 'signin' && (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {mode === 'signup'
                  ? '이메일 인증 후 고객정보 입력과 이용 동의를 완료합니다. 전문가·관리자는 초대 메일로 가입해 주세요.'
                  : mode === 'resend'
                    ? '회원가입 때 입력한 이메일 주소를 입력해 주세요.'
                    : '가입한 이메일로 비밀번호 변경 링크를 보내드립니다.'}
              </p>
            )}
            <div className="mt-7">
              <NoticeBar notice={notice} />
            </div>
            <form onSubmit={submit} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
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
                {(mode === 'signin' || mode === 'signup') && (
                  <Field
                    label="비밀번호"
                    hint={mode === 'signup' ? '8자 이상' : undefined}
                  >
                    <Input
                      type={showPassword ? 'text' : 'password'}
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
                {mode === 'signup' && (
                  <Field
                    label="비밀번호 확인"
                    hint={
                      passwordConfirm && password !== passwordConfirm
                        ? '비밀번호가 일치하지 않습니다'
                        : undefined
                    }
                  >
                    <Input
                      name="passwordConfirm"
                      type={showPassword ? 'text' : 'password'}
                      aria-invalid={Boolean(
                        passwordConfirm && password !== passwordConfirm,
                      )}
                      autoComplete="new-password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      required
                      minLength={8}
                    />
                  </Field>
                )}
                {(mode === 'signin' || mode === 'signup') && (
                  <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={(e) => setShowPassword(e.target.checked)}
                      className="size-4"
                    />
                    비밀번호 표시
                  </label>
                )}
                <Button
                  type="submit"
                  className="h-11 w-full"
                  disabled={busy || (mode === 'resend' && resendSeconds > 0)}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  {busy
                    ? mode === 'signin'
                      ? '로그인 중…'
                      : '메일 발송 중…'
                    : mode === 'signin'
                      ? '로그인'
                      : mode === 'signup'
                        ? '가입 메일 받기'
                        : mode === 'resend'
                          ? resendSeconds
                            ? `${resendSeconds}초 후 재발송 가능`
                            : '인증 메일 다시 받기'
                          : '변경 메일 받기'}
                  {!busy && <ArrowRight />}
                </Button>
              </fieldset>
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
                disabled={busy}
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
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'forgot' ? 'signin' : 'forgot');
                  setNotice(null);
                }}
              >
                {mode === 'forgot'
                  ? '로그인으로 돌아가기'
                  : '비밀번호를 잊으셨나요?'}
              </button>
              <button
                className="min-h-11 text-slate-500 hover:text-teal-700"
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(mode === 'resend' ? 'signin' : 'resend');
                  setNotice(null);
                }}
              >
                {mode === 'resend'
                  ? '로그인으로 돌아가기'
                  : '가입 인증 메일을 못 받으셨나요?'}
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
  initialSetup = false,
  onSignOut,
}: {
  supabase: SupabaseClient<Database>;
  onComplete?: () => void;
  embedded?: boolean;
  initialSetup?: boolean;
  onSignOut?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      setNotice({
        tone: 'success',
        text: initialSetup
          ? '비밀번호를 설정했습니다. 계속하기를 눌러 시작하세요.'
          : '비밀번호를 변경했습니다.',
      });
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
      <Heading className="mt-5 text-2xl font-bold">
        {initialSetup ? '비밀번호 생성' : '비밀번호 변경'}
      </Heading>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {initialSetup
          ? '초대를 수락하셨습니다. 서비스를 시작하려면 다른 곳에서 사용하지 않는 8자 이상의 비밀번호를 먼저 설정해 주세요.'
          : '다른 서비스에서 사용하지 않는 8자 이상의 비밀번호를 입력하세요.'}
      </p>
      <div className="mt-5">
        <NoticeBar notice={notice} />
      </div>
      <form className="space-y-4" onSubmit={updatePassword}>
        <Field label="새 비밀번호">
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="새 비밀번호 확인">
          <Input
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
            className="size-4"
          />
          비밀번호 표시
        </label>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {busy
            ? '저장 중…'
            : initialSetup
              ? '비밀번호 설정하고 시작하기'
              : '비밀번호 변경'}
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
      {onSignOut && (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 h-11 w-full"
          disabled={busy}
          onClick={onSignOut}
        >
          로그아웃
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
  const required = Children.toArray(children).some(
    (child) =>
      isValidElement<{ required?: boolean }>(child) && child.props.required,
  );
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-semibold text-slate-700">
        <span>
          {label}
          {required && (
            <small className="ml-1.5 text-xs font-normal text-teal-700">
              필수
            </small>
          )}
        </span>
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
  portal,
}: {
  supabase: SupabaseClient<Database>;
  session: Session;
  portal: Portal;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [accountState, setAccountState] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const workspaceRead = useRef<{
    sequence: number;
    controller: AbortController | null;
  }>({ sequence: 0, controller: null });

  const loadWorkspace = useCallback(async () => {
    const sequence = ++workspaceRead.current.sequence;
    workspaceRead.current.controller?.abort();
    const controller = new AbortController();
    workspaceRead.current.controller = controller;
    const timer = window.setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setNotice(null);
    setWorkspace(null);
    setOnboarding(null);
    try {
      const { data: stateData, error: stateError } = await supabase
        .rpc('get_my_account_state')
        .abortSignal(controller.signal);
      if (stateError) throw stateError;
      if (sequence !== workspaceRead.current.sequence) return;
      const state = parseAccountState(stateData);
      setAccountState(state);
      if (state.needsInitialPassword || state.accessRemoved) return;
      const { data: membership, error: memberError } = await supabase
        .from('organization_members')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('created_at')
        .limit(1)
        .abortSignal(controller.signal)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!membership) {
        setWorkspace(null);
        return;
      }
      const details = await serviceRpc<Onboarding>(
        supabase,
        'get_service_onboarding',
        { p_org: membership.organization_id },
        controller.signal,
      );
      if (sequence !== workspaceRead.current.sequence) return;
      setOnboarding(details);
      if (!details.ready) return;
      if (portal === 'auto') {
        window.location.replace(portalPath(membership.role));
        return;
      }
      const { data: organization, error: organizationError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', membership.organization_id)
        .abortSignal(controller.signal)
        .single();
      if (organizationError) throw organizationError;
      if (sequence !== workspaceRead.current.sequence) return;
      setWorkspace({
        membership,
        organization,
        superAdminUserId: state.superAdminUserId,
      });
    } catch (error) {
      if (sequence === workspaceRead.current.sequence)
        setNotice({
          tone: 'error',
          text: controller.signal.aborted
            ? '계정 조회가 지연됩니다. 다시 확인을 눌러 주세요.'
            : errorMessage(error),
        });
    } finally {
      window.clearTimeout(timer);
      if (sequence === workspaceRead.current.sequence) setLoading(false);
    }
  }, [session.user.id, supabase, portal]);

  useEffect(() => {
    const read = workspaceRead.current;
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => {
      window.clearTimeout(timer);
      read.sequence++;
      read.controller?.abort();
    };
  }, [loadWorkspace]);

  if (loading) return <FullScreenLoading label="불러오는 중입니다." />;
  if (accountState?.needsInitialPassword) {
    return (
      <UpdatePasswordPanel
        supabase={supabase}
        initialSetup
        onComplete={() => void loadWorkspace()}
        onSignOut={() => void supabase.auth.signOut()}
      />
    );
  }
  if (accountState?.accessRemoved || notice?.tone === 'error') {
    return (
      <main className="grid min-h-svh place-items-center bg-[#eef3f5] px-4 py-8">
        <section className="w-full max-w-md rounded-3xl border bg-white p-6 shadow-sm">
          <Brand />
          <h1 className="mt-8 text-xl font-bold">
            {accountState?.accessRemoved
              ? '접근권한이 해제되었습니다'
              : '계정 확인이 필요합니다'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {accountState?.accessRemoved
              ? '이 작업공간의 관리자 계정이 삭제되었습니다. 이용이 필요하면 담당 관리자에게 문의해 주세요.'
              : notice?.text}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-6 h-11 w-full"
            onClick={() => void loadWorkspace()}
          >
            다시 확인
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 h-11 w-full"
            onClick={() => void supabase.auth.signOut()}
          >
            로그아웃
          </Button>
        </section>
      </main>
    );
  }
  if (onboarding && !onboarding.ready && accountState?.organizationId) {
    return (
      <main className="min-h-svh bg-[#eef3f5] px-4 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <Brand />
            <Button
              variant="ghost"
              onClick={() => void supabase.auth.signOut()}
            >
              로그아웃
            </Button>
          </div>
          <AccountProfile
            supabase={supabase}
            organizationId={accountState.organizationId}
            initial={onboarding}
            required
            onComplete={() => void loadWorkspace()}
          />
        </div>
      </main>
    );
  }
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
  if (
    portal !== 'auto' &&
    portalForRole(workspace.membership.role) !== portal
  ) {
    return (
      <main className="grid min-h-svh place-items-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-3xl border bg-white p-7">
          <Brand />
          <h1 className="mt-8 text-xl font-bold">
            내 작업공간으로 이동해 주세요
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            현재 계정은 {roleLabels[workspace.membership.role]} 계정입니다.
          </p>
          <Link
            href={portalPath(workspace.membership.role)}
            className={buttonVariants({ className: 'mt-6 w-full min-h-11' })}
          >
            {portalTitle(workspace.membership.role)} 열기
          </Link>
        </section>
      </main>
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialNotice);
  const lock = useRef(false);
  async function connect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.rpc('register_requester');
      if (error) throw error;
      await onReady();
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-svh place-items-center bg-[#eef3f5] px-4 py-8">
      <section className="w-full max-w-lg rounded-3xl border bg-white p-7 sm:p-9">
        <Brand />
        <h1 className="mt-9 text-2xl font-bold">고객 가입 마무리</h1>
        <p className="mt-4 break-all text-sm text-slate-600">
          {session.user.email}
        </p>
        <ol className="mt-7 space-y-3 text-sm">
          <li className="text-teal-700">1. 이메일 인증 완료</li>
          <li className="font-semibold">2. 고객 계정 연결</li>
          <li className="text-slate-500">3. 고객정보 입력·이용 동의</li>
        </ol>
        <p className="mt-6 text-sm leading-7 text-slate-600">
          계속하면 개인 또는 사업자 고객 정보를 입력할 수 있습니다.
          전문가·관리자는 관리자의 초대 메일을 이용해 주세요.
        </p>
        <div className="mt-5">
          <NoticeBar notice={notice} />
        </div>
        <Button
          className="mt-3 min-h-11 w-full"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}고객정보
          입력으로 계속
        </Button>
        <Button
          variant="ghost"
          className="mt-3 min-h-11 w-full"
          disabled={busy}
          onClick={() => void supabase.auth.signOut()}
        >
          다른 계정으로 로그인
        </Button>
      </section>
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
  const router = useRouter();
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [notice, setNotice] = useState<Notice>(null);
  const navigation = useWorkspaceLocation(
    initialWorkspace.membership.role,
    () =>
      setNotice({
        tone: 'info',
        text: '저장 결과를 확인하는 중입니다. 완료 후 이동해 주세요.',
      }),
  );
  const view = navigation.view;
  const replaceInspection = navigation.replaceInspection;
  const selectedInspection = navigation.inspectionId;
  type Destination =
    | View
    | 'home'
    | 'refresh'
    | 'logout'
    | `inspection:${string}`;
  const [pendingNavigation, setPendingNavigation] =
    useState<Destination | null>(null);
  const performNavigation = (next: Destination) => {
    setNotice(null);
    if (next === 'refresh') void refresh(true);
    else if (next === 'home') router.push('/');
    else if (next === 'logout') void supabase.auth.signOut();
    else if (next.startsWith('inspection:'))
      navigation.go({ view, inspectionId: next.slice(11) });
    else
      navigation.go({ view: next as View, inspectionId: selectedInspection });
  };
  const requestNavigation = (next: Destination) => {
    if (next === view) return;
    const state = draftNavigationState(window);
    if (state === 'busy') {
      setNotice({
        tone: 'info',
        text: '저장 결과를 확인하는 중입니다. 완료 후 이동해 주세요.',
      });
    } else if (state === 'dirty') setPendingNavigation(next);
    else performNavigation(next);
  };
  const changeView = (next: View) => requestNavigation(next);
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
  const [quoteRequesters, setQuoteRequesters] = useState<
    Array<{ plant_id: string; requester_user_id: string }>
  >([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [loadedView, setLoadedView] = useState<View | null>(null);
  const [viewRefreshEpoch, setViewRefreshEpoch] = useState(0);
  const readRequest = useRef({
    sequence: 0,
    controller: null as AbortController | null,
  });
  const currentView = useRef(view);
  useLayoutEffect(() => {
    currentView.current = view;
  }, [view]);

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
  const currentInspection = inspections.find(
    (i) => i.id === resolveInspectionSelection(selectedInspection, inspections),
  );
  const selectedLocked = inspectionLocked(currentInspection?.status);
  const visibleNavItems = navItems.filter((item) =>
    (roleViews[role] ?? ['dashboard']).includes(item.id),
  );

  const refresh = useCallback(
    async (reloadView = false) => {
      if (currentView.current !== view) return;
      readRequest.current.controller?.abort();
      const sequence = ++readRequest.current.sequence;
      const controller = new AbortController();
      readRequest.current.controller = controller;
      const current = () =>
        readRequest.current.sequence === sequence &&
        currentView.current === view;
      const timeout = window.setTimeout(() => controller.abort(), 20_000);
      const needed = workspaceCollections(view, role);
      setLoading(true);
      try {
        const { data: stateData, error: stateError } = await supabase
          .rpc('get_my_account_state')
          .abortSignal(controller.signal);
        if (!current()) return;
        if (stateError) throw stateError;
        const accountState = parseAccountState(stateData);
        if (
          accountState.accessRemoved ||
          accountState.needsInitialPassword ||
          accountState.organizationId !== organizationId
        ) {
          await supabase.auth.signOut();
          throw new Error('현재 계정으로 이 작업공간을 이용할 수 없습니다.');
        }
        setWorkspace((current) =>
          current.superAdminUserId === accountState.superAdminUserId
            ? current
            : { ...current, superAdminUserId: accountState.superAdminUserId },
        );
        const readiness = await serviceRpc<Onboarding>(
          supabase,
          'get_service_onboarding',
          { p_org: organizationId },
          controller.signal,
        );
        if (!readiness.ready || readiness.role !== role) {
          window.location.assign('/login');
          return;
        }
        const scoped = <T,>(
          collection: WorkspaceCollection,
          request: (count: 'exact' | undefined) => PromiseLike<{
            data: T[] | null;
            error: unknown;
            count: number | null;
          }> & {
            abortSignal(signal: AbortSignal): ReturnType<typeof request>;
            range(from: number, to: number): ReturnType<typeof request>;
            order(column: string): ReturnType<typeof request>;
          },
        ) =>
          needed.includes(collection)
            ? collectPagedRows(
                (from, to) =>
                  request(from === 0 ? 'exact' : undefined)
                    .range(from, to)
                    .abortSignal(controller.signal),
                controller.signal,
                collectionRowKey,
              )
            : Promise.resolve({ data: null, error: null });
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
          scoped('plants', (count) =>
            supabase
              .from('plants')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('name')
              .order('id'),
          ),
          scoped('inspections', (count) =>
            supabase
              .from('inspections')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('inspection_files', (count) =>
            supabase
              .from('inspection_files')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('analysis_runs', (count) =>
            supabase
              .from('analysis_runs')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('requested_at', { ascending: false })
              .order('id'),
          ),
          scoped('findings', (count) =>
            supabase
              .from('findings')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('reports', (count) =>
            supabase
              .from('reports')
              .select('*,report_snapshots(sha256)', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('maintenance_requests', (count) =>
            supabase
              .from('maintenance_requests')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('partners', (count) =>
            supabase
              .from('partners')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('name')
              .order('id'),
          ),
          scoped('partner_private_details', (count) =>
            supabase
              .from('partner_private_details')
              .select('*', { count })
              .order('created_at')
              .order('partner_id'),
          ),
          scoped('quote_requests', (count) =>
            supabase
              .from('quote_requests')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('partner_quotes', (count) =>
            supabase
              .from('partner_quotes')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .order('created_at', { ascending: false })
              .order('id'),
          ),
          scoped('plant_requesters', (count) =>
            supabase
              .from('plant_requesters')
              .select('*', { count })
              .order('created_at')
              .order('plant_id')
              .order('requester_user_id'),
          ),
          scoped('organization_members', (count) =>
            supabase
              .from('organization_members')
              .select('*', { count })
              .eq('organization_id', organizationId)
              .neq('status', 'removed')
              .order('created_at')
              .order('user_id'),
          ),
        ]);
        if (!current()) return;
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
        const nextMembers = (memberResult.data ?? []) as Membership[];
        let nextProfiles: Record<string, Profile> = {};
        if (nextMembers.length) {
          const profileRows: Profile[] = [];
          for (let at = 0; at < nextMembers.length; at += 200) {
            const { data: batch, error } = await collectPagedRows(
              (from, to) =>
                supabase
                  .from('profiles')
                  .select('*', { count: 'exact' })
                  .in(
                    'user_id',
                    nextMembers
                      .slice(at, at + 200)
                      .map((member) => member.user_id),
                  )
                  .order('user_id')
                  .range(from, to)
                  .abortSignal(controller.signal),
              controller.signal,
              collectionRowKey,
            );
            if (!current()) return;
            if (error) throw error;
            profileRows.push(...batch);
          }
          nextProfiles = Object.fromEntries(
            (profileRows ?? []).map((profile) => [profile.user_id, profile]),
          );
        }
        if (!current()) return;
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
        setPlantRequesters(
          (plantRequesterResult.data ?? []) as PlantRequester[],
        );
        if (view === 'partners' && isOwner) {
          const eligible = await supabase
            .rpc('get_quote_requesters', { p_org: organizationId })
            .abortSignal(controller.signal);
          if (!current()) return;
          if (eligible.error) throw eligible.error;
          setQuoteRequesters(eligible.data ?? []);
        } else setQuoteRequesters([]);
        setMembers(nextMembers);
        setProfiles(nextProfiles);
        setLoadedView(view);
        // Explicit header refresh reloads independent child queries too. A write's
        // normal refresh never remounts unrelated drafts, and failed reads keep them.
        if (reloadView) setViewRefreshEpoch((value) => value + 1);
      } catch (error) {
        if (current())
          setNotice({
            tone: 'error',
            text: controller.signal.aborted
              ? '연결이 오래 걸려 조회를 중단했습니다. 다시 불러오기를 눌러 주세요.'
              : errorMessage(error),
          });
      } finally {
        window.clearTimeout(timeout);
        if (current()) setLoading(false);
      }
    },
    [organizationId, supabase, view, role, isOwner],
  );

  useEffect(() => {
    if (!navigation.ready) return;
    const read = readRequest.current;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      read.sequence++;
      read.controller?.abort();
    };
  }, [refresh, navigation.ready]);

  useEffect(() => {
    if (
      navigation.ready &&
      loadedView === view &&
      workspaceCollections(view, role).includes('inspections')
    )
      replaceInspection(
        resolveInspectionSelection(selectedInspection, inspections),
      );
  }, [
    navigation.ready,
    loadedView,
    view,
    role,
    selectedInspection,
    inspections,
    replaceInspection,
  ]);

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
    quoteRequesters,
    members,
    profiles,
    refresh,
    setNotice,
  };

  return (
    <InspectionSelectionProvider
      value={{
        id: selectedInspection,
        select: (id) => {
          if (!inspections.some((item) => item.id === id)) return false;
          if (
            id === resolveInspectionSelection(selectedInspection, inspections)
          )
            return false;
          const clean = draftNavigationState(window) === 'clean';
          requestNavigation(`inspection:${id}`);
          return clean;
        },
      }}
    >
      <div className="min-h-screen bg-[#f2f5f6] text-slate-900">
        <AlertDialog
          open={pendingNavigation !== null || navigation.pending !== null}
          onOpenChange={(open) => {
            if (!open) {
              setPendingNavigation(null);
              navigation.cancelHistory();
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                입력한 내용을 두고 이동할까요?
              </AlertDialogTitle>
              <AlertDialogDescription>
                저장하지 않은 입력이 있습니다. 이동하면 이 화면의 입력이
                사라집니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>이어서 작성</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (navigation.pending) {
                    navigation.confirmHistory();
                    return;
                  }
                  if (pendingNavigation) {
                    if (draftNavigationState(window) === 'busy')
                      setNotice({
                        tone: 'info',
                        text: '저장 결과를 확인하는 중입니다. 완료 후 이동해 주세요.',
                      });
                    else performNavigation(pendingNavigation);
                  }
                  setPendingNavigation(null);
                }}
              >
                저장하지 않고 이동
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4 px-4 md:px-6">
            <Brand onHome={() => requestNavigation('home')} />
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <strong className="block text-sm">{portalTitle(role)}</strong>
                <span className="block text-xs text-slate-500">
                  {roleLabels[role]} · {session.user.email}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                aria-label="새로고침"
                onClick={() => requestNavigation('refresh')}
                disabled={loading}
              >
                <RefreshCw className={loading ? 'animate-spin' : ''} />
                <span className="hidden md:inline">새로고침</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="로그아웃"
                onClick={() => requestNavigation('logout')}
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
                changeView(event.target.value as View);
              }}
              aria-label="작업 메뉴"
            >
              {visibleNavItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {portalLabel(role, item.id, item.label)}
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
                      changeView(item.id);
                    }}
                    className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition md:w-full ${
                      view === item.id
                        ? 'bg-teal-50 text-teal-800'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="size-4" />{' '}
                    {portalLabel(role, item.id, item.label)}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 p-3 sm:p-4 md:p-6 lg:p-8">
            <NoticeBar notice={notice} />
            {loadedView !== view ? (
              <div className="grid min-h-[55vh] place-items-center">
                {loading ? (
                  <Loader2
                    aria-label="자료 불러오는 중"
                    className="size-7 animate-spin text-teal-600"
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refresh()}
                  >
                    다시 불러오기
                  </Button>
                )}
              </div>
            ) : (
              <div key={viewRefreshEpoch} className="contents">
                {canUpload &&
                  [
                    'files',
                    'findings',
                    'report-images',
                    'assessments',
                    'reports',
                  ].includes(view) && (
                    <section
                      className="mb-5 rounded-2xl border bg-white p-4"
                      aria-label="점검 작업 순서"
                    >
                      <p className="mb-3 text-sm font-semibold">
                        {inspections.find(
                          (i) =>
                            i.id ===
                            resolveInspectionSelection(
                              selectedInspection,
                              inspections,
                            ),
                        )?.inspection_code || '점검을 선택하세요'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ['files', '1. 사진 업로드'],
                            ['findings', '2. 소견 판정'],
                            ['report-images', '3. 보고서 사진'],
                            ['reports', '4. 보고서'],
                            ['assessments', '경제성 분석 (선택)'],
                          ] as const
                        ).map(([target, label]) => (
                          <Button
                            key={target}
                            type="button"
                            size="sm"
                            variant={view === target ? 'default' : 'outline'}
                            aria-current={view === target ? 'step' : undefined}
                            onClick={() => changeView(target)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    </section>
                  )}
                {selectedLocked &&
                  canUpload &&
                  [
                    'files',
                    'findings',
                    'report-images',
                    'assessments',
                    'reports',
                  ].includes(view) &&
                  currentInspection && (
                    <InspectionReopen
                      key={`reopen-${currentInspection.id}`}
                      {...shared}
                      inspection={currentInspection}
                      canReopen={isOwner}
                    />
                  )}
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
                        <dd className="mt-1 font-semibold">
                          {roleLabels[role]}
                        </dd>
                      </div>
                    </dl>
                    <div className="mb-5">
                      <AccountProfile
                        supabase={supabase}
                        organizationId={organizationId}
                      />
                    </div>
                    <UpdatePasswordPanel supabase={supabase} embedded />
                  </>
                )}
                {view === 'dashboard' && (
                  <DashboardView {...shared} setView={changeView} role={role} />
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
                  <FilesView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    canWrite={canUpload}
                  />
                )}
                {view === 'report-images' && canUpload && (
                  <ReportImagesView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    isOwner={isOwner}
                    readOnly={selectedLocked}
                  />
                )}
                {view === 'findings' && (
                  <FindingsEditorView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    canWrite={canReview && !selectedLocked}
                  />
                )}
                {view === 'assessments' && (
                  <AssessmentsView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    isOwner={isOwner}
                    readOnly={selectedLocked}
                  />
                )}
                {view === 'calculation-settings' && isOwner && (
                  <CalculationSettingsView {...shared} />
                )}
                {view === 'reports' && (
                  <ReportsView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    canCreate={canCreateReport}
                    canApprove={canApprove}
                    requesterMode={isRequester}
                  />
                )}
                {view === 'maintenance' && (
                  <MaintenanceView
                    key={resolveInspectionSelection(
                      selectedInspection,
                      inspections,
                    )}
                    {...shared}
                    canWrite={canMaintain}
                  />
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
                {view === 'service-settings' && isOwner && (
                  <ServiceSettingsView
                    supabase={supabase}
                    organizationId={organizationId}
                    onPublished={() => window.location.assign('/login')}
                  />
                )}
                {view === 'customers' && isOwner && (
                  <CustomersView
                    supabase={supabase}
                    organizationId={organizationId}
                    plants={plants}
                  />
                )}
                {view === 'audit' && isOwner && (
                  <AuditView
                    supabase={supabase}
                    organizationId={organizationId}
                  />
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </InspectionSelectionProvider>
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
  quoteRequesters: Array<{ plant_id: string; requester_user_id: string }>;
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

function DashboardView(
  props: SharedProps & { setView: (view: View) => void; role: string },
) {
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
      <PageHeading
        eyebrow={
          props.role === 'owner'
            ? 'ADMIN'
            : props.role === 'expert'
              ? 'EXPERT WORKSPACE'
              : 'MY SOLAR'
        }
        title={portalLabel(props.role, 'dashboard', '운영 현황')}
        copy={
          props.role === 'expert'
            ? '배정된 점검 자료를 확인하고 판정·보고서 작성을 진행하세요.'
            : props.role === 'client'
              ? '발전소 등록부터 점검 의뢰, 진단 보고서 확인까지 한곳에서 관리하세요.'
              : undefined
        }
        action={
          props.role !== 'owner' ? (
            <Button
              onClick={() =>
                props.setView(
                  props.role === 'expert' ? 'findings' : 'inspections',
                )
              }
            >
              {props.role === 'expert' ? '후보 검토하기' : '점검 의뢰하기'}
              <ArrowRight />
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label={
            props.role === 'expert'
              ? '배정 발전소'
              : props.role === 'client'
                ? '내 발전소'
                : '등록 발전소'
          }
          value={props.plants.length}
          note={props.role === 'owner' ? '조직 자산' : '접근 가능한 발전소'}
        />
        <MetricCard
          icon={ClipboardCheck}
          label="진행 점검"
          value={activeInspections.length}
          note="취소·종료 제외"
        />
        <MetricCard
          icon={ThermometerSun}
          label={props.role === 'client' ? '진단 보고서' : '검토 후보'}
          value={
            props.role === 'client'
              ? props.reports.filter((r) => r.status === 'published').length
              : pendingFindings.length
          }
          note={props.role === 'client' ? '발행된 보고서' : '전문가 판단 대기'}
        />
        <MetricCard
          icon={Wrench}
          label={props.role === 'expert' ? '검토 요청 보고서' : '진행 조치'}
          value={
            props.role === 'expert'
              ? props.reports.filter((r) => r.status === 'review').length
              : openMaintenance.length
          }
          note={props.role === 'expert' ? '관리자 검토 대기' : '완료·취소 제외'}
        />
      </div>

      {props.plants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={
            props.role === 'expert'
              ? '아직 배정된 점검이 없습니다'
              : '첫 발전소부터 등록하세요'
          }
          copy={
            props.role === 'expert'
              ? '관리자가 점검을 배정하면 이곳에 표시됩니다.'
              : '발전소를 등록한 뒤 점검을 의뢰할 수 있습니다.'
          }
          action={props.role === 'expert' ? '배정 점검 확인' : '발전소 등록'}
          onAction={() =>
            props.setView(props.role === 'expert' ? 'inspections' : 'plants')
          }
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
                    {props.role === 'client' && (
                      <div
                        className="mt-3 flex gap-1"
                        aria-label="점검 진행 단계"
                      >
                        {[
                          '접수',
                          '자료 검토',
                          '전문가 검토',
                          '보고서 발행',
                        ].map((label, index) => {
                          const step = ['published', 'closed'].includes(
                            inspection.status,
                          )
                            ? 3
                            : ['expert_review', 'approval'].includes(
                                  inspection.status,
                                )
                              ? 2
                              : [
                                    'uploading',
                                    'quality_review',
                                    'analysis',
                                  ].includes(inspection.status)
                                ? 1
                                : 0;
                          return (
                            <span
                              className={
                                'rounded px-2 py-1 text-[10px] ' +
                                (index <= step
                                  ? 'bg-teal-100 text-teal-900'
                                  : 'bg-slate-100 text-slate-400')
                              }
                              key={label}
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    )}
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
            <h2 className="mt-5 text-xl font-bold">
              {props.role === 'expert'
                ? '검토 진행 순서'
                : props.role === 'client'
                  ? '이용 순서'
                  : '운영 시작 순서'}
            </h2>
            <ol className="mt-5 space-y-4 text-sm text-slate-200">
              {(props.role === 'expert'
                ? [
                    '배정된 점검·촬영 조건 확인',
                    '열화상 자료와 분석 후보 검토',
                    '근거 사진·판정 작성',
                    '보고서 검토 요청',
                  ]
                : props.role === 'client'
                  ? [
                      '내 발전소 정보 등록',
                      '점검 의뢰와 진행 상황 확인',
                      '발행된 진단 보고서 확인',
                      '후속 조치·견적 비교와 업체 선택',
                    ]
                  : [
                      '발전소 정보 등록',
                      '점검 접수와 일정 지정',
                      '열화상 원본 업로드·상대 분석',
                      '전문가 판정 후 보고서·조치 연결',
                    ]
              ).map((item, index) => (
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
  const [editingUpdatedAt, setEditingUpdatedAt] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('');
  const [commissionedOn, setCommissionedOn] = useState('');
  const [operatorType, setOperatorType] = useState('');
  const [moduleModel, setModuleModel] = useState('');
  const [inverterModel, setInverterModel] = useState('');
  const [dataUseConsent, setDataUseConsent] = useState(false);
  const [requesterId, setRequesterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [plantSearch, setPlantSearch] = useState('');
  const [plantPage, setPlantPage] = useState(0);
  const matchingPlants = props.plants.filter((plant) =>
    [plant.name, plant.code, plant.address].some((value) =>
      value
        ?.toLocaleLowerCase()
        .includes(plantSearch.trim().toLocaleLowerCase()),
    ),
  );
  const pageIndex = Math.min(
    plantPage,
    Math.max(0, Math.ceil(matchingPlants.length / 50) - 1),
  );
  const pagePlants = matchingPlants.slice(pageIndex * 50, pageIndex * 50 + 50);
  const draft = JSON.stringify([
    name,
    code,
    address,
    capacity,
    commissionedOn,
    operatorType,
    moduleModel,
    inverterModel,
    dataUseConsent,
    requesterId,
  ]);
  const [baseline, setBaseline] = useState(draft);
  useDraftProtection(props.canWrite && draft !== baseline, busy);
  const saveLock = useRef(false);
  const plantChange = useGuardedAction();
  const registrationId = useRef(crypto.randomUUID());

  function reset() {
    setBaseline(JSON.stringify(['', '', '', '', '', '', '', '', false, '']));
    setEditingId(null);
    setEditingUpdatedAt('');
    setName('');
    setCode('');
    setAddress('');
    setCapacity('');
    setCommissionedOn('');
    setOperatorType('');
    setModuleModel('');
    setInverterModel('');
    setDataUseConsent(false);
    setRequesterId('');
    registrationId.current = crypto.randomUUID();
  }

  function edit(plant: Plant) {
    setEditingId(plant.id);
    setEditingUpdatedAt(plant.updated_at);
    setName(plant.name);
    setCode(plant.code ?? '');
    setAddress(plant.address ?? '');
    setCapacity(plant.capacity_kw == null ? '' : String(plant.capacity_kw));
    setCommissionedOn(plant.commissioned_on ?? '');
    const metadata = jsonRecord(plant.metadata);
    setOperatorType(jsonText(metadata.operator_type));
    setModuleModel(jsonText(metadata.module_model));
    setInverterModel(jsonText(metadata.inverter_model));
    setDataUseConsent(Boolean(metadata.data_use_consent_at));
    setRequesterId('');
    setBaseline(
      JSON.stringify([
        plant.name,
        plant.code ?? '',
        plant.address ?? '',
        plant.capacity_kw == null ? '' : String(plant.capacity_kw),
        plant.commissioned_on ?? '',
        jsonText(metadata.operator_type),
        jsonText(metadata.module_model),
        jsonText(metadata.inverter_model),
        Boolean(metadata.data_use_consent_at),
        '',
      ]),
    );
  }

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    props.setNotice(null);
    try {
      const result = props.requesterMode
        ? editingId
          ? await props.supabase.rpc('update_requester_plant', {
              p_plant_id: editingId,
              p_expected_updated_at: editingUpdatedAt,
              p_name: name.trim(),
              p_address: address.trim(),
              p_capacity_kw: capacity ? Number(capacity) : null,
              p_commissioned_on: commissionedOn || null,
              p_operator_type: operatorType,
              p_module_model: moduleModel.trim(),
              p_inverter_model: inverterModel.trim(),
            })
          : await props.supabase.rpc('create_requester_plant_with_details', {
              p_request_id: registrationId.current,
              p_name: name.trim(),
              p_address: address.trim(),
              p_capacity_kw: capacity ? Number(capacity) : null,
              p_commissioned_on: commissionedOn || null,
              p_operator_type: operatorType.trim(),
              p_module_model: moduleModel.trim(),
              p_inverter_model: inverterModel.trim(),
              p_data_use_consent: dataUseConsent,
            })
        : await props.supabase.rpc('save_admin_plant', {
            p_organization_id: props.organizationId,
            p_plant_id: editingId ?? registrationId.current,
            p_expected_updated_at: editingId ? editingUpdatedAt : null,
            p_details: {
              name: name.trim(),
              code: code.trim(),
              address: address.trim(),
              capacity_kw: capacity ? Number(capacity) : null,
              commissioned_on: commissionedOn || null,
              operator_type: operatorType,
              module_model: moduleModel.trim(),
              inverter_model: inverterModel.trim(),
              data_use_consent: dataUseConsent,
            },
            p_requester_user_id: !editingId && requesterId ? requesterId : null,
          });
      if (result.error) throw result.error;
      if (!result.data)
        throw new Error(
          '발전소 저장 결과를 확인하지 못했습니다. 같은 입력으로 결과를 확인해 주세요.',
        );
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
      saveLock.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="ASSET REGISTRY"
        title={
          props.requesterMode
            ? '내 발전소'
            : props.canWrite
              ? '발전소 관리'
              : '배정 발전소'
        }
        copy={
          props.requesterMode
            ? '본인이 소유하거나 관리하는 발전소만 표시됩니다. 발전소를 등록하면 점검을 요청할 수 있습니다.'
            : '점검과 보고서가 연결될 기준 자산을 등록합니다. 용량은 kW, 시간은 발전소의 현지 시간대를 기준으로 표시합니다.'
        }
      />
      <DraftChangeDialog guard={plantChange} />
      <div
        className={`grid gap-5 ${props.canWrite ? 'xl:grid-cols-[380px_1fr]' : ''}`}
      >
        {props.canWrite && (
          <form
            onSubmit={save}
            className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <fieldset disabled={busy} className="space-y-4">
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
                    disabled={busy}
                    onClick={() => plantChange.request(reset)}
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
              <details
                open={editingId ? true : undefined}
                className="rounded-xl border p-3"
              >
                <summary className="cursor-pointer text-sm font-medium text-slate-600">
                  설비 상세정보 (선택·나중에 보완 가능)
                </summary>
                <div className="mt-4 space-y-4">
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
                    <Field label="설비용량(kW)" hint="선택·경제성 분석 시 필요">
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value)}
                        disabled={!props.canWrite}
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
                    <Field label="운영주체 구분">
                      <select
                        className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
                        value={operatorType}
                        onChange={(event) =>
                          setOperatorType(event.target.value)
                        }
                        disabled={!props.canWrite}
                      >
                        <option value="">나중에 입력</option>
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
                              member.role === 'client' &&
                              member.status === 'active',
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
                  <Field label="상업운전 시작일" hint="모르면 나중에 입력">
                    <Input
                      type="date"
                      value={commissionedOn}
                      onChange={(e) => setCommissionedOn(e.target.value)}
                      disabled={!props.canWrite}
                    />
                  </Field>
                </div>
              </details>
              <label className="flex items-start gap-3 rounded-xl bg-teal-50 p-3 text-sm leading-6 text-teal-950">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-teal-600"
                  checked={dataUseConsent}
                  onChange={(event) => setDataUseConsent(event.target.checked)}
                  disabled={
                    !props.canWrite || Boolean(editingId && dataUseConsent)
                  }
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
            </fieldset>
          </form>
        )}
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-bold">등록 자산 {props.plants.length}곳</h2>
            <Input
              className="mt-3"
              aria-label="발전소 검색"
              placeholder="발전소명·코드·주소 검색"
              value={plantSearch}
              onChange={(event) => {
                setPlantSearch(event.target.value);
                setPlantPage(0);
              }}
            />
          </div>
          <div className="divide-y">
            {pagePlants.map((plant) => (
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
                {props.canWrite && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (editingId !== plant.id)
                        plantChange.request(() => edit(plant));
                    }}
                  >
                    수정
                  </Button>
                )}
              </div>
            ))}
            {matchingPlants.length === 0 && (
              <p className="px-5 py-16 text-center text-sm text-slate-400">
                {props.plants.length
                  ? '검색 결과가 없습니다.'
                  : '등록된 발전소가 없습니다.'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4 text-sm">
            <span>
              {matchingPlants.length}곳 · {pageIndex + 1} /{' '}
              {Math.max(1, Math.ceil(matchingPlants.length / 50))}페이지
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || pageIndex === 0}
                onClick={() => setPlantPage(pageIndex - 1)}
              >
                이전
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || (pageIndex + 1) * 50 >= matchingPlants.length}
                onClick={() => setPlantPage(pageIndex + 1)}
              >
                다음
              </Button>
            </div>
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

function InspectionReopen(
  props: SharedProps & { inspection: Inspection; canReopen: boolean },
) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useDraftProtection(Boolean(reason.trim()), busy);
  return (
    <form
      className="my-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          const result = await props.supabase.rpc('reopen_inspection', {
            p_inspection_id: props.inspection.id,
            p_expected_updated_at: props.inspection.updated_at,
            p_reason: reason,
          });
          if (result.error) throw result.error;
          setReason('');
          props.setNotice({
            tone: 'success',
            text: '점검을 재개했습니다. 기존 발행본은 유지되며 보완 내용은 새 버전으로 발행합니다.',
          });
          await props.refresh();
        } catch (error) {
          props.setNotice({ tone: 'error', text: errorMessage(error) });
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-amber-950">
        종료·취소된 점검은 조회만 가능합니다. 추가 진단이나 보고서 개정이
        필요하면 관리자가 재개해 주세요.
      </p>
      {props.canReopen && (
        <fieldset disabled={busy} className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label={`${props.inspection.inspection_code} 재개 사유`}
            placeholder="재개 사유"
            value={reason}
            maxLength={1000}
            required
            onChange={(event) => setReason(event.target.value)}
          />
          <Button type="submit" disabled={busy || !reason.trim()}>
            점검 재개
          </Button>
        </fieldset>
      )}
    </form>
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
  const [rowBusy, setRowBusy] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const rowLock = useRef(false);

  const effectivePlantId = plantId || props.plants[0]?.id || '';
  const draft = JSON.stringify([
    effectivePlantId,
    code,
    purpose,
    scheduledAt,
    dueAt,
    notes,
    expertId,
  ]);
  const [baseline, setBaseline] = useState(draft);
  useDraftProtection(props.canCreate && draft !== baseline, busy || rowBusy);
  const createLock = useRef(false);
  const intakeRequestId = useRef(crypto.randomUUID());

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createLock.current) return;
    createLock.current = true;
    setBusy(true);
    props.setNotice(null);
    try {
      const { error } = props.requesterMode
        ? await props.supabase.rpc('request_inspection', {
            p_request_id: intakeRequestId.current,
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
      intakeRequestId.current = crypto.randomUUID();
      const nextCode = `INS-${Date.now().toString().slice(-8)}`;
      setBaseline(
        JSON.stringify([
          effectivePlantId,
          nextCode,
          purpose,
          scheduledAt,
          dueAt,
          '',
          expertId,
        ]),
      );
      setCode(nextCode);
      setNotes('');
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      createLock.current = false;
      setBusy(false);
    }
  }

  async function updateStatus(inspection: Inspection, status: string) {
    if (rowLock.current) return;
    rowLock.current = true;
    setRowBusy(true);
    props.setNotice(null);
    try {
      const { data, error } = await props.supabase
        .from('inspections')
        .update({ status })
        .eq('id', inspection.id)
        .eq('organization_id', props.organizationId)
        .eq('updated_at', inspection.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error(
          '점검이 변경됐거나 현재 수정 권한이 없습니다. 다시 불러온 뒤 확인해 주세요.',
        );
      props.setNotice({ tone: 'success', text: '점검 상태를 변경했습니다.' });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      rowLock.current = false;
      setRowBusy(false);
    }
  }

  async function assignExpert(
    inspection: Inspection,
    assignedExpertUserId: string,
  ) {
    if (rowLock.current) return;
    rowLock.current = true;
    setRowBusy(true);
    props.setNotice(null);
    try {
      const { data, error } = await props.supabase
        .from('inspections')
        .update({ assigned_expert_user_id: assignedExpertUserId || null })
        .eq('id', inspection.id)
        .eq('organization_id', props.organizationId)
        .eq('updated_at', inspection.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error(
          '점검이 변경됐거나 현재 수정 권한이 없습니다. 다시 불러온 뒤 확인해 주세요.',
        );
      props.setNotice({ tone: 'success', text: '담당 전문가를 변경했습니다.' });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      rowLock.current = false;
      setRowBusy(false);
    }
  }

  const plantName = (id: string) =>
    props.plants.find((plant) => plant.id === id)?.name ?? '삭제된 발전소';
  const activeExperts = props.members.filter(
    (member) => member.role === 'expert' && member.status === 'active',
  );

  return (
    <>
      <PageHeading
        eyebrow="INSPECTION WORKFLOW"
        title={
          props.requesterMode
            ? '내 점검 요청'
            : props.expertMode
              ? '배정 점검'
              : '점검 접수·진행 관리'
        }
        copy={
          props.requesterMode
            ? '내 발전소의 열화상 점검을 요청하고 진행 상태와 발행 결과를 확인합니다.'
            : '모든 일정은 한국 시간 기준입니다.'
        }
      />
      <div
        className={`grid gap-5 ${props.canCreate ? 'xl:grid-cols-[380px_1fr]' : ''}`}
      >
        {props.canCreate && (
          <form
            onSubmit={create}
            className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <fieldset
              disabled={busy || rowBusy || Boolean(editingScheduleId)}
              className="space-y-4"
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
            </fieldset>
          </form>
        )}
        <section className="space-y-3">
          {props.inspections.map((inspection) => {
            const hasOpenReport = props.reports.some(
              (r) =>
                r.inspection_id === inspection.id &&
                ['draft', 'review', 'approved'].includes(r.status),
            );
            const availableStatuses = inspectionStatuses.filter(
              ([key]) =>
                !hasOpenReport &&
                manualInspectionStatuses(
                  inspection.status,
                  props.expertMode,
                ).includes(key),
            );
            return (
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
                          void assignExpert(inspection, e.target.value)
                        }
                        disabled={
                          !props.canUpdate ||
                          rowBusy ||
                          Boolean(editingScheduleId) ||
                          inspectionLocked(inspection.status)
                        }
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
                        disabled={
                          busy ||
                          rowBusy ||
                          Boolean(editingScheduleId) ||
                          !availableStatuses.length ||
                          inspectionLocked(inspection.status)
                        }
                        aria-label={`${inspection.inspection_code} 점검 상태`}
                        onChange={(e) =>
                          void updateStatus(inspection, e.target.value)
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
                {props.canUpdate &&
                  !props.requesterMode &&
                  !props.expertMode &&
                  !inspectionLocked(inspection.status) &&
                  (editingScheduleId === inspection.id ? (
                    <InspectionScheduleEditor
                      key={inspection.id}
                      inspection={inspection}
                      supabase={props.supabase}
                      onClose={() => setEditingScheduleId(null)}
                      onPending={(pending) => {
                        rowLock.current = pending;
                        setRowBusy(pending);
                      }}
                      onSaved={async () => {
                        props.setNotice({
                          tone: 'success',
                          text: '점검 일정을 저장했습니다.',
                        });
                        await props.refresh();
                      }}
                    />
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      disabled={busy || rowBusy || Boolean(editingScheduleId)}
                      aria-label={`${inspection.inspection_code} 일정 수정`}
                      onClick={() => setEditingScheduleId(inspection.id)}
                    >
                      일정 수정
                    </Button>
                  ))}
                {inspection.notes && (
                  <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    {inspection.notes}
                  </p>
                )}
                {inspectionLocked(inspection.status) &&
                  !props.requesterMode && (
                    <InspectionReopen
                      {...props}
                      inspection={inspection}
                      canReopen={!props.expertMode && props.canUpdate}
                    />
                  )}
              </article>
            );
          })}
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
  const [inspectionId, setInspectionId] = useInspectionSelection(
    props.inspections,
  );
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
  const analysisController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      uploadController.current?.abort();
      analysisController.current?.abort();
    },
    [],
  );
  const [runAnalysis, setRunAnalysis] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [analyzingFileId, setAnalyzingFileId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<{
    run: AnalysisRun;
    action: 'cancel' | 'manual_review';
  } | null>(null);
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  useDraftProtection(
    queue.some((item) => item.status !== 'done'),
    busy || Boolean(analyzingFileId) || resolving,
  );
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
    null,
  );

  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';
  const currentInspection = props.inspections.find(
    (i) => i.id === effectiveInspectionId,
  );
  const canEditSelected =
    props.canWrite &&
    Boolean(currentInspection) &&
    !inspectionLocked(currentInspection?.status);
  const visibleFiles = inspectionRows(
    props.files,
    effectiveInspectionId,
    showAll,
  );
  const canAnalyze = (file: InspectionFile) =>
    props.canWrite &&
    props.inspections.some(
      (i) =>
        i.id === file.inspection_id &&
        !inspectionLocked(i.status) &&
        !['approval', 'published'].includes(i.status),
    );
  const latestRuns = Array.from(
    new Map(
      props.analysisRuns
        .filter(
          (r) =>
            r.inspection_id === effectiveInspectionId &&
            r.algorithm_key === 'rgb-luminance-relative',
        )
        .sort(
          (a, b) =>
            Date.parse(a.started_at ?? a.requested_at) -
            Date.parse(b.started_at ?? b.requested_at),
        )
        .map((r) => [
          jsonText(jsonRecord(r.input_manifest).inspection_file_id),
          r,
        ]),
    ).values(),
  );
  const unfinishedRuns = latestRuns.filter(
    (r) =>
      r.status === 'running' ||
      (['failed', 'cancelled'].includes(r.status) && !r.reviewed_at),
  );
  async function resolveAnalysis() {
    if (!resolution || busy || analyzingFileId || resolving) return;
    setResolving(true);
    setResolutionError(null);
    try {
      const { error } = await props.supabase.rpc('resolve_relative_analysis', {
        p_analysis_run_id: resolution.run.id,
        p_expected_status: resolution.run.status,
        p_action: resolution.action,
        p_reason: resolutionReason.trim(),
      });
      if (error) throw error;
      setResolution(null);
      props.setNotice({
        tone: 'success',
        text: '분석 상태 확인을 기록했습니다. 원본과 판정 근거는 그대로 보존됩니다.',
      });
      await props.refresh();
    } catch (error) {
      setResolutionError(errorMessage(error));
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setResolving(false);
    }
  }

  const hasSuccessfulAnalysis = (fileId: string) =>
    props.analysisRuns.some((run) => {
      const manifest = jsonRecord(run.input_manifest);
      return (
        run.status === 'succeeded' &&
        jsonText(manifest.inspection_file_id) === fileId
      );
    });

  async function analyzeFile(
    file: File,
    fileRow: InspectionFile,
    signal?: AbortSignal,
  ) {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      throw new Error(
        '상대 분석은 JPG 또는 PNG 원본에서만 실행할 수 있습니다.',
      );
    }
    if (hasSuccessfulAnalysis(fileRow.id)) {
      throw new Error('이 원본의 상대 분석이 이미 완료됐습니다.');
    }

    const pixels = await imageValues(file);
    return analyzePixels(
      props.supabase,
      fileRow.id,
      pixels,
      props.session.access_token,
      signal,
    );
  }

  async function retryAnalysis(fileRow: InspectionFile) {
    if (busy || analyzingFileId || resolving || !canAnalyze(fileRow)) return;
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalyzingFileId(fileRow.id);
    props.setNotice({ tone: 'info', text: '저장된 원본을 다시 분석합니다.' });
    try {
      const { data, error } = await props.supabase.storage
        .from(fileRow.storage_bucket)
        .download(
          fileRow.storage_path,
          {},
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30000),
            ]),
          },
        );
      if (error) throw error;
      await verifyOriginal(data, fileRow);
      const file = new File([data], fileRow.original_name, {
        type: fileRow.mime_type ?? data.type,
      });
      await verifiedImageType(file);
      const result = await analyzeFile(file, fileRow, controller.signal);
      props.setNotice({
        tone: result.uniform ? 'info' : 'success',
        text: result.uniform
          ? '사진의 명암 차이가 없어 상대 후보를 만들지 않았습니다. 원본과 촬영 조건을 확인해 주세요. 이상이 없다는 판정은 아닙니다.'
          : `상대 분석 후보 ${result.count}건을 만들었습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
      await props.refresh();
    } finally {
      setAnalyzingFileId(null);
      analysisController.current = null;
    }
  }

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy ||
      analyzingFileId ||
      !canEditSelected ||
      !effectiveInspectionId ||
      !queue.length
    )
      return;
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
            ['image/jpeg', 'image/png'].includes(fileRow.mime_type || '')
          ) {
            try {
              await saveInspectionPreview(
                props.supabase,
                fileRow,
                item.file,
                controller.signal,
              );
              message += ' · 미리보기 준비 완료';
            } catch {
              message += ' · 미리보기는 아래 목록에서 다시 준비할 수 있습니다.';
            }
          }
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
              const result = await analyzeFile(
                normalized,
                fileRow,
                controller.signal,
              );
              message += result.uniform
                ? ' · 명암 차이 없음: 원본·촬영 조건 확인 필요 (정상 판정 아님)'
                : ` · 후보 ${result.count}건`;
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
    if (downloadingFileId) return;
    setDownloadingFileId(file.id);
    try {
      await downloadInspectionOriginal(props.supabase, file);
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setDownloadingFileId(null);
    }
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
      <AlertDialog
        open={resolution !== null}
        onOpenChange={(open) => {
          if (!open && !resolving) setResolution(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resolution?.action === 'cancel'
                ? '분석 실행을 중단할까요?'
                : '원본 사진으로 직접 검토할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              원본은 삭제하지 않습니다. 실패·중단된 자동 분석을 사용하지 않고
              사진으로 검토하면 그 확인 사유를 기록합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label
            htmlFor="analysis-resolution-reason"
            className="grid gap-2 text-sm"
          >
            확인 사유
            <Textarea
              id="analysis-resolution-reason"
              value={resolutionReason}
              maxLength={300}
              disabled={resolving}
              onChange={(e) => setResolutionReason(e.target.value)}
            />
          </label>
          {resolutionError && (
            <p role="alert" className="text-sm text-red-700">
              {resolutionError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolving}>취소</AlertDialogCancel>
            <Button
              disabled={resolving || !resolutionReason.trim()}
              onClick={() => void resolveAnalysis()}
            >
              {resolving ? '확인 중…' : '확인 기록'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {analyzingFileId && (
        <Button
          className="mb-4"
          variant="outline"
          onClick={() => analysisController.current?.abort()}
        >
          분석 중단
        </Button>
      )}
      {unfinishedRuns.length > 0 && (
        <section
          className="mb-5 space-y-3 rounded-2xl border bg-amber-50 p-4"
          aria-label="분석 실행 확인"
        >
          <h2 className="font-bold">분석 실행 확인</h2>
          {unfinishedRuns.map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-all">
                {props.files.find(
                  (f) =>
                    f.id ===
                    jsonText(jsonRecord(run.input_manifest).inspection_file_id),
                )?.original_name ?? '저장 원본'}{' '}
                ·{' '}
                {run.status === 'running'
                  ? '분석 중 · 응답 미확인'
                  : run.status === 'failed'
                    ? '분석 실패'
                    : '분석 중단'}
              </span>
              {props.canWrite &&
                !['closed', 'cancelled', 'approval', 'published'].includes(
                  currentInspection?.status ?? '',
                ) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || Boolean(analyzingFileId) || resolving}
                    onClick={() => {
                      setResolutionError(null);
                      setResolution({
                        run,
                        action:
                          run.status === 'running' ? 'cancel' : 'manual_review',
                      });
                      setResolutionReason(
                        run.status === 'running'
                          ? '분석 응답을 확인하지 못해 실행을 중단합니다.'
                          : '원본 사진을 직접 검토하고 이 자동 분석 결과는 사용하지 않습니다.',
                      );
                    }}
                  >
                    {run.status === 'running'
                      ? '실행 중단 확인'
                      : '사진으로 직접 검토'}
                  </Button>
                )}
            </div>
          ))}
        </section>
      )}
      <div className="grid gap-5 xl:grid-cols-[390px_1fr]">
        <form
          onSubmit={upload}
          className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
        >
          <h2 className="font-bold">점검 파일 저장</h2>
          {!props.canWrite && <ReadOnlyNote />}
          {props.canWrite && currentInspection && !canEditSelected && (
            <p className="text-sm text-amber-800">
              이 점검은 종료·취소되어 조회만 가능합니다. 다른 점검을 선택하거나
              관리자가 점검을 재개해 주세요.
            </p>
          )}
          <Field label="연결할 점검">
            <select
              className="h-9 w-full rounded-lg border bg-white px-3 text-sm"
              value={effectiveInspectionId}
              onChange={(e) => {
                if (!setInspectionId(e.target.value)) return;
                setQueue([]);
              }}
              disabled={busy || Boolean(analyzingFileId) || queue.length > 0}
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
              disabled={
                !canEditSelected ||
                busy ||
                Boolean(analyzingFileId) ||
                queue.length > 0
              }
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
              disabled={!canEditSelected || busy || Boolean(analyzingFileId)}
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
                disabled={!canEditSelected || busy || Boolean(analyzingFileId)}
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
              !canEditSelected ||
              Boolean(analyzingFileId) ||
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
            <h2 className="font-bold">
              {showAll ? '전체 점검' : '현재 점검'} 저장 파일{' '}
              {visibleFiles.length}개
            </h2>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              전체 점검 파일 보기
            </label>
          </div>
          <div className="divide-y">
            {visibleFiles.map((file) => (
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
                  {['image/jpeg', 'image/png'].includes(
                    file.mime_type || '',
                  ) && (
                    <InspectionPreviewButton
                      client={props.supabase}
                      source={file}
                    />
                  )}
                  {file.kind === 'thermal_original' &&
                    ['image/jpeg', 'image/png'].includes(
                      file.mime_type ?? '',
                    ) &&
                    !hasSuccessfulAnalysis(file.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          !canAnalyze(file) ||
                          busy ||
                          analyzingFileId !== null ||
                          resolving ||
                          latestRuns.some(
                            (r) =>
                              r.status === 'running' &&
                              jsonText(
                                jsonRecord(r.input_manifest).inspection_file_id,
                              ) === file.id,
                          )
                        }
                        onClick={() => void retryAnalysis(file)}
                        className="min-h-11 sm:min-h-7"
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
                    className="min-h-11 sm:min-h-7"
                    disabled={downloadingFileId !== null}
                  >
                    <Download />
                    {downloadingFileId === file.id
                      ? '원본 준비 중…'
                      : '원본 다운로드'}
                  </Button>
                </div>
              </div>
            ))}
            {visibleFiles.length === 0 && (
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
  const [inspectionId, setInspectionId] = useInspectionSelection(
    props.inspections,
  );
  const [title, setTitle] = useState('태양광 발전설비 열화상 점검 보고서');
  const [busy, setBusy] = useState(false);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);
  const [reasonByReport, setReasonByReport] = useState<Record<string, string>>(
    {},
  );
  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';
  const [showAll, setShowAll] = useState(false);
  const locked = inspectionLocked(
    props.inspections.find((i) => i.id === effectiveInspectionId)?.status,
  );
  const openReport = props.reports.some(
    (r) =>
      r.inspection_id === effectiveInspectionId &&
      ['draft', 'review', 'approved'].includes(r.status),
  );
  const visibleReports = inspectionRows(
    props.reports,
    effectiveInspectionId,
    showAll,
  );
  const operationLock = useRef(false);
  const pending = busy || transitioningId !== null;
  useDraftProtection(
    title !== '태양광 발전설비 열화상 점검 보고서' ||
      Object.values(reasonByReport).some((v) => Boolean(v.trim())),
    pending,
  );

  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationLock.current || locked || openReport) return;
    operationLock.current = true;
    setBusy(true);
    try {
      const { data, error } = await props.supabase.rpc('create_report_draft', {
        p_inspection_id: effectiveInspectionId,
        p_title: title.trim(),
      });
      if (error) throw error;
      setTitle('태양광 발전설비 열화상 점검 보고서');
      props.setNotice({
        tone: 'success',
        text: `보고서 ${data.version}차 초안을 만들었습니다.`,
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function transitionStatus(report: Report, status: string) {
    if (operationLock.current) return;
    operationLock.current = true;
    setTransitioningId(report.id);
    props.setNotice(null);
    try {
      if (status === 'published')
        await requestReportPdf(props.supabase, report.id, true);
      const { error } = await props.supabase.rpc('transition_report_status', {
        p_report_id: report.id,
        p_next_status: status,
        p_expected_revision: report.action_revision,
        p_expected_snapshot_sha256: report.report_snapshots?.sha256 ?? null,
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
      operationLock.current = false;
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
            <p className="text-sm leading-6 text-slate-600">
              사진·소견 판정 후 경제성 자료 없이도 검토를 요청할 수 있습니다.
              발전량·수리비는 경제성 분석이 필요할 때 추가하세요. 발행 후 추가한
              자료는 새 보고서 버전으로 반영합니다.
            </p>
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
                disabled={locked || pending || openReport}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={
                !effectiveInspectionId || pending || locked || openReport
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <Plus />}초안 생성
            </Button>
            {locked && (
              <p className="text-sm text-amber-800">
                관리자가 점검을 재개한 뒤 새 보고서를 만들 수 있습니다.
              </p>
            )}
            {!locked && openReport && (
              <p className="text-sm text-slate-600">
                작성·검토 중인 보고서를 먼저 처리해 주세요.
              </p>
            )}
          </form>
        ) : null}
        <section className="space-y-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            전체 점검 보고서 보기
          </label>
          {!props.canCreate && (
            <Field label="점검">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3"
                value={effectiveInspectionId}
                onChange={(e) => setInspectionId(e.target.value)}
              >
                {props.inspections.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.inspection_code}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {visibleReports.map((report) => (
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
                    disabled={
                      pending ||
                      inspectionLocked(
                        props.inspections.find(
                          (i) => i.id === report.inspection_id,
                        )?.status,
                      )
                    }
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
                        disabled={
                          pending ||
                          inspectionLocked(
                            props.inspections.find(
                              (i) => i.id === report.inspection_id,
                            )?.status,
                          )
                        }
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
                            disabled={
                              pending ||
                              inspectionLocked(
                                props.inspections.find(
                                  (i) => i.id === report.inspection_id,
                                )?.status,
                              )
                            }
                            onClick={() =>
                              void transitionStatus(report, 'draft')
                            }
                          >
                            수정 요청
                          </Button>
                          <Button
                            size="sm"
                            disabled={
                              pending ||
                              inspectionLocked(
                                props.inspections.find(
                                  (i) => i.id === report.inspection_id,
                                )?.status,
                              )
                            }
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
                            disabled={
                              pending ||
                              inspectionLocked(
                                props.inspections.find(
                                  (i) => i.id === report.inspection_id,
                                )?.status,
                              )
                            }
                            onClick={() =>
                              void transitionStatus(report, 'draft')
                            }
                          >
                            승인 취소
                          </Button>
                          <Button
                            size="sm"
                            disabled={
                              pending ||
                              inspectionLocked(
                                props.inspections.find(
                                  (i) => i.id === report.inspection_id,
                                )?.status,
                              )
                            }
                            onClick={() =>
                              void transitionStatus(report, 'published')
                            }
                          >
                            {props.reports.some(
                              (r) =>
                                r.inspection_id === report.inspection_id &&
                                r.status === 'published',
                            )
                              ? '개정 발행 · 이전 발행본 대체'
                              : '최종 발행'}
                          </Button>
                        </>
                      )}
                      {report.status === 'published' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            pending ||
                            inspectionLocked(
                              props.inspections.find(
                                (i) => i.id === report.inspection_id,
                              )?.status,
                            )
                          }
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
          {visibleReports.length === 0 && (
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
  const [inspectionId, setInspectionId] = useInspectionSelection(
    props.inspections,
  );
  const [title, setTitle] = useState('열화상 이상 후보 현장 점검');
  const [priority, setPriority] = useState('normal');
  const [vendor, setVendor] = useState('');
  const [busy, setBusy] = useState(false);
  const effectiveInspectionId = inspectionId || props.inspections[0]?.id || '';
  const [showAll, setShowAll] = useState(false);
  const visibleMaintenance = inspectionRows(
    props.maintenance,
    effectiveInspectionId,
    showAll,
  );
  const lock = useRef(false);
  useDraftProtection(
    title !== '열화상 이상 후보 현장 점검' ||
      priority !== 'normal' ||
      Boolean(vendor.trim()),
    busy,
  );
  async function create(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
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
      setTitle('열화상 이상 후보 현장 점검');
      setVendor('');
      setPriority('normal');
      props.setNotice({
        tone: 'success',
        text: '유지보수 요청을 등록했습니다.',
      });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function updateStatus(item: Maintenance, status: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const updates: Database['public']['Tables']['maintenance_requests']['Update'] =
        { status };
      const { data, error } = await props.supabase
        .from('maintenance_requests')
        .update(updates)
        .eq('id', item.id)
        .eq('organization_id', props.organizationId)
        .eq('updated_at', item.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error(
          '조치가 변경됐거나 현재 수정 권한이 없습니다. 다시 불러온 뒤 확인해 주세요.',
        );
      props.setNotice({ tone: 'success', text: '조치 상태를 변경했습니다.' });
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const inspectionLabel = (id: string) =>
    props.inspections.find((item) => item.id === id)?.inspection_code ?? '점검';
  return (
    <>
      <PageHeading
        eyebrow="MAINTENANCE LOOP"
        title="유지보수 요청·조치 이력"
        copy="후속 조치를 등록하고 진행 상태를 관리합니다. 연결된 견적에서 업체를 선택하면 이 작업의 업체 정보에도 반영됩니다."
      />
      <div
        className={`grid gap-5 ${props.canWrite ? 'xl:grid-cols-[380px_1fr]' : ''}`}
      >
        {props.canWrite && (
          <form
            onSubmit={create}
            className="h-fit space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">새 조치 요청</h2>
            <fieldset disabled={busy} className="space-y-4">
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
                {busy ? <Loader2 className="animate-spin" /> : <Plus />}조치
                요청 등록
              </Button>
            </fieldset>
          </form>
        )}
        <section className="space-y-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            전체 점검 유지보수 보기
          </label>
          {!props.canWrite && (
            <Field label="점검">
              <select
                className="h-10 w-full rounded-lg border bg-white px-3"
                value={effectiveInspectionId}
                onChange={(e) => setInspectionId(e.target.value)}
              >
                {props.inspections.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.inspection_code}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {visibleMaintenance.map((item) => (
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
                  {item.selected_quote_id && (
                    <p className="mt-1 text-sm text-teal-700">
                      선택 견적 연결 · 업체 자동 반영
                    </p>
                  )}
                </div>
                <select
                  className="h-9 rounded-lg border bg-white px-3 text-sm font-semibold"
                  value={item.status}
                  aria-label={`${item.title} 조치 상태`}
                  onChange={(e) => void updateStatus(item, e.target.value)}
                  disabled={!props.canWrite || busy}
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
          {visibleMaintenance.length === 0 && (
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
  const [quoteConfirmation, setQuoteConfirmation] = useState<{
    quote: PartnerQuote;
    request: QuoteRequest;
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const operationLock = useRef(false);
  const anyBusy =
    busy ||
    requestBusy ||
    Boolean(savingPartnerId || savingQuoteId || selectingQuoteId);
  const { ref: sectionRef, ...drafts } = useSectionDraftProtection(anyBusy);
  function beginOperation() {
    if (operationLock.current) return false;
    operationLock.current = true;
    return true;
  }
  const partnerById = Object.fromEntries(
    props.partners.map((partner) => [partner.id, partner]),
  );
  const privateDetailsByPartnerId = Object.fromEntries(
    props.partnerPrivateDetails.map((detail) => [detail.partner_id, detail]),
  );
  const activePartners = props.partners.filter(
    (partner) => partner.status === 'active',
  );
  const linkedRequesters = props.quoteRequesters.filter(
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
    if (!beginOperation()) return;
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
      drafts.markSaved(form);
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  async function updatePartner(
    event: SyntheticEvent<HTMLFormElement>,
    partner: Partner,
  ) {
    event.preventDefault();
    if (!beginOperation()) return;
    const form = event.currentTarget;
    const data = new FormData(form);
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
      drafts.markSaved(form);
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
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
    if (!beginOperation()) return;
    const form = event.currentTarget;
    if (selectedPartnerIds.length !== 3) {
      operationLock.current = false;
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
            ? parseKoreanInput(quoteDueAt, '회신 마감')
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
      drafts.markSaved(form);
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
      setRequestBusy(false);
    }
  }

  async function saveQuote(
    event: SyntheticEvent<HTMLFormElement>,
    quoteId: string,
  ) {
    event.preventDefault();
    if (!beginOperation()) return;
    const element = event.currentTarget;
    const form = new FormData(element);
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
      drafts.markSaved(element);
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
      setSavingQuoteId(null);
    }
  }

  async function selectQuote(quote: PartnerQuote, request: QuoteRequest) {
    if (!beginOperation()) return;
    setSelectingQuoteId(quote.id);
    setQuoteError(null);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc('select_partner_quote', {
        p_quote_id: quote.id,
        p_expected_quote_revision: quote.action_revision,
        p_expected_request_revision: request.action_revision,
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '업체를 선택했습니다. 선택 기록은 관리자 화면과 감사기록에 함께 남습니다.',
      });

      await props.refresh();
      setQuoteConfirmation(null);
    } catch (error) {
      setQuoteError(errorMessage(error));
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      operationLock.current = false;
      setSelectingQuoteId(null);
    }
  }

  if (props.requesterMode) {
    return (
      <>
        <AlertDialog
          open={quoteConfirmation !== null}
          onOpenChange={(open) => {
            if (!open && !selectingQuoteId) setQuoteConfirmation(null);
          }}
        >
          <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
            <AlertDialogHeader>
              <AlertDialogTitle>이 견적의 업체를 선택할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                금액과 작업 조건을 확인해 주세요. 변경된 견적은 다시 확인해야
                하며, 작업이 시작되면 업체를 바꿀 수 없습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {quoteConfirmation && (
              <div className="space-y-3 break-words text-sm">
                <strong>
                  {partnerById[quoteConfirmation.quote.partner_id]?.name} ·{' '}
                  {formatWon(quoteConfirmation.quote.amount_krw)}
                </strong>
                <p>
                  예상 기간:{' '}
                  {quoteConfirmation.quote.estimated_days
                    ? `${quoteConfirmation.quote.estimated_days}일`
                    : '협의'}{' '}
                  · 시작 예정:{' '}
                  {quoteConfirmation.quote.proposed_start_on ?? '협의'}
                </p>
                <p>
                  유효일:{' '}
                  {quoteConfirmation.quote.valid_until ?? '별도 기재 없음'}
                </p>
                <p className="whitespace-pre-wrap">
                  작업 범위: {quoteConfirmation.quote.scope ?? '별도 기재 없음'}
                </p>
                <p className="whitespace-pre-wrap">
                  조건: {quoteConfirmation.quote.conditions ?? '별도 기재 없음'}
                </p>
              </div>
            )}
            {quoteError && (
              <p role="alert" className="text-sm text-red-700">
                {quoteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={Boolean(selectingQuoteId)}>
                다시 비교
              </AlertDialogCancel>
              <Button
                disabled={Boolean(selectingQuoteId)}
                onClick={() => {
                  if (quoteConfirmation)
                    void selectQuote(
                      quoteConfirmation.quote,
                      quoteConfirmation.request,
                    );
                }}
              >
                {selectingQuoteId ? '선택 확인 중…' : '조건 확인 후 선택'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <PageHeading
          eyebrow="QUOTE COMPARISON"
          title="업체 견적 비교·선택"
          copy="관리자가 회신을 확인한 견적만 표시됩니다. 금액·예상 기간·업체 평점을 비교하고 한 곳을 선택할 수 있습니다."
        />
        <section className="space-y-5">
          {props.quoteRequests.map((request) => {
            const selectionLock = quoteSelectionLock(
              request,
              props.maintenance,
              props.session.user.id,
            );
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
                {selectionLock && (
                  <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    {selectionLock}
                  </p>
                )}
                {quotes.length > 0 ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-3">
                    {quotes.map((quote) => {
                      const partner = partnerById[quote.partner_id];
                      const selected = request.selected_quote_id === quote.id;
                      const expired = Boolean(
                        quote.valid_until && quote.valid_until < koreanDate(),
                      );
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
                            <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                              {quote.scope}
                            </p>
                          )}
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            시작 예정: {quote.proposed_start_on ?? '협의'} ·
                            유효일: {quote.valid_until ?? '별도 기재 없음'}
                          </p>
                          {quote.conditions && (
                            <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                              조건: {quote.conditions}
                            </p>
                          )}
                          {expired && !selected && (
                            <p className="mt-2 text-xs text-amber-800">
                              유효기간 만료 · 최신 견적 확인이 필요합니다.
                            </p>
                          )}
                          <Button
                            className="mt-4 w-full"
                            size="sm"
                            variant={selected ? 'outline' : 'default'}
                            disabled={
                              selected ||
                              expired ||
                              Boolean(selectionLock) ||
                              selectingQuoteId !== null ||
                              ![
                                'submitted',
                                'selected',
                                'not_selected',
                              ].includes(quote.status)
                            }
                            onClick={() => {
                              setQuoteError(null);
                              setQuoteConfirmation({ quote, request });
                            }}
                          >
                            {selectingQuoteId === quote.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <CheckCircle2 />
                            )}
                            {selected
                              ? '선택한 업체'
                              : selectionLock
                                ? '업체 변경 불가'
                                : '이 업체 선택'}
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
    <div ref={sectionRef} onInput={drafts.onInput} onChange={drafts.onChange}>
      <fieldset disabled={anyBusy} className="min-w-0 space-y-5">
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
                      props.quoteRequesters.find(
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
              <Field label="견적 선택 담당자">
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
                  견적을 선택할 활성 고객이 없습니다. 발전소의 의뢰인 연결 또는
                  고객 관리의 담당자·발전소 연결을 확인하세요.
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
                  onChange={(event) =>
                    setQuoteMaintenanceId(event.target.value)
                  }
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
                        <strong className="block truncate">
                          {partner.name}
                        </strong>
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
                <h2 className="font-bold">
                  등록 업체 {props.partners.length}곳
                </h2>
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
                            {partner.service_regions.join(', ') ||
                              '지역 미입력'}
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
                            {request.request_code} · 업체 {quotes.length}곳 연결
                            · 회신{' '}
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
                                        ? partnerTypeLabels[
                                            partner.partner_type
                                          ]
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
                                      defaultValue={
                                        quote.proposed_start_on ?? ''
                                      }
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
      </fieldset>
    </div>
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
  const [pendingAction, setPendingAction] = useState<{
    kind: 'remove' | 'transfer';
    member: Membership;
  } | null>(null);
  const [memberTab, setMemberTab] = useState<MemberRoleTab>('owner');
  const [searchDraft, setSearchDraft] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const roleCounts = directoryRoleCounts(props.members);
  const visibleMembers = directoryMembers(
    props.members,
    props.profiles,
    memberTab,
    memberSearch,
  );
  const memberTabLabel = memberRoleTabs.find(
    (tab) => tab.role === memberTab,
  )?.label;
  const actionInFlight = useRef(false);
  const superAdminUserId = props.workspace.superAdminUserId;
  const isSuperAdmin = superAdminUserId === props.session.user.id;
  const invitationDraft = JSON.stringify([email, displayName, role]);
  const [invitationBaseline, setInvitationBaseline] = useState(invitationDraft);
  const [organizationBaseline, setOrganizationBaseline] =
    useState(organizationName);
  useDraftProtection(
    props.canWrite &&
      (invitationDraft !== invitationBaseline ||
        organizationName !== organizationBaseline),
    busy || Boolean(busyMemberId),
  );

  async function confirmMemberAction() {
    if (!pendingAction || !props.canWrite || actionInFlight.current) return;
    actionInFlight.current = true;
    const { kind, member } = pendingAction;
    setBusyMemberId(member.user_id);
    props.setNotice(null);
    try {
      if (kind === 'transfer') {
        if (!isSuperAdmin || !superAdminUserId)
          throw new Error('현재 최고 관리자만 권한을 양도할 수 있습니다.');
        const { error } = await props.supabase.rpc('transfer_super_admin', {
          p_organization_id: props.organizationId,
          p_target_user_id: member.user_id,
          p_expected_super_admin_user_id: superAdminUserId,
          p_expected_target_updated_at: member.updated_at,
        });
        if (error) throw error;
        props.setWorkspace({
          ...props.workspace,
          superAdminUserId: member.user_id,
        });
      } else {
        const { error } = await props.supabase.rpc('admin_remove_member', {
          p_organization_id: props.organizationId,
          p_user_id: member.user_id,
          p_expected_updated_at: member.updated_at,
        });
        if (error) throw error;
      }
      setPendingAction(null);
      await props.refresh();
      props.setNotice({
        tone: 'success',
        text:
          kind === 'transfer'
            ? '최고 관리자 권한을 양도했습니다. 내 계정은 일반 관리자로 변경되었습니다.'
            : '관리자를 삭제하고 이 작업공간의 접근권한을 해제했습니다. 기존 업무 자료는 보존됩니다.',
      });
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      actionInFlight.current = false;
      setBusyMemberId(null);
    }
  }
  async function addMember(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.canWrite || actionInFlight.current) return;
    actionInFlight.current = true;
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
      setInvitationBaseline(JSON.stringify(['', '', role]));
      setEmail('');
      setDisplayName('');
      await props.refresh();
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  async function updateMember(
    member: Membership,
    updates: { role?: string; status?: string },
  ) {
    if (!props.canWrite || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyMemberId(member.user_id);
    props.setNotice(null);
    try {
      const { error } = await props.supabase.rpc('admin_update_member', {
        p_organization_id: props.organizationId,
        p_user_id: member.user_id,
        p_role: updates.role ?? null,
        p_status: updates.status ?? null,
        p_expected_updated_at: member.updated_at,
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
      actionInFlight.current = false;
      setBusyMemberId(null);
    }
  }
  async function saveOrganization(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.canWrite || actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    try {
      const { data, error } = await props.supabase
        .from('organizations')
        .update({ name: organizationName.trim() })
        .eq('id', props.organizationId)
        .select('*')
        .single();
      if (error) throw error;
      else {
        setOrganizationBaseline(organizationName);
        props.setWorkspace({ ...props.workspace, organization: data });
        props.setNotice({ tone: 'success', text: '조직명을 변경했습니다.' });
      }
    } catch (error) {
      props.setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="ACCESS CONTROL"
        title="계정·역할 관리"
        copy="의뢰인은 직접 가입하고, 전문가와 관리자는 초대 메일로 계정을 만듭니다. 관리자는 세 역할과 계정 상태를 모두 관리합니다."
      />
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !actionInFlight.current) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.kind === 'transfer'
                ? '최고 관리자 권한을 양도할까요?'
                : '이 관리자를 삭제할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-3 block font-semibold text-slate-800">
                {pendingAction &&
                  (props.profiles[pendingAction.member.user_id]?.display_name ||
                    props.profiles[pendingAction.member.user_id]?.email ||
                    '선택한 관리자')}
              </span>
              {pendingAction?.kind === 'transfer'
                ? '상대방이 유일한 최고 관리자가 됩니다. 내 계정은 일반 관리자로 바뀌며, 다른 관리자가 내 계정을 삭제할 수 있게 됩니다.'
                : '이 작업공간에 접근할 수 없게 되며 관리자 목록에서 제외됩니다. 기존 발전소·점검·보고서와 작성 이력은 삭제하지 않습니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyMemberId !== null}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              disabled={busyMemberId !== null}
              onClick={() => void confirmMemberAction()}
            >
              {busyMemberId ? <Loader2 className="animate-spin" /> : null}
              {pendingAction?.kind === 'transfer' ? '권한 양도' : '관리자 삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-5">
          <form
            onSubmit={addMember}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">전문가·관리자 초대</h2>
            <fieldset
              disabled={busy || Boolean(busyMemberId)}
              className="space-y-4"
            >
              {!props.canWrite && <ReadOnlyNote />}
              <p className="rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-800">
                초대받은 사용자가 메일의 링크를 열고 비밀번호를 설정하면 이용할
                수 있습니다. 의뢰인은 로그인 화면에서 직접 가입합니다.
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
                  onChange={(e) =>
                    setRole(e.target.value as 'expert' | 'owner')
                  }
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
                {busy ? <Loader2 className="animate-spin" /> : <Users />}초대
                메일 보내기
              </Button>
            </fieldset>
          </form>
          <form
            onSubmit={saveOrganization}
            className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm"
          >
            <h2 className="font-bold">조직 설정</h2>
            <fieldset
              disabled={busy || Boolean(busyMemberId)}
              className="space-y-4"
            >
              <Field label="조직명">
                <Input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  disabled={!props.canWrite}
                  required
                />
              </Field>
              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={!props.canWrite}
              >
                조직명 저장
              </Button>
            </fieldset>
          </form>
        </div>
        <section className="order-first min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm xl:order-last">
          <div className="border-b px-4 pt-4 sm:px-5">
            <h2 className="font-bold">사용자 관리</h2>
            <div
              role="tablist"
              aria-label="사용자 역할"
              className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
            >
              {memberRoleTabs.map(({ role: tabRole, label }, index) => (
                <button
                  key={tabRole}
                  type="button"
                  role="tab"
                  id={`member-tab-${tabRole}`}
                  aria-controls="member-directory-panel"
                  aria-selected={memberTab === tabRole}
                  tabIndex={memberTab === tabRole ? 0 : -1}
                  onClick={() => setMemberTab(tabRole)}
                  onKeyDown={(event) => {
                    const step =
                      event.key === 'ArrowRight'
                        ? 1
                        : event.key === 'ArrowLeft'
                          ? -1
                          : 0;
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : step
                            ? (index + step + 3) % 3
                            : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    setMemberTab(memberRoleTabs[next].role);
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                  }}
                  className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-1 text-sm font-semibold transition ${memberTab === tabRole ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  {label}
                  <span className="text-xs opacity-70">
                    {roleCounts[tabRole]}
                  </span>
                </button>
              ))}
            </div>
            <form
              aria-label="사용자 검색"
              className="my-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setMemberSearch(searchDraft.trim());
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400"
                />
                <Input
                  aria-label="이름 또는 이메일 검색"
                  placeholder="이름 또는 이메일"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  className="h-10 pl-9"
                  maxLength={200}
                />
              </div>
              <Button type="submit" variant="outline" className="h-10 shrink-0">
                검색
              </Button>
              {memberSearch && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 shrink-0 px-2"
                  onClick={() => {
                    setSearchDraft('');
                    setMemberSearch('');
                  }}
                >
                  초기화
                </Button>
              )}
            </form>
          </div>
          <div
            role="tabpanel"
            id="member-directory-panel"
            aria-labelledby={`member-tab-${memberTab}`}
            className="divide-y"
            tabIndex={0}
          >
            <output className="block px-4 py-3 text-xs text-slate-500 sm:px-5">
              {memberTabLabel} {visibleMembers.length}명
              {memberSearch ? ' · 검색 결과' : ''}
            </output>
            {visibleMembers.map((member) => {
              const profile = props.profiles[member.user_id];
              const protectedSuperAdmin = member.user_id === superAdminUserId;
              const isSelf = member.user_id === props.session.user.id;
              const memberActionLocked =
                !props.canWrite ||
                busyMemberId !== null ||
                busy ||
                pendingAction !== null;
              return (
                <div key={member.user_id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-sm">
                      {profile?.display_name || '이름 미등록'}
                    </strong>
                    {protectedSuperAdmin && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
                        <ShieldCheck className="size-3" />
                        최고 관리자
                      </span>
                    )}
                    {member.role === 'owner' &&
                      !protectedSuperAdmin &&
                      !isSelf && (
                        <div className="flex items-center gap-1">
                          {isSuperAdmin && member.status === 'active' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-11 rounded-lg text-slate-400 hover:bg-teal-50 hover:text-teal-700 sm:size-9"
                              aria-label={`${profile?.display_name || profile?.email || '선택한 관리자'} 최고 관리자 양도`}
                              title="최고 관리자 양도"
                              disabled={memberActionLocked}
                              onClick={() =>
                                setPendingAction({ kind: 'transfer', member })
                              }
                            >
                              <ShieldCheck className="size-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-11 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 sm:size-9"
                            aria-label={`${profile?.display_name || profile?.email || '선택한 관리자'} 관리자 삭제`}
                            title="관리자 삭제"
                            disabled={memberActionLocked}
                            onClick={() =>
                              setPendingAction({ kind: 'remove', member })
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                  </div>
                  <p className="mt-1 break-all text-xs text-slate-500">
                    {profile?.email || '이메일 확인 중'}
                  </p>
                  <div className="mt-3 space-y-2">
                    <div className="grid max-w-sm grid-cols-2 gap-2">
                      <select
                        className="h-10 min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-sm text-slate-600"
                        value={member.role}
                        disabled={memberActionLocked || protectedSuperAdmin}
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
                        className="h-10 min-w-0 rounded-lg border border-slate-200 bg-slate-50/60 px-3 text-sm text-slate-600"
                        value={member.status}
                        disabled={memberActionLocked || protectedSuperAdmin}
                        onChange={(e) =>
                          void updateMember(member, { status: e.target.value })
                        }
                        aria-label="계정 상태"
                      >
                        <option value="invited">초대 대기</option>
                        <option
                          value="active"
                          disabled={member.status === 'invited'}
                        >
                          사용 중
                        </option>
                        <option value="suspended">사용 중지</option>
                      </select>
                    </div>
                    {protectedSuperAdmin && (
                      <p className="text-xs leading-5 text-slate-500">
                        최고 관리자는 양도 전까지 삭제·중지할 수 없습니다.
                      </p>
                    )}
                    {busyMemberId === member.user_id && (
                      <Loader2 className="m-auto size-4 animate-spin text-teal-600" />
                    )}
                  </div>
                </div>
              );
            })}
            {visibleMembers.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                {memberSearch
                  ? '검색 결과가 없습니다. 이름이나 이메일을 확인해 주세요.'
                  : `등록된 ${memberTabLabel} 계정이 없습니다.`}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
