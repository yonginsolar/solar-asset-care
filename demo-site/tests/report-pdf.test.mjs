import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { testJpeg } from './fixtures/report-image.mjs';
const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const dataUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
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
const { renderReportPdf } = await import(dataUrl(source));
const { cleanReportJpeg } = await import(visuals);
const font = readFileSync(
  new URL('../public/fonts/NanumGothic-Regular.ttf', import.meta.url),
);
const report = { id: 'test', version: 1, created_at: '2026-09-05T00:00:00Z' };
const snapshot = {
  sha256: 'a'.repeat(64),
  content: {
    schemaVersion: 1,
    title: '한글 보고서 시험',
    organization: { name: '시험 조직' },
    plant: {
      name: '시험 발전소',
      address: '가상 주소',
      capacity_kw: 100,
      commissioned_on: '2020-01-01',
    },
    inspection: { inspection_code: 'TEST', purpose: '시험', notes: '시험' },
    assessment: {
      capture: {
        measuredAt: '2026-09-05T00:00:00Z',
        source: '합성 자료',
        irradiance: 600,
        wind: 3,
        ambientTemperature: 25,
        angle: 45,
        distance: 20,
      },
      warnings: [],
      calculation_input: {
        periodStart: '2026-01-01',
        periodEnd: '2026-08-31',
        generationSource: '합성 계측',
        repairCost: 100,
      },
      result: {
        periodDays: 243,
        expectedGenerationKwh: 100,
        actualGenerationKwh: 80,
        performanceRatio: 0.8,
        prStatus: '주의',
        lossKwh: 20,
        lossAmount: 2000,
        expectedRevenue: 10000,
        currentRevenue: 8000,
        recoverableAmount: 1000,
        annualRecoverableAmount: 1500,
        paybackYears: 0.1,
        tariff: 100,
        improvementRate: 0.5,
        engineVersion: 'period-estimate-v1',
      },
    },
    settings: {
      version: 1,
      effective_from: '2020-01-01',
      values: {
        sunHours: 3.6,
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
      },
    },
    findings: [],
    maintenance: [],
    files: [],
  },
};
test('report PDF is deterministic, A4 and embeds a static TrueType Korean font', async () => {
  const one = await renderReportPdf(report, snapshot, font),
    two = await renderReportPdf(report, snapshot, font);
  assert.deepEqual(one, two);
  assert.ok(one.length < 250000);
  const pdf = await PDFDocument.load(one);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 1);
  }
  assert.ok(
    pdf.context
      .enumerateIndirectObjects()
      .some(
        ([, obj]) =>
          obj instanceof PDFDict &&
          obj.get(PDFName.of('Subtype'))?.toString() === '/CIDFontType2',
      ),
  );
});
test('unverified fonts and unsupported snapshots cannot be archived', async () => {
  await assert.rejects(
    () => renderReportPdf(report, snapshot, new Uint8Array([1, 2, 3])),
    /무결성/,
  );
  await assert.rejects(
    () =>
      renderReportPdf(
        report,
        { ...snapshot, content: { ...snapshot.content, schemaVersion: 2 } },
        font,
      ),
    /형식/,
  );
});
test('photo-only snapshot renders without financial data, dates or invented readings', async () => {
  const content = {
    ...snapshot.content,
    schemaVersion: 2,
    diagnosisMode: 'photo-only',
    assessment: null,
    settings: null,
    plant: {
      ...snapshot.content.plant,
      capacity_kw: null,
      commissioned_on: null,
    },
  };
  const frozen = { ...snapshot, content };
  const one = await renderReportPdf(report, frozen, font);
  assert.deepEqual(one, await renderReportPdf(report, frozen, font));
  const pdf = await PDFDocument.load(one);
  assert.ok(pdf.getPageCount() > 0);
  await assert.rejects(
    () =>
      renderReportPdf(
        report,
        { ...frozen, content: { ...content, diagnosisMode: undefined } },
        font,
      ),
    /형식/,
  );
  await assert.rejects(
    () =>
      renderReportPdf(
        report,
        { ...frozen, content: { ...content, schemaVersion: 1 } },
        font,
      ),
    /형식/,
  );
});
test('approved JPEG and finding regions are embedded deterministically; missing or changed bytes fail closed', async () => {
  const jpeg = cleanReportJpeg(testJpeg);
  const photo = {
    id: 'test-image',
    source_file_id: 'test-source',
    caption: '가림 처리 사진',
    width: jpeg.width,
    height: jpeg.height,
    sha256: createHash('sha256').update(jpeg.bytes).digest('hex'),
  };
  const frozen = {
    ...snapshot,
    content: {
      ...snapshot.content,
      reportImages: [photo],
      findings: [
        {
          id: 'finding',
          source_file_id: photo.source_file_id,
          kind: 'hotspot',
          severity: 'major',
          region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        },
      ],
    },
  };
  const bytes = await renderReportPdf(
    report,
    frozen,
    font,
    async () => jpeg.bytes,
  );
  assert.deepEqual(
    bytes,
    await renderReportPdf(report, frozen, font, async () => jpeg.bytes),
  );
  const pdf = await PDFDocument.load(bytes);
  assert.ok(
    pdf.context
      .enumerateIndirectObjects()
      .some(
        ([, obj]) =>
          obj.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image',
      ),
  );
  await assert.rejects(() => renderReportPdf(report, frozen, font), /사진/);
  await assert.rejects(
    () =>
      renderReportPdf(
        report,
        {
          ...frozen,
          content: {
            ...frozen.content,
            reportImages: [{ ...photo, sha256: '0'.repeat(64) }],
          },
        },
        font,
        async () => jpeg.bytes,
      ),
    /무결성/,
  );
  await assert.rejects(
    () =>
      renderReportPdf(
        report,
        {
          ...frozen,
          content: { ...frozen.content, reportImages: Array(13).fill(photo) },
        },
        font,
        async () => jpeg.bytes,
      ),
    /12장/,
  );
});
