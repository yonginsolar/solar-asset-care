'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  Loader2,
  Printer,
  ShieldCheck,
  SunMedium,
} from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Tables } from '@/lib/supabase/database.types';
import { AssessmentSummary } from './live-assessments';
import type {
  AssessmentResult,
  CalculationInput,
  Capture,
} from '@/lib/operational-assessment';
import { defectLabels, kindLabels, severityLabels } from '@/lib/finding-labels';
import { requestReportPdf } from '@/lib/report-download';
import { EconomicChart, ReportPhoto } from './report-visuals';
import type { ReportImage } from '@/lib/report-visuals';

type Report = Tables<'reports'>;
type Inspection = Tables<'inspections'>;
type Plant = Tables<'plants'>;
type Organization = Tables<'organizations'>;
type Finding = Tables<'findings'>;
type Maintenance = Tables<'maintenance_requests'>;

type ReportData = {
  report: Report;
  inspection: Pick<
    Inspection,
    'inspection_code' | 'purpose' | 'notes' | 'scheduled_at'
  >;
  plant: Pick<Plant, 'name' | 'address' | 'capacity_kw'>;
  organization: Pick<Organization, 'name'>;
  findings: Finding[];
  maintenance: Pick<Maintenance, 'id' | 'title' | 'status'>[];
  fileCount: number;
  assessment: Tables<'inspection_assessments'> | null;
  settings: Tables<'calculation_settings'> | null;
  snapshot: Tables<'report_snapshots'> | null;
  reportImages?: ReportImage[];
};

