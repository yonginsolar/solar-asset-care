// Local synthetic PDF for visual QA; no network, Auth or production assets.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { testJpeg } from '../tests/fixtures/report-image.mjs';
if (process.env.SOLAR_REPORT_VISUAL_QA !== '1')
  throw new Error('Explicit visual QA opt-in required');
const compile = (p) =>
  ts.transpileModule(readFileSync(new URL(p, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const visuals = url(compile('../lib/report-visuals.ts'));
const source = compile('../lib/report-pdf.ts')
  .replace(
    /from ['"].\/payback-format['"]/g,
    `from '${url(compile('../lib/payback-format.ts'))}'`,
  )
  .replace(/from ['"]pdf-lib['"]/g, `from '${import.meta.resolve('pdf-lib')}'`)
  .replace(
    /from ['"]@pdf-lib\/fontkit['"]/g,
    `from '${import.meta.resolve('@pdf-lib/fontkit')}'`,
  )
  .replace(
    /from ['"].\/finding-labels['"]/g,
    `from '${url(compile('../lib/finding-labels.ts'))}'`,
  )
  .replace(/from ['"].\/report-visuals['"]/g, `from '${visuals}'`);
const { renderReportPdf } = await import(url(source));
const { cleanReportJpeg } = await import(visuals);
const jpg = cleanReportJpeg(testJpeg);
const content = {
  schemaVersion: 2,
  diagnosisMode: 'photo-only',
  title: '사진 진단 보고서 · 가상 출력 점검',
  organization: { name: '가상 시험 운영자' },
  plant: {
    name: '가상 발전소',
    address: null,
    capacity_kw: null,
    commissioned_on: null,
  },
  inspection: {
    inspection_code: 'QA-PHOTO',
    purpose: '사진 기반 상대 이상 후보 확인',
    notes: '현장 촬영조건과 경제성 자료는 아직 제출되지 않았습니다.',
  },
  assessment: null,
  settings: null,
  findings: [
    {
      source_file_id: 'test',
      kind: 'hotspot',
      severity: 'review',
      disposition: 'accepted',
      location_label: 'A열 모듈',
      relative_heat_score: 82,
      temperature_max_c: null,
      temperature_delta_c: null,
      expert_note:
        '상대 색상 차이가 보여 현장 확인을 권고합니다. 실제 고장을 확정하지 않습니다.',
      region: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    },
  ],
  files: [
    { id: 'test', original_name: '가상 열화상.jpg', sha256: 'a'.repeat(64) },
  ],
  maintenance: [],
  reportImages: [
    {
      id: 'photo',
      source_file_id: 'test',
      caption: '가상 시험 사진 · 보고서 위치 표시 확인',
      sha256: createHash('sha256').update(jpg.bytes).digest('hex'),
      width: jpg.width,
      height: jpg.height,
    },
  ],
};
const output = new URL('../work/progressive/photo-only.pdf', import.meta.url);
mkdirSync(new URL('../work/progressive/', import.meta.url), {
  recursive: true,
});
writeFileSync(
  output,
  await renderReportPdf(
    { id: 'visual-qa', version: 1, created_at: '2026-10-16T00:00:00Z' },
    { content, sha256: 'a'.repeat(64) },
    readFileSync(
      new URL('../public/fonts/NanumGothic-Regular.ttf', import.meta.url),
    ),
    async () => jpg.bytes,
  ),
);
console.log(output.pathname);
