type Region = {
  id: string;
  kind: 'hot' | 'cold';
  x: number;
  y: number;
  width: number;
  height: number;
  areaPercent: number;
  score: number;
};

type AnalyzePayload = {
  width?: number;
  height?: number;
  values?: number[];
  sensitivity?: number;
};

const MAX_PIXELS = 96_000;

function percentile(sorted: number[], quantile: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * quantile)),
  );
  return sorted[index];
}

function collectRegions(
  values: number[],
  width: number,
  height: number,
  threshold: number,
  kind: 'hot' | 'cold',
  median: number,
) {
  const visited = new Uint8Array(values.length);
  const minimumArea = Math.max(4, Math.floor(values.length * 0.0015));
  const regions: Region[] = [];
  const matches = (value: number) =>
    // Quantile ties describe the background, not an anomaly. Strictly compare
    // with the median so a flat image cannot be both a whole-image hot/cold spot.
    // Do not gate on p95-p05: sparse, real candidates may occupy less than 5%.
    kind === 'hot'
      ? value >= threshold && value > median
      : value <= threshold && value < median;

  for (let start = 0; start < values.length; start += 1) {
    if (visited[start] || !matches(values[start])) continue;

    const stack = [start];
    visited[start] = 1;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sum = 0;
    let extreme = kind === 'hot' ? 0 : 1;

    while (stack.length) {
      const index = stack.pop()!;
      const x = index % width;
      const y = Math.floor(index / width);
      const value = values[index];
      count += 1;
      sum += value;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      extreme =
        kind === 'hot' ? Math.max(extreme, value) : Math.min(extreme, value);

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= values.length || visited[neighbor])
          continue;
        const neighborX = neighbor % width;
        if (Math.abs(neighborX - x) > 1) continue;
        if (!matches(values[neighbor])) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }

    if (count < minimumArea) continue;
    const average = sum / count;
    const score =
      kind === 'hot'
        ? Math.round((average * 0.65 + extreme * 0.35) * 100)
        : Math.round(((1 - average) * 0.65 + (1 - extreme) * 0.35) * 100);

    regions.push({
      id: `${kind}-${regions.length + 1}`,
      kind,
      x: minX / width,
      y: minY / height,
      width: Math.max(1, maxX - minX + 1) / width,
      height: Math.max(1, maxY - minY + 1) / height,
      areaPercent: Number(((count / values.length) * 100).toFixed(2)),
      score,
    });
  }

  return regions.sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function POST(request: Request) {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';

  if (!projectUrl || !publishableKey) {
    return Response.json(
      { error: '분석 서비스 연결 설정이 없습니다.' },
      { status: 503 },
    );
  }
  if (!accessToken) {
    return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const supabase = createClient(projectUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json(
      { error: '로그인 정보가 만료됐습니다. 다시 로그인해 주세요.' },
      { status: 401 },
    );
  }

  let payload: AnalyzePayload;
  try {
    payload = (await request.json()) as AnalyzePayload;
  } catch {
    return Response.json(
      { error: '요청 데이터를 읽을 수 없습니다.' },
      { status: 400 },
    );
  }

  const width = payload?.width ?? 0;
  const height = payload?.height ?? 0;
  const values = payload?.values;
  const requestedSensitivity = payload?.sensitivity ?? 72;
  const sensitivity = Math.min(100, Math.max(1, requestedSensitivity));

  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    typeof requestedSensitivity !== 'number' ||
    !Number.isFinite(requestedSensitivity) ||
    !Array.isArray(values) ||
    values.length !== width * height
  ) {
    return Response.json(
      { error: '픽셀 배열의 크기가 올바르지 않습니다.' },
      { status: 400 },
    );
  }
  if (values.length > MAX_PIXELS) {
    return Response.json(
      { error: '분석용 이미지는 96,000픽셀 이하로 축소해야 합니다.' },
      { status: 413 },
    );
  }
  if (
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  ) {
    return Response.json(
      { error: '픽셀 값은 0과 1 사이여야 합니다.' },
      { status: 400 },
    );
  }

  const sorted = [...values].sort((a, b) => a - b);
  const spread = percentile(sorted, 0.95) - percentile(sorted, 0.05);
  const median = percentile(sorted, 0.5);
  const hotQuantile = 0.82 + (sensitivity / 100) * 0.13;
  const coldQuantile = 1 - hotQuantile;
  const hotThreshold = percentile(sorted, hotQuantile);
  const coldThreshold = percentile(sorted, coldQuantile);
  const hotRegions = collectRegions(
    values,
    width,
    height,
    hotThreshold,
    'hot',
    median,
  );
  const coldRegions = collectRegions(
    values,
    width,
    height,
    coldThreshold,
    'cold',
    median,
  );

  return Response.json({
    mode: 'relative-rule-analysis',
    disclaimer:
      '색상 분포를 이용한 상대 비교이며 실제 섭씨 온도나 고장 확정값이 아닙니다.',
    width,
    height,
    sensitivity,
    thresholds: {
      hot: Number((hotThreshold * 100).toFixed(1)),
      cold: Number((coldThreshold * 100).toFixed(1)),
    },
    summary: {
      heatIndex: Math.round(percentile(sorted, 0.95) * 100),
      contrast: Math.round(spread * 100),
      hotCandidates: hotRegions.length,
      coldCandidates: coldRegions.length,
    },
    quality: sorted[0] === sorted[sorted.length - 1] ? 'uniform' : 'relative',
    regions: [...hotRegions, ...coldRegions],
    analyzedAt: new Date().toISOString(),
  });
}
import { createClient } from '@supabase/supabase-js';