function format(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function LiveReport({ reportId }: { reportId: string }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  async function downloadPdf() {
    if (!supabase || !data || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await requestReportPdf(supabase, reportId);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `진단보고서-${data.report.version}차.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF를 내려받지 못했습니다.');
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (!supabase) {
        setError('보고서를 불러올 수 없습니다. 관리자에게 문의해 주세요.');
        setLoading(false);
        return;
      }
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        setError('보고서를 보려면 먼저 로그인해 주세요.');
        setLoading(false);
        return;
      }
      try {
        const { data: report, error: reportError } = await supabase
          .from('reports')
          .select('*')
          .eq('id', reportId)
          .single();
        if (reportError) throw reportError;
        const { data: snapshot, error: snapshotError } = await supabase
          .from('report_snapshots')
          .select('*')
          .eq('report_id', reportId)
          .maybeSingle();
        if (snapshotError) throw snapshotError;
        if (snapshot) {
          const content = snapshot.content as unknown as Omit<
            ReportData,
            'report' | 'fileCount' | 'snapshot'
          > & { schemaVersion: number; title: string; files: unknown[] };
          if (
            ![1, 2].includes(content.schemaVersion) ||
            !content.plant ||
            !content.inspection ||
            !Array.isArray(content.files)
          )
            throw new Error('지원하지 않는 보고서 보관 형식입니다.');
          setData({
            ...content,
            report: { ...report, title: content.title },
            fileCount: content.files.length,
            snapshot,
          });
          return;
        }
        if (['approved', 'published', 'withdrawn'].includes(report.status))
          throw new Error(
            '검토 보관본이 없습니다. 관리자가 보고서를 다시 검토해야 합니다.',
          );
        const [inspectionResult, findingResult, maintenanceResult, fileResult] =
          await Promise.all([
            supabase
              .from('inspections')
              .select('*')
              .eq('id', report.inspection_id)
              .single(),
            supabase
              .from('findings')
              .select('*')
              .eq('inspection_id', report.inspection_id)
              .order('created_at'),
            supabase
              .from('maintenance_requests')
              .select('*')
              .eq('inspection_id', report.inspection_id)
              .order('created_at'),
            supabase
              .from('inspection_files')
              .select('id', { count: 'exact' })
              .eq('inspection_id', report.inspection_id),
          ]);
        if (inspectionResult.error) throw inspectionResult.error;
        if (findingResult.error) throw findingResult.error;
        if (maintenanceResult.error) throw maintenanceResult.error;
        if (fileResult.error) throw fileResult.error;
        const inspection = inspectionResult.data;
        const [plantResult, organizationResult] = await Promise.all([
          supabase
            .from('plants')
            .select('*')
            .eq('id', inspection.plant_id)
            .single(),
          supabase
            .from('organizations')
            .select('*')
            .eq('id', report.organization_id)
            .single(),
        ]);
        if (plantResult.error) throw plantResult.error;
        if (organizationResult.error) throw organizationResult.error;
        const { data: assessment, error: assessmentError } = await supabase
          .from('inspection_assessments')
          .select('*')
          .eq('inspection_id', report.inspection_id)
          .maybeSingle();
        if (assessmentError) throw assessmentError;
        const settingsResult = assessment
          ? await supabase
              .from('calculation_settings')
              .select('*')
              .eq('id', assessment.settings_id)
              .single()
          : null;
        if (settingsResult?.error) throw settingsResult.error;
        setData({
          report,
          inspection,
          plant: plantResult.data,
          organization: organizationResult.data,
          findings: findingResult.data ?? [],
          maintenance: maintenanceResult.data ?? [],
          fileCount: fileResult.count ?? 0,
          assessment,
          settings: settingsResult?.data ?? null,
          snapshot: null,
        });
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : '보고서를 불러올 수 없습니다.',
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [reportId, supabase]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Loader2 className="size-7 animate-spin text-teal-600" />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-5">
        <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto size-9 text-amber-500" />
          <h1 className="mt-4 text-xl font-bold">
            보고서를 표시할 수 없습니다
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{error}</p>
          <Link href="/admin" className={buttonVariants({ className: 'mt-6' })}>
            <ArrowLeft />
            운영센터로 이동
          </Link>
        </div>
      </main>
    );
  }

  const accepted = data.findings.filter((finding) =>
    ['accepted', 'modified'].includes(finding.disposition),
  );
  const capture = data.assessment?.capture as Capture | undefined;
  const input = data.assessment?.calculation_input as
    | CalculationInput
    | undefined;
  const warnings = (data.assessment?.warnings ?? []) as string[];
  const statusLabels: Record<string, string> = {
    draft: '작성 중',
    review: '검토 중',
    approved: '승인',
    published: '발행',
    withdrawn: '회수',
  };
  return (
    <main className="min-h-screen bg-slate-200 px-2 py-4 text-slate-900 sm:px-4 sm:py-8 print:bg-white print:p-0">
      <div className="report-actions mx-auto mb-4 flex max-w-[210mm] flex-col gap-2 sm:flex-row sm:justify-between">
        <Link href="/admin" className={buttonVariants({ variant: 'outline' })}>
          <ArrowLeft />
          운영센터
        </Link>
        {['published', 'withdrawn'].includes(data.report.status) && (
          <Button disabled={downloading} onClick={() => void downloadPdf()}>
            <Download />
            {downloading ? '다운로드 중…' : '보관 PDF 다운로드'}
          </Button>
        )}
        <Button variant="outline" onClick={() => window.print()}>
          <Printer />
          인쇄·PDF 저장
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="report-actions mx-auto mb-4 max-w-[210mm] rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
        >
          {error}
        </p>
      )}
      <article className="report-sheet mx-auto max-w-[210mm] bg-white p-5 shadow-xl sm:min-h-[297mm] sm:p-[16mm] print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex flex-col items-start justify-between gap-5 border-b-2 border-slate-900 pb-6 sm:flex-row">
          <div>
            <div className="flex items-center gap-2 text-teal-700">
              <SunMedium className="size-5" />
              <strong>SolarScope</strong>
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              {data.report.title}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {data.inspection.inspection_code} · 보고서 {data.report.version}차
            </p>
          </div>
          <div className="w-full rounded-xl border px-4 py-3 text-left sm:w-auto sm:text-right">
            <span className="block text-xs text-slate-500">상태</span>
            <strong className="mt-1 block text-sm">
              {statusLabels[data.report.status] ?? data.report.status}
            </strong>
          </div>
        </header>

        <section className="report-meta grid gap-4 border-b py-6 text-sm sm:grid-cols-2 sm:gap-x-8">
          <ReportItem label="발전소" value={data.plant.name} />
          <ReportItem label="운영 조직" value={data.organization.name} />
          <ReportItem label="주소" value={data.plant.address || '미입력'} />
          <ReportItem
            label="설비용량"
            value={
              data.plant.capacity_kw == null
                ? '미입력'
                : `${Number(data.plant.capacity_kw).toLocaleString()} kW`
            }
          />
          <ReportItem
            label="점검 예정"
            value={format(data.inspection.scheduled_at)}
          />
          <ReportItem label="원본 파일" value={`${data.fileCount}개`} />
        </section>

        <ReportSection title="점검 개요">
          <p>{data.inspection.purpose || '점검 목적 미입력'}</p>
          <p className="mt-2 text-slate-600">
            {data.inspection.notes || '별도 현장 메모가 없습니다.'}
          </p>
        </ReportSection>

        {!data.assessment && (
          <ReportSection title="사진 진단 범위">
            <p>
              사진의 상대 색상 분포와 전문가 소견을 검토합니다. 촬영조건 측정
              자료가 없어 촬영 유효성은 확인하지 않았으며 실제 온도·고장을
              확정하는 진단은 아닙니다.
            </p>
            <p className="mt-2">
              경제성 분석은 실시하지 않았습니다. 발전량·수리비 등은 필요할 때
              확인하고 새 보고서 버전에 반영할 수 있습니다.
            </p>
          </ReportSection>
        )}

        {capture && (
          <ReportSection title="촬영조건·유효성">
            <div className="grid gap-4 sm:grid-cols-2">
              <ReportItem
                label="촬영·측정 시각"
                value={format(capture.measuredAt)}
              />
              <ReportItem label="측정 장비·출처" value={capture.source} />
              <ReportItem
                label="면내 일사량"
                value={`${capture.irradiance} W/m²`}
              />
              <ReportItem
                label="풍속·외기온"
                value={`${capture.wind} m/s · ${capture.ambientTemperature} ℃`}
              />
              <ReportItem
                label="촬영각도·거리"
                value={`${capture.angle}° (패널면 기준) · ${capture.distance} m`}
              />
              <ReportItem
                label="적용 기준"
                value={`${data.settings?.version}판 · ${data.settings?.effective_from}부터`}
              />
            </div>
            {warnings.length > 0 ? (
              <div className="mt-4 rounded-xl bg-amber-50 p-3 text-amber-900">
                <p>{warnings.join(' · ')}</p>
                <p>
                  {data.assessment?.exception_approved_by
                    ? `관리자 예외 승인: ${data.assessment.exception_reason}`
                    : '촬영조건 미충족 · 검토 요청 불가'}
                </p>
              </div>
            ) : (
              <p className="mt-4">
                입력된 촬영조건이 선택한 기준을 충족합니다.
              </p>
            )}
          </ReportSection>
        )}

        {data.assessment && input && (
          <ReportSection title="발전량·개선 효과 추정">
            <p className="mb-4">
              {input.periodStart} ~ {input.periodEnd} (양 끝 날짜 포함)
              <br />
              실발전량 출처: {input.generationSource}
            </p>
            <AssessmentSummary
              result={data.assessment.result as AssessmentResult}
            />
            <EconomicChart
              result={data.assessment.result as AssessmentResult}
            />
          </ReportSection>
        )}

        <ReportSection title="전문가 채택 소견">
          {accepted.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[34rem] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-y bg-slate-50">
                    <th className="px-3 py-2">구분</th>
                    <th className="px-3 py-2">상대 점수</th>
                    <th className="px-3 py-2">측정 온도·온도차</th>
                    <th className="px-3 py-2">판정 메모</th>
                  </tr>
                </thead>
                <tbody>
                  {accepted.map((finding, index) => (
                    <tr key={finding.id} className="border-b">
                      <td className="px-3 py-3">
                        {index + 1}.{' '}
                        {finding.defect_type
                          ? defectLabels[finding.defect_type]
                          : (kindLabels[finding.kind] ?? finding.kind)}
                        <br />
                        {finding.location_label} ·{' '}
                        {severityLabels[finding.severity]}
                      </td>
                      <td className="px-3 py-3">
                        {finding.relative_heat_score ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        {finding.temperature_max_c == null
                          ? '미측정'
                          : `${finding.temperature_max_c} ℃`}
                        <br />
                        {finding.temperature_delta_c == null
                          ? '온도차 미측정'
                          : `ΔT ${finding.temperature_delta_c} ℃`}
                      </td>
                      <td className="px-3 py-3">
                        {finding.expert_note || '채택'}
                        {finding.measurement_source && (
                          <p>온도 측정 근거: {finding.measurement_source}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-600">
              전문가가 채택한 이상 소견이 없습니다.
            </p>
          )}
        </ReportSection>

        <ReportSection title="후속 유지보수">
          {data.maintenance.length ? (
            <ul className="space-y-3">
              {data.maintenance.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col justify-between gap-1 border-b pb-3 sm:flex-row"
                >
                  <span>{item.title}</span>
                  <strong>{item.status}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-600">연결된 유지보수 요청이 없습니다.</p>
          )}
        </ReportSection>

        <aside className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
          색상 분포 기반 후보는 실제 섭씨 온도 측정이나 고장 확정값이 아닙니다.
          최종 판단에는 원본 열화상 메타데이터, 촬영 조건, 전기적 계측과 전문가
          검토가 필요합니다.
        </aside>
        <footer className="report-footer mt-12 flex flex-col justify-between gap-2 border-t pt-5 text-xs text-slate-500 sm:flex-row">
          <span>생성 {format(data.report.created_at)}</span>
          <span>승인 {format(data.report.approved_at)}</span>
        </footer>
        {!!data.reportImages?.length && supabase && (
          <ReportSection title="점검 사진·이상 위치">
            <div className="space-y-6">
              {data.reportImages.map((photo) => (
                <ReportPhoto
                  key={photo.id}
                  client={supabase}
                  photo={photo}
                  reportId={reportId}
                  findings={accepted}
                />
              ))}
            </div>
          </ReportSection>
        )}
        {data.snapshot && (
          <p className="mt-3 break-all text-xs text-slate-500">
            검토본 보관 {format(data.snapshot.frozen_at)}
          </p>
        )}
      </article>
    </main>
  );
}

function ReportItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block">{value}</strong>
    </div>
  );
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="report-section border-b py-7">
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      <div className="text-sm leading-7">{children}</div>
    </section>
  );
}
