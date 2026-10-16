// Build-time only: render a public, synthetic PDF with the production renderer.
// No provider SDK, account, network request or production record is used.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const labels = dataUrl(compile('../lib/finding-labels.ts'));
const visuals = dataUrl(compile('../lib/report-visuals.ts'));
const source = compile('../lib/report-pdf.ts')
  .replace(
    /from ['"].\/payback-format['"]/g,
    `from '${dataUrl(compile('../lib/payback-format.ts'))}'`,
  )
  .replace(/from ['"]pdf-lib['"]/g, `from '${import.meta.resolve('pdf-lib')}'`)
  .replace(
    /from ['"]@pdf-lib\/fontkit['"]/g,
    `from '${import.meta.resolve('@pdf-lib/fontkit')}'`,
  )
  .replace(/from ['"].\/finding-labels['"]/g, `from '${labels}'`)
  .replace(/from ['"].\/report-visuals['"]/g, `from '${visuals}'`);
const { renderReportPdf, sha256 } = await import(dataUrl(source));
const { calculateAssessment, captureWarnings } = await import(
  dataUrl(compile('../lib/operational-assessment.ts'))
);

// The daylight input is chosen to reproduce the guest screen's 11,000 kWh example.
const settings = {
  sunHours: 3.5555,
  degradationRatePercent: 0.6,
  orientationFactor: 1,
  selfUseTariff: 165,
  smp: 125,
  rec: 72,
  recWeight: 1,
  prNormal: 0.85,
  prWarning: 0.7,
  irradianceMinimum: 600,
  windWarning: 7,
  angleMinimum: 10,
  angleMaximum: 80,
  distanceMaximum: 30,
  deltaTWarning: 5,
  deltaTCritical: 10,
  improvementRates: {
    soiling: 0.7,
    string: 0.8,
    inverter: 0.8,
    diode: 0.5,
    cell_pid: 0.4,
  },
};
const calculationInput = {
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  capacityKwp: 99.8,
  installationYear: 2026,
  actualGenerationKwh: 10000,
  operationType: 'generation',
  repairCost: 550000,
  defectType: 'soiling',
  generationSource: '둘러보기용 가상 수치 (실제 계측 아님)',
};
const capture = {
  measuredAt: '2026-09-01T01:00:00Z',
  source: '촬영조건 예시 (실제 측정 아님)',
  irradiance: 750,
  wind: 2.5,
  ambientTemperature: 28,
  angle: 45,
  distance: 15,
};
export const guestReportContent = {
  schemaVersion: 1,
  title: '샘플 햇빛 1호 · 정기 진단보고서',
  organization: { name: '샘플 운영기관' },
  plant: {
    name: '샘플 햇빛 1호',
    address: '경기 부천시 (가상 설비, 상세 주소 없음)',
    capacity_kw: 99.8,
    commissioned_on: '2026-01-01',
  },
  inspection: {
    inspection_code: 'SAMPLE-001',
    purpose: '정기 진단 및 후속 조치 검토 예시',
    notes:
      '샘플 발행일 2026-09-04. A동 2열 3번과 4열 1번의 확인 절차를 예시로 작성했습니다. 사진과 온도 원본은 제공하지 않습니다.',
  },
  assessment: {
    capture,
    calculation_input: calculationInput,
    result: calculateAssessment(calculationInput, settings),
    warnings: captureWarnings(capture, settings),
    exception_reason: null,
  },
  settings: { version: 1, effective_from: '2026-01-01', values: settings },
  findings: [
    {
      id: 'SAMPLE-FINDING-001',
      kind: 'other',
      defect_type: 'soiling_shade',
      severity: 'review',
      location_label: 'A동 · 2열 3번',
      relative_heat_score: null,
      temperature_max_c: null,
      temperature_delta_c: null,
      measurement_source: '가상 소견. 실제 온도는 측정하지 않았습니다.',
      expert_note:
        '표면 청소 후 발전량을 다시 확인합니다. 청소 전후 사진과 같은 조건의 발전량을 비교하고, 음영 원인이 지속되는지 점검하는 예시입니다.',
    },
    {
      id: 'SAMPLE-FINDING-002',
      kind: 'hotspot',
      defect_type: 'cell_hotspot',
      severity: 'review',
      location_label: 'A동 · 4열 1번',
      relative_heat_score: null,
      temperature_max_c: null,
      temperature_delta_c: null,
      measurement_source: '가상 소견. 색상을 섭씨 온도로 환산하지 않습니다.',
      expert_note:
        '현장 계측과 전기 점검으로 원인을 확인합니다. 단일 셀의 고온 의심 지점이라는 예시이며, 고장 확정이나 모듈 교체 지시가 아닙니다.',
    },
  ],
  maintenance: [
    {
      title:
        '1. 청소·전기 점검의 금액, 일정, 보증 조건을 비교합니다. 샘플 수리비는 550,000원이며 실제 견적이 아닙니다.',
      status: 'sample',
    },
    {
      title:
        '2. 작업 전후 사진과 점검 결과를 남기고, 발전량 변화와 이상 지점의 재발 여부를 확인합니다.',
      status: 'sample',
    },
  ],
  files: [],
};
export const guestReportFile = new URL(
  '../public/samples/solar-diagnosis-sample.pdf',
  import.meta.url,
);
export async function createGuestReportPdf() {
  const content = guestReportContent;
  const snapshot = {
    content,
    sha256: await sha256(new TextEncoder().encode(JSON.stringify(content))),
  };
  return renderReportPdf(
    { id: 'SAMPLE-REPORT-001', version: 1, created_at: '2026-09-04T00:00:00Z' },
    snapshot,
    readFileSync(
      new URL('../public/fonts/NanumGothic-Regular.ttf', import.meta.url),
    ),
    undefined,
    { sample: true },
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const bytes = await createGuestReportPdf();
  mkdirSync(new URL('../public/samples/', import.meta.url), {
    recursive: true,
  });
  writeFileSync(guestReportFile, bytes);
  console.log(`Generated synthetic guest PDF (${bytes.length} bytes).`);
}
