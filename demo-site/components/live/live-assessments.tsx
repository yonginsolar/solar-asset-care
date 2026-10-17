'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useInspectionSelection } from '@/lib/inspection-context';
import { useFormDraftProtection } from '@/lib/use-form-draft-protection';
import { formatPaybackYears } from '@/lib/payback-format';
import type { Database, Tables } from '@/lib/supabase/database.types';
import {
  calculateAssessment,
  captureWarnings,
  improvementLabels,
  koreanDate,
  parseKoreanInput,
  settingFields,
  toKoreanInput,
  validateSettings,
  type AssessmentResult,
  type CalculationInput,
  type Capture,
  type Settings,
} from '@/lib/operational-assessment';

type SettingsRow = Tables<'calculation_settings'>;
type Assessment = Tables<'inspection_assessments'>;
type Props = {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  setNotice: (
    notice: { tone: 'success' | 'error' | 'info'; text: string } | null,
  ) => void;
};
const selectStyle =
  'min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-base';
const cardStyle = 'min-w-0 rounded-2xl border bg-white p-5 shadow-sm';
function message(e: unknown) {
  return e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : '처리하지 못했습니다. 다시 시도해 주세요.';
}
function text(f: FormData, k: string) {
  const value = f.get(k);
  return typeof value === 'string' ? value.trim() : '';
}
function number(f: FormData, k: string) {
  const value = text(f, k);
  if (!value || !Number.isFinite(Number(value)))
    throw new Error('숫자 항목을 모두 입력해 주세요.');
  return Number(value);
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      {children}
    </label>
  );
}
function useSettings({ supabase, organizationId, setNotice }: Props) {
  const [rows, setRows] = useState<SettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('calculation_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .order('effective_from', { ascending: false })
        .order('version', { ascending: false });
      if (error) throw error;
      setRows(data ?? []);
    } catch (e) {
      setNotice({ tone: 'error', text: message(e) });
    } finally {
      setLoading(false);
    }
  }, [supabase, organizationId, setNotice]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return { rows, loading, refresh };
}

