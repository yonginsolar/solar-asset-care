import { PDFDocument, PageSizes, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { formatPaybackYears } from './payback-format';
import { defectLabels, kindLabels, severityLabels } from './finding-labels';
import {
  cleanReportJpeg,
  MAX_REPORT_IMAGES,
  reportBars,
  validRect,
  type ReportImage,
} from './report-visuals';
import type { Tables } from './supabase/database.types';
import type {
  AssessmentResult,
  CalculationInput,
  Capture,
  Settings,
} from './operational-assessment';

export const PDF_RENDERER_VERSION = 'reviewed-images-v2';
export const REPORT_FONT_SHA256 =
  '76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31';
type Content = {
  schemaVersion: number;
  diagnosisMode?: 'photo-only';
  title: string;
  plant: {
    name: string;
    address: string;
    capacity_kw: number | null;
    commissioned_on: string | null;
  };
  organization: { name: string };
  inspection: { inspection_code: string; purpose: string; notes: string };
  assessment: {
    capture: Capture;
    calculation_input: CalculationInput;
    result: AssessmentResult;
    warnings: string[];
    exception_reason: string | null;
  } | null;
  settings: {
    version: number;
    effective_from: string;
    values: Settings;
  } | null;
  findings: Tables<'findings'>[];
  maintenance: { title: string; status: string }[];
  files: { id: string; original_name: string; sha256: string }[];
  reportImages?: ReportImage[];
};
export async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}

