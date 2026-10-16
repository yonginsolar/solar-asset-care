import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './supabase/database.types';
type Result = {
  mode: string;
  disclaimer: string;
  analyzedAt: string;
  quality: 'uniform' | 'relative';
  summary: {
    heatIndex: number;
    contrast: number;
    hotCandidates: number;
    coldCandidates: number;
  };
  regions: Array<{
    kind: 'hot' | 'cold';
    x: number;
    y: number;
    width: number;
    height: number;
    areaPercent: number;
    score: number;
  }>;
};
export function analysisResult(value: unknown): Result {
  const a = value as Result;
  if (
    !a ||
    a.mode !== 'relative-rule-analysis' ||
    !['uniform', 'relative'].includes(a.quality) ||
    typeof a.disclaimer !== 'string' ||
    !Number.isFinite(Date.parse(a.analyzedAt)) ||
    !a.summary ||
    !Array.isArray(a.regions) ||
    a.regions.length > 10 ||
    ![
      a.summary.heatIndex,
      a.summary.contrast,
      a.summary.hotCandidates,
      a.summary.coldCandidates,
    ].every((n) => Number.isFinite(n) && n >= 0 && n <= 100) ||
    !a.regions.every(
      (r) =>
        r &&
        ['hot', 'cold'].includes(r.kind) &&
        [r.x, r.y, r.width, r.height, r.areaPercent, r.score].every(
          Number.isFinite,
        ) &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.width > 0 &&
        r.height > 0 &&
        r.x + r.width <= 1.000001 &&
        r.y + r.height <= 1.000001 &&
        r.areaPercent > 0 &&
        r.areaPercent <= 100 &&
        r.score >= 0 &&
        r.score <= 100,
    ) ||
    a.summary.hotCandidates !==
      a.regions.filter((r) => r.kind === 'hot').length ||
    a.summary.coldCandidates !==
      a.regions.filter((r) => r.kind === 'cold').length
  )
    throw new Error(
      '분석 응답의 형식을 확인하지 못했습니다. 저장된 원본에서 다시 분석해 주세요.',
    );
  return a;
}
function detail(e: unknown) {
  return e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : '상대 분석에 실패했습니다.';
}
/** No automatic business-write retry. Unknown finalization remains inspectable. */
export async function analyzePixels(
  client: SupabaseClient<Database>,
  fileId: string,
  pixels: { width: number; height: number; values: number[] },
  token: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const started = await client
    .rpc('start_relative_analysis', {
      p_inspection_file_id: fileId,
      p_normalized_pixels: pixels.width * pixels.height,
    })
    .abortSignal(AbortSignal.timeout(20000));
  if (started.error || !started.data)
    throw new Error(
      started.error?.message ||
        '분석 시작 결과를 확인하지 못했습니다. 실행 상태를 다시 불러와 주세요.',
    );
  const run = started.data;
  let computed: Result | null = null,
    finalizing = false;
  try {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetch('/api/thermal/analyze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...pixels, sensitivity: 72 }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        value &&
          typeof value === 'object' &&
          'error' in value &&
          typeof value.error === 'string'
          ? value.error
          : '상대 분석 응답을 확인하지 못했습니다.',
      );
    computed = analysisResult(value);
    signal?.throwIfAborted();
    finalizing = true;
    const result = await client
      .rpc('complete_relative_analysis', {
        p_analysis_run_id: run.id,
        p_result_summary: {
          ...computed.summary,
          disclaimer: computed.disclaimer,
          analyzed_at: computed.analyzedAt,
          quality: computed.quality,
        } as Json,
        p_regions: computed.regions.map((r) => ({
          kind: r.kind,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          area_percent: r.areaPercent,
          score: r.score,
        })) as Json,
      })
      .abortSignal(AbortSignal.timeout(20000));
    if (result.error || !result.data)
      throw result.error || new Error('분석 저장 응답이 없습니다.');
    return {
      count: computed.regions.length,
      uniform: computed.quality === 'uniform',
    };
  } catch (error) {
    if (finalizing) {
      let current: { data: { status: string } | null; error: unknown } = {
        data: null,
        error: true,
      };
      try {
        current = await client
          .from('analysis_runs')
          .select('status')
          .eq('id', run.id)
          .abortSignal(AbortSignal.timeout(10000))
          .maybeSingle();
      } catch {
        /* Unknown read is not permission to retry a write. */
      }
      if (!current.error && current.data?.status === 'succeeded' && computed)
        return {
          count: computed.regions.length,
          uniform: computed.quality === 'uniform',
        };
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      if (!/^(P0001|23\d{3})$/.test(code))
        throw new Error(
          '분석 결과 저장 여부를 확인하지 못했습니다. 실행 상태를 다시 불러와 확인해 주세요. 자동으로 다시 저장하지 않았습니다.',
        );
    }
    let recorded = false;
    try {
      const failed = await client
        .rpc('fail_relative_analysis', {
          p_analysis_run_id: run.id,
          p_message: detail(error).slice(0, 300),
        })
        .abortSignal(AbortSignal.timeout(10000));
      recorded = !failed.error && Boolean(failed.data);
    } catch {
      /* Explicit recovery is offered by the run list. */
    }
    if (!recorded)
      throw new Error(
        '분석 중단·실패 기록을 확인하지 못했습니다. 실행 상태를 다시 불러와 확인해 주세요.',
      );
    throw new Error(
      signal?.aborted
        ? '분석을 중단했습니다. 원본은 보존되어 있습니다.'
        : detail(error),
    );
  }
}