export function CalculationSettingsView(props: Props) {
  const { rows, loading, refresh } = useSettings(props);
  const latest = rows[0];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">계산·촬영 기준</h1>
      <p className="text-sm leading-6 text-slate-600">
        단가는 원/kWh로 입력하세요. REC가 원/MWh로 제공되면 1,000으로 나눠
        입력합니다. 변경한 기준은 새 판본으로 저장되며 기존 보고서에는 소급
        적용되지 않습니다.
      </p>
      {loading ? (
        <output>기준을 불러오는 중…</output>
      ) : (
        <SettingsForm
          key={latest?.id ?? 'new'}
          {...props}
          initial={latest}
          saved={refresh}
        />
      )}
      <section className={cardStyle}>
        <h2 className="mb-4 font-bold">변경 이력</h2>
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="py-3 text-sm">
                <strong>
                  {row.version}판 · {row.effective_from}부터
                </strong>
                <p className="mt-1 break-words text-slate-600">
                  {row.change_reason}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">등록된 기준이 없습니다.</p>
        )}
      </section>
    </div>
  );
}
function SettingsForm(
  props: Props & { initial?: SettingsRow; saved: () => Promise<void> },
) {
  const initial = props.initial?.values as Settings | undefined;
  const [busy, setBusy] = useState(false);
  const { ref: formRef, ...draft } = useFormDraftProtection(busy);
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    props.setNotice(null);
    try {
      const v = Object.fromEntries(
        settingFields.map(([k]) => [k, number(f, k)]),
      ) as Omit<Settings, 'improvementRates'> as Settings;
      v.improvementRates = Object.fromEntries(
        Object.keys(improvementLabels).map((k) => [
          k,
          number(f, `rate_${k}`) / 100,
        ]),
      ) as Settings['improvementRates'];
      validateSettings(v);
      const { error } = await props.supabase.rpc('save_calculation_settings', {
        p_organization_id: props.organizationId,
        p_effective_from: text(f, 'effectiveFrom'),
        p_values: v,
        p_reason: text(f, 'reason'),
      });
      if (error) throw error;
      props.setNotice({
        tone: 'success',
        text: '새 계산 기준을 저장했습니다. 점검 평가에서 사용할 판본을 선택해 주세요.',
      });
      await props.saved();
    } catch (error) {
      props.setNotice({ tone: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      ref={formRef}
      onInput={draft.onInput}
      onChange={draft.onChange}
      onSubmit={submit}
      className={`${cardStyle} space-y-5`}
    >
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <h2 className="font-bold">
          {props.initial ? '새 판본 등록' : '첫 계산 기준 등록'}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {settingFields.map(([k, label, min, max, suggested]) => (
            <Field key={k} label={label}>
              <Input
                name={k}
                type="number"
                required
                min={min}
                max={max}
                step="any"
                defaultValue={initial?.[k] ?? suggested}
              />
            </Field>
          ))}
        </div>
        <h3 className="font-semibold">이상 유형별 개선가능비율</h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(improvementLabels).map(([key, label], index) => (
            <Field key={key} label={`${label} (%)`}>
              <Input
                name={`rate_${key}`}
                type="number"
                required
                min="0"
                max="100"
                step="any"
                defaultValue={
                  initial
                    ? initial.improvementRates[
                        key as keyof typeof improvementLabels
                      ] * 100
                    : [90, 95, 100, 70, 40][index]
                }
              />
            </Field>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="적용 시작일">
            <Input
              name="effectiveFrom"
              type="date"
              required
              defaultValue={koreanDate()}
            />
          </Field>
          <Field label="변경 사유·단가 출처">
            <Textarea
              name="reason"
              required
              maxLength={1000}
              placeholder="기준을 정한 근거와 단가 출처"
            />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? '저장 중…' : '새 기준 저장'}
        </Button>
      </fieldset>
    </form>
  );
}

export function AssessmentsView(
  props: Props & {
    inspections: Tables<'inspections'>[];
    plants: Tables<'plants'>[];
    isOwner: boolean;
    readOnly?: boolean;
  },
) {
  const { rows, loading } = useSettings(props);
  const [id, setSelected] = useInspectionSelection(props.inspections);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [fetching, setFetching] = useState(true);
  const { supabase, setNotice } = props;
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setFetching(true);
    setAssessment(null);
    try {
      if (!id) return;
      const { data, error } = await supabase
        .from('inspection_assessments')
        .select('*')
        .eq('inspection_id', id)
        .maybeSingle();
      if (current !== request.current) return;
      if (error) throw error;
      setAssessment(data);
    } catch (e) {
      if (current === request.current)
        setNotice({ tone: 'error', text: message(e) });
    } finally {
      if (current === request.current) setFetching(false);
    }
  }, [id, supabase, setNotice]);
  useEffect(() => {
    const counter = request;
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      counter.current++;
    };
  }, [load]);
  const inspection = props.inspections.find((row) => row.id === id);
  const plant = props.plants.find((row) => row.id === inspection?.plant_id);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">경제성 분석·촬영조건</h1>
      <p className="text-sm leading-6 text-slate-600">
        선택 단계입니다. 사진 진단 보고서를 먼저 진행할 수 있으며, 아래 자료는
        발전량·개선 효과를 계산할 때만 입력합니다. 확인하지 못한 값을 임의로
        입력하지 마세요.
      </p>
      <Field label="점검 선택">
        <select
          value={id}
          onChange={(e) => setSelected(e.target.value)}
          className={selectStyle}
        >
          <option value="" disabled>
            점검을 선택하세요
          </option>
          {props.inspections.map((row) => (
            <option key={row.id} value={row.id}>
              {row.inspection_code} ·{' '}
              {props.plants.find((p) => p.id === row.plant_id)?.name}
            </option>
          ))}
        </select>
      </Field>
      {!id ? (
        <p>먼저 발전소와 점검을 등록해 주세요.</p>
      ) : loading || fetching ? (
        <output>평가를 불러오는 중…</output>
      ) : !rows.length ? (
        <p>관리자가 ‘계산·촬영 기준’을 먼저 등록해야 합니다.</p>
      ) : (
        plant && (
          <AssessmentForm
            key={`${id}-${assessment?.revision ?? 0}`}
            {...props}
            inspectionId={id}
            plant={plant}
            settings={rows}
            initial={assessment}
            saved={load}
          />
        )
      )}
    </div>
  );
}
function AssessmentForm(
  props: Props & {
    inspectionId: string;
    plant: Tables<'plants'>;
    settings: SettingsRow[];
    initial: Assessment | null;
    isOwner: boolean;
    readOnly?: boolean;
    saved: () => Promise<void>;
  },
) {
  const a = props.initial;
  const c = a?.capture as Capture | undefined;
  const p = a?.calculation_input as CalculationInput | undefined;
  const r = a?.result as AssessmentResult | undefined;
  const warnings = (a?.warnings ?? []) as string[];
  const [busy, setBusy] = useState(false);
  const { ref: formRef, ...draft } = useFormDraftProtection(busy);
  const [settingsId, setSettingsId] = useState(
    a?.settings_id ||
      props.settings.find((s) => s.effective_from <= koreanDate())?.id ||
      '',
  );
  const missingPlant = !props.plant.capacity_kw || !props.plant.commissioned_on;
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    props.setNotice(null);
    try {
      const s = props.settings.find((row) => row.id === settingsId);
      if (!s) throw new Error('사용할 계산 기준을 선택해 주세요.');
      const input: CalculationInput = {
        periodStart: text(f, 'periodStart'),
        periodEnd: text(f, 'periodEnd'),
        capacityKwp: Number(props.plant.capacity_kw),
        installationYear: Number(props.plant.commissioned_on?.slice(0, 4)),
        actualGenerationKwh: number(f, 'actualGenerationKwh'),
        repairCost: number(f, 'repairCost'),
        operationType: text(
          f,
          'operationType',
        ) as CalculationInput['operationType'],
        defectType: text(f, 'defectType') as CalculationInput['defectType'],
        generationSource: text(f, 'generationSource'),
      };
      const capture: Capture = {
        measuredAt: parseKoreanInput(text(f, 'measuredAt')),
        source: text(f, 'source'),
        irradiance: number(f, 'irradiance'),
        wind: number(f, 'wind'),
        ambientTemperature: number(f, 'ambientTemperature'),
        angle: number(f, 'angle'),
        distance: number(f, 'distance'),
      };
      calculateAssessment(input, s.values as Settings);
      captureWarnings(capture, s.values as Settings);
      const { data, error } = await props.supabase.rpc(
        'save_inspection_assessment',
        {
          p_inspection_id: props.inspectionId,
          p_settings_id: settingsId,
          p_capture: capture,
          p_input: input,
          p_exception_reason: props.isOwner ? text(f, 'exceptionReason') : '',
          p_expected_revision: a?.revision ?? 0,
        },
      );
      if (error) throw error;
      const warnings = data.warnings as string[];
      props.setNotice({
        tone:
          warnings.length && !data.exception_approved_by ? 'info' : 'success',
        text:
          warnings.length && !data.exception_approved_by
            ? '평가를 저장했습니다. 촬영조건 경고를 해결하기 전에는 보고서 검토를 요청할 수 없습니다.'
            : '촬영조건과 발전량 평가를 저장했습니다.',
      });
      await props.saved();
    } catch (e) {
      props.setNotice({ tone: 'error', text: message(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {missingPlant && (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
          경제성 계산에 필요한 설비용량과 가동 시작일을 발전소 정보에서 보완해
          주세요. 사진 진단 보고서는 이 정보 없이도 진행할 수 있습니다.
        </p>
      )}
      <form
        ref={formRef}
        onInput={draft.onInput}
        onChange={draft.onChange}
        onSubmit={submit}
        className={`${cardStyle} space-y-6`}
      >
        <fieldset disabled={busy || props.readOnly} className="space-y-6">
          <Field label="적용할 계산 기준">
            <select
              name="settingsId"
              required
              value={settingsId}
              onChange={(e) => setSettingsId(e.target.value)}
              className={selectStyle}
            >
              <option value="">선택하세요</option>
              {props.settings.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.version}판 · {s.effective_from}부터
                </option>
              ))}
            </select>
          </Field>
          <h2 className="font-bold">촬영조건</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="촬영·측정 시각 (한국시간)">
              <Input
                name="measuredAt"
                type="datetime-local"
                required
                defaultValue={c ? toKoreanInput(c.measuredAt) : ''}
              />
            </Field>
            <Field label="면내 일사량 (W/m²)">
              <Input
                name="irradiance"
                type="number"
                required
                min="0"
                max="2000"
                step="any"
                defaultValue={c?.irradiance}
              />
            </Field>
            <Field label="풍속 (m/s)">
              <Input
                name="wind"
                type="number"
                required
                min="0"
                max="100"
                step="any"
                defaultValue={c?.wind}
              />
            </Field>
            <Field label="외기온 (℃)">
              <Input
                name="ambientTemperature"
                type="number"
                required
                min="-80"
                max="80"
                step="any"
                defaultValue={c?.ambientTemperature}
              />
            </Field>
            <Field label="촬영각도 (°·패널면 기준)">
              <Input
                name="angle"
                type="number"
                required
                min="0"
                max="90"
                step="any"
                defaultValue={c?.angle}
              />
            </Field>
            <Field label="촬영거리 (m)">
              <Input
                name="distance"
                type="number"
                required
                min="0.01"
                max="1000"
                step="any"
                defaultValue={c?.distance}
              />
            </Field>
          </div>
          <Field label="촬영조건 측정 장비·출처">
            <Input
              name="source"
              required
              maxLength={1000}
              defaultValue={c?.source}
            />
          </Field>
          <h2 className="font-bold">발전량·개선 효과</h2>
          <p className="text-sm text-slate-600">
            설비용량 {props.plant.capacity_kw ?? '미입력'} kW · 가동 시작일{' '}
            {props.plant.commissioned_on ?? '미입력'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="분석 시작일 (포함)">
              <Input
                name="periodStart"
                type="date"
                required
                min={props.plant.commissioned_on ?? undefined}
                max={koreanDate()}
                defaultValue={p?.periodStart}
              />
            </Field>
            <Field label="분석 종료일 (포함)">
              <Input
                name="periodEnd"
                type="date"
                required
                min={props.plant.commissioned_on ?? undefined}
                max={koreanDate()}
                defaultValue={p?.periodEnd}
              />
            </Field>
            <Field label="같은 기간 실발전량 (kWh)">
              <Input
                name="actualGenerationKwh"
                type="number"
                required
                min="0"
                max="100000000000"
                step="any"
                defaultValue={p?.actualGenerationKwh}
              />
            </Field>
            <Field label="발전 전력 이용 방식">
              <select
                name="operationType"
                className={selectStyle}
                defaultValue={p?.operationType ?? 'generation'}
              >
                <option value="generation">발전사업형</option>
                <option value="self-use">자가소비형</option>
              </select>
            </Field>
            <Field label="개선 대상">
              <select
                name="defectType"
                className={selectStyle}
                defaultValue={p?.defectType ?? 'soiling'}
              >
                {Object.entries(improvementLabels).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="예상 수리비 (원)">
              <Input
                name="repairCost"
                type="number"
                required
                min="0"
                max="1000000000000"
                step="any"
                defaultValue={p?.repairCost}
              />
            </Field>
          </div>
          <Field label="실발전량 출처·확인 근거">
            <Textarea
              name="generationSource"
              required
              maxLength={1000}
              defaultValue={p?.generationSource}
              placeholder="예: 해당 기간 인버터 누적발전량 검침 기록"
            />
          </Field>
          {props.isOwner && (
            <Field label="촬영조건 예외 승인 사유 (기준 이탈을 승인할 때만 입력)">
              <Textarea
                name="exceptionReason"
                maxLength={1000}
                defaultValue={a?.exception_reason ?? ''}
              />
            </Field>
          )}
          <Button type="submit" disabled={busy || missingPlant || !settingsId}>
            {busy ? '계산·저장 중…' : '평가 계산·저장'}
          </Button>
        </fieldset>
      </form>
      {r && (
        <section className={cardStyle}>
          <h2 className="mb-4 font-bold">저장된 평가 · {a?.revision}차</h2>
          <AssessmentSummary result={r} />
          {warnings.length > 0 && (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="mt-2">
                {a?.exception_approved_by
                  ? `관리자 예외 승인: ${a.exception_reason}`
                  : '보고서 검토 요청 불가 · 조건 보완 또는 관리자 검토 필요'}
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function AssessmentSummary({ result: r }: { result: AssessmentResult }) {
  const fmt = (v: number, unit: string) =>
    `${v.toLocaleString('ko-KR', { maximumFractionDigits: unit.includes('원') ? 0 : 1 })} ${unit}`;
  return (
    <div>
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ['기대발전량', fmt(r.expectedGenerationKwh, 'kWh')],
          ['실발전량', fmt(r.actualGenerationKwh, 'kWh')],
          [
            '기대발전량 대비 성능비',
            `${(r.performanceRatio * 100).toFixed(1)}% · ${r.prStatus}`,
          ],
          ['분석기간', `${r.periodDays}일`],
          ['추정 손실량', fmt(r.lossKwh, 'kWh')],
          ['추정 손실금액', fmt(r.lossAmount, '원')],
          ['기간 기대수익', fmt(r.expectedRevenue, '원')],
          ['기간 현재수익', fmt(r.currentRevenue, '원')],
          ['기간 회수가능액', fmt(r.recoverableAmount, '원')],
          ['연간 환산 회수가능액', fmt(r.annualRecoverableAmount, '원/년')],
          ['적용 단가', fmt(r.tariff, '원/kWh')],
          ['단순 투자회수기간', formatPaybackYears(r.paybackYears)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 break-words font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        수치와 금액은 입력 자료·설정 기준에 따른 추정치입니다. 손실량은 0
        미만으로 표시하지 않으며, 회수기간은 해당 기간 회수가능액을 365일로
        환산해 계산합니다. 계절 변화·금융비용·세금은 반영하지 않습니다.
      </p>
    </div>
  );
}