/** No browser, external AI, filesystem or provider SDK needed to render a frozen report. */
export async function renderReportPdf(
  report: Pick<Tables<'reports'>, 'id' | 'version' | 'created_at'>,
  snapshot: Pick<Tables<'report_snapshots'>, 'content' | 'sha256'>,
  fontBytes: Uint8Array,
  loadImage?: (image: ReportImage) => Promise<Uint8Array>,
  options: { sample?: boolean } = {},
) {
  const c = snapshot.content as unknown as Content;
  const photoOnly =
    c.schemaVersion === 2 &&
    c.diagnosisMode === 'photo-only' &&
    c.assessment === null &&
    c.settings === null;
  if (
    (!(c.schemaVersion === 1 && c.assessment && c.settings) && !photoOnly) ||
    !Array.isArray(c.findings) ||
    c.findings.length > 500
  )
    throw new Error('보고서 형식 또는 소견 개수를 확인해 주세요.');
  if (
    c.reportImages &&
    (!Array.isArray(c.reportImages) ||
      c.reportImages.length > MAX_REPORT_IMAGES)
  )
    throw new Error('보고서 사진은 12장까지 포함할 수 있습니다.');
  if ((await sha256(fontBytes)) !== REPORT_FONT_SHA256)
    throw new Error('PDF 글꼴의 무결성 확인에 실패했습니다.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // A static TrueType font avoids the CFF subsetting incompatibility of some OTFs.
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const charset = new Set(font.getCharacterSet());
  pdf.setTitle(c.title);
  pdf.setAuthor(c.organization.name);
  pdf.setSubject(
    `${options.sample ? '가상 자료 · 샘플 보고서 · 실제 진단 아님 / ' : ''}보고서 ${report.version}차 · 검토본 ${snapshot.sha256}`,
  );
  pdf.setCreator(PDF_RENDERER_VERSION);
  pdf.setProducer('Solar Asset Care');
  pdf.setLanguage('ko-KR');
  pdf.setCreationDate(new Date(report.created_at));
  pdf.setModificationDate(new Date(report.created_at));
  const [width, height] = PageSizes.A4;
  const margin = 44;
  const maxWidth = width - margin * 2;
  let page!: PDFPage;
  let y = 0;
  function newPage() {
    if (pdf.getPageCount() >= 120)
      throw new Error(
        '보고서가 120쪽을 초과합니다. 소견과 메모를 나눠 작성해 주세요.',
      );
    page = pdf.addPage(PageSizes.A4);
    y = height - 48;
    page.drawText(
      options.sample
        ? 'SOLAR ASSET CARE · 샘플 / 실제 진단 아님'
        : 'SOLAR ASSET CARE',
      {
        x: margin,
        y,
        size: 11,
        font,
        color: rgb(0.06, 0.42, 0.39),
      },
    );
    page.drawLine({
      start: { x: margin, y: y - 12 },
      end: { x: width - margin, y: y - 12 },
      thickness: 1,
      color: rgb(0.06, 0.42, 0.39),
    });
    y -= 42;
  }
  function ensure(space: number) {
    if (y - space < 62) newPage();
  }
  function paragraph(value: string, size = 11, color = rgb(0.12, 0.16, 0.21)) {
    if (value.length > 50000)
      throw new Error('보고서의 한 항목이 너무 깁니다.');
    const safe = Array.from(value.replaceAll('℃', '°C'))
      .map((ch) =>
        ch === '\n'
          ? '\n'
          : (ch.codePointAt(0) ?? 0) < 32
            ? ' '
            : charset.has(ch.codePointAt(0)!)
              ? ch
              : '[미지원 문자]',
      )
      .join('');
    for (const block of safe.split('\n')) {
      let line = '';
      for (const ch of block) {
        if (font.widthOfTextAtSize(line + ch, size) > maxWidth && line) {
          ensure(size * 1.65);
          page.drawText(line, { x: margin, y, font, size, color });
          y -= size * 1.65;
          line = '';
        }
        line += ch;
      }
      ensure(size * 1.65);
      if (line) page.drawText(line, { x: margin, y, font, size, color });
      y -= size * 1.65;
    }
    y -= 5;
  }
  function heading(title: string) {
    ensure(58);
    y -= 8;
    paragraph(title, 14, rgb(0.06, 0.42, 0.39));
  }
  const fmt = (n: number, unit = '') =>
    `${n.toLocaleString('ko-KR', { maximumFractionDigits: unit.includes('원') ? 0 : 1 })}${unit}`;
  newPage();
  paragraph(c.title, 21);
  paragraph(
    `${c.inspection.inspection_code} · 보고서 ${report.version}차 · ${c.organization.name}`,
    11,
  );
  if (options.sample)
    paragraph(
      '둘러보기용 가상 자료입니다. 실제 현장 측정·전문가 승인·발행을 거친 보고서가 아닙니다. 고객 원본 사진과 개인정보는 포함하지 않습니다.',
    );
  heading('설비·점검 정보');
  paragraph(
    `발전소: ${c.plant.name}\n주소: ${c.plant.address || '미입력'}\n용량: ${c.plant.capacity_kw == null ? '미입력' : fmt(c.plant.capacity_kw, ' kW')} / 가동 시작일: ${c.plant.commissioned_on || '미입력'}`,
  );
  paragraph(
    `점검 목적: ${c.inspection.purpose || '미입력'}\n현장 메모: ${c.inspection.notes || '없음'}`,
  );
  if (c.assessment && c.settings) {
    const p = c.assessment.calculation_input;
    const r = c.assessment.result;
    const capture = c.assessment.capture;
    heading('촬영조건');
    const captured = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(capture.measuredAt));
    paragraph(
      `촬영·측정: ${captured} (한국시간)\n측정 출처: ${capture.source}\n면내 일사량: ${capture.irradiance} W/m² / 풍속: ${capture.wind} m/s / 외기온: ${capture.ambientTemperature} ℃\n촬영각도: ${capture.angle}° (패널면 기준) / 거리: ${capture.distance} m`,
    );
    paragraph(
      c.assessment.warnings.length
        ? `기준 이탈: ${c.assessment.warnings.join(', ')}\n관리자 예외 승인 사유: ${c.assessment.exception_reason || '미승인'}`
        : '입력된 촬영조건이 선택한 기준을 충족합니다.',
    );
    heading('발전량·개선 효과 추정');
    paragraph(
      `분석기간: ${p.periodStart} ~ ${p.periodEnd} (${r.periodDays}일, 양 끝 날짜 포함)\n실발전량 출처: ${p.generationSource}`,
    );
    paragraph(
      `기대발전량: ${fmt(r.expectedGenerationKwh, ' kWh')} / 실발전량: ${fmt(r.actualGenerationKwh, ' kWh')}\n기대발전량 대비 성능비: ${fmt(r.performanceRatio * 100, '%')} (${r.prStatus})\n추정 손실량: ${fmt(r.lossKwh, ' kWh')} / 추정 손실금액: ${fmt(r.lossAmount, '원')}\n기간 기대수익: ${fmt(r.expectedRevenue, '원')} / 기간 현재수익: ${fmt(r.currentRevenue, '원')}\n기간 회수가능액: ${fmt(r.recoverableAmount, '원')} / 연간 환산: ${fmt(r.annualRecoverableAmount, '원/년')}\n예상 수리비: ${fmt(p.repairCost, '원')} / 단순 투자회수기간: ${formatPaybackYears(r.paybackYears)}`,
    );
    ensure(220);
    heading('동일 분석기간의 수익 비교');
    for (const [index, bar] of reportBars(r).entries()) {
      paragraph(`${bar.label}: ${fmt(bar.value, '원')}`);
      page.drawRectangle({
        x: margin,
        y: y - 8,
        width: maxWidth,
        height: 12,
        color: rgb(0.93, 0.95, 0.96),
      });
      if (bar.ratio > 0)
        page.drawRectangle({
          x: margin,
          y: y - 8,
          width: maxWidth * bar.ratio,
          height: 12,
          color: index === 1 ? rgb(0.06, 0.42, 0.39) : rgb(0.39, 0.45, 0.52),
        });
      y -= 30;
    }
    paragraph(
      '개선 후 추정 = 현재 수익 + 기간 회수가능액. 실제 수익을 보장하지 않습니다.',
    );
  } else {
    heading('사진 진단 범위');
    paragraph(
      '사진의 상대 색상 분포와 전문가 소견을 검토한 보고서입니다. 촬영조건 측정 자료가 제출되지 않아 일사량·풍속 등 촬영 유효성은 확인하지 않았습니다. 실제 온도나 고장을 확정하는 진단은 아닙니다.',
    );
    paragraph(
      '경제성 분석은 실시하지 않았습니다. 발전량·수리비·가동일 등 필요한 자료를 추후 확인하면 별도 보고서 버전에서 분석할 수 있습니다.',
    );
  }
  heading('채택 소견·권고 조치');
  if (!c.findings.length) paragraph('채택된 이상 소견이 없습니다.');
  for (const [index, f] of c.findings.entries()) {
    ensure(80);
    paragraph(
      `${index + 1}. ${f.defect_type ? defectLabels[f.defect_type] : kindLabels[f.kind]} / ${severityLabels[f.severity]} / ${f.location_label || '위치 미입력'}`,
      12,
    );
    paragraph(
      `상대 점수: ${f.relative_heat_score ?? '없음'} / 최고 온도: ${f.temperature_max_c == null ? '미측정' : `${f.temperature_max_c} ℃`} / 온도차: ${f.temperature_delta_c == null ? '미측정' : `${f.temperature_delta_c} ℃`}`,
    );
    if (f.measurement_source)
      paragraph(`온도 측정 근거: ${f.measurement_source}`);
    if (f.source_file_id)
      paragraph(
        `근거 원본: ${c.files.find((file) => file.id === f.source_file_id)?.original_name || '보관 원본'}`,
      );
    paragraph(f.expert_note || '별도 메모 없음');
  }
  if (c.reportImages?.length) {
    newPage();
    heading('점검 사진·이상 위치');
    for (const photo of c.reportImages) {
      if (!loadImage) throw new Error('보고서 사진을 불러오지 못했습니다.');
      const jpeg = cleanReportJpeg(await loadImage(photo));
      if (
        (await sha256(jpeg.bytes)) !== photo.sha256 ||
        jpeg.width !== photo.width ||
        jpeg.height !== photo.height
      )
        throw new Error('보고서 사진의 무결성 확인에 실패했습니다.');
      const embedded = await pdf.embedJpg(jpeg.bytes);
      const scale = Math.min(maxWidth / photo.width, 330 / photo.height);
      const w = photo.width * scale,
        h = photo.height * scale;
      ensure(h + 110);
      paragraph(photo.caption, 12);
      const top = y,
        left = margin,
        bottom = top - h;
      page.drawImage(embedded, { x: left, y: bottom, width: w, height: h });
      const markers: number[] = [];
      c.findings.forEach((finding, index) => {
        if (
          finding.source_file_id !== photo.source_file_id ||
          !validRect(finding.region)
        )
          return;
        const box = finding.region;
        const x = left + box.x * w,
          boxTop = top - box.y * h;
        page.drawRectangle({
          x,
          y: boxTop - box.height * h,
          width: box.width * w,
          height: box.height * h,
          borderWidth: 1.5,
          borderColor: rgb(0.8, 0.1, 0.12),
        });
        const label = String(index + 1),
          labelWidth = font.widthOfTextAtSize(label, 11) + 6;
        const labelX = Math.min(x, left + w - labelWidth),
          labelY = Math.max(bottom, boxTop - 16);
        page.drawRectangle({
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: 16,
          color: rgb(0.7, 0.06, 0.08),
        });
        page.drawText(label, {
          x: labelX + 3,
          y: labelY + 3,
          font,
          size: 11,
          color: rgb(1, 1, 1),
        });
        markers.push(index + 1);
      });
      y = bottom - 22;
      if (markers.length) paragraph(`표시 영역: 소견 ${markers.join(', ')}번`);
      paragraph(`사진 확인값: ${photo.sha256}`);
    }
  }
  heading('후속 조치');
  for (const item of c.maintenance) paragraph(item.title);
  if (!c.maintenance.length)
    paragraph('검토본에 연결된 유지보수 요청이 없습니다.');
  if (options.sample) newPage();
  if (c.assessment && c.settings) {
    const r = c.assessment.result;
    const s = c.settings.values;
    heading('계산 기준·재현 정보');
    paragraph(
      `설정 ${c.settings.version}판 (${c.settings.effective_from}부터) / 계산식 ${r.engineVersion}\n일평균 발전시간 ${s.sunHours} h / 연간 열화율 ${s.degradationRatePercent}% / 방위·경사 보정 ${s.orientationFactor}\n자가소비 단가 ${s.selfUseTariff}원/kWh / SMP ${s.smp}원/kWh / REC ${s.rec}원/kWh / REC 가중치 ${s.recWeight}\n적용 단가 ${fmt(r.tariff, '원/kWh')} / 개선가능비율 ${fmt(r.improvementRate * 100, '%')}\n성능비 정상 하한 ${s.prNormal} / 주의 하한 ${s.prWarning}\n최소 일사량 ${s.irradianceMinimum} W/m² / 최대 풍속 ${s.windWarning} m/s\n촬영각도 범위 ${s.angleMinimum}~${s.angleMaximum}° / 최대 거리 ${s.distanceMaximum} m\n온도차 주의 ${s.deltaTWarning} ℃ / 긴급 ${s.deltaTCritical} ℃`,
    );
  }
  heading('자료의 한계');
  paragraph(
    '색상 분포 기반 후보는 실제 섭씨 온도 측정이나 고장 확정값이 아닙니다. 온도 입력값은 기록된 측정 근거에 따르며 현장 계측과 전문가 검토가 필요합니다.',
  );
  if (!photoOnly)
    paragraph(
      '수치와 금액은 입력 자료·설정에 따른 추정치입니다. 손실량은 0 미만으로 표시하지 않습니다. 회수기간은 해당 기간 회수가능액을 365일로 환산하며 계절 변화·금융비용·세금은 반영하지 않습니다.',
    );
  paragraph(
    options.sample
      ? '이 PDF는 실제 보고서와 같은 출력 양식에 가상 값을 넣은 샘플입니다. 진단 결과·수익·견적·발행 상태를 증명하지 않으며 실제 업무의 근거로 사용할 수 없습니다.'
      : '이 PDF는 승인된 검토 내용을 보관한 파일입니다. 보고서의 현재 발행·회수 상태와 후속 조치 진행 상황은 서비스에서 확인해 주세요.',
  );
  paragraph(`검토 내용 확인값 (SHA-256)\n${snapshot.sha256}`);
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: margin, y: 45 },
      end: { x: width - margin, y: 45 },
      thickness: 0.5,
      color: rgb(0.7, 0.75, 0.78),
    });
    p.drawText(`${index + 1} / ${pages.length}`, {
      x: width - margin - 50,
      y: 27,
      size: 11,
      font,
    });
    p.drawText(
      options.sample ? '샘플 보고서 · 가상 자료' : `보고서 ${report.version}차`,
      {
        x: margin,
        y: 27,
        size: 11,
        font,
      },
    );
  });
  return pdf.save();
}
