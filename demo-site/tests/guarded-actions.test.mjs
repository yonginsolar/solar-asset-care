import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
async function source(path) {
  const js = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
}
const { analyzePixels, analysisResult } = await source(
  '../lib/relative-analysis.ts',
);
const { verifyOriginal } = await source('../lib/original-integrity.ts');
const answer = {
  mode: 'relative-rule-analysis',
  disclaimer: '상대 후보 · 전문가 검토 필요',
  analyzedAt: '2026-10-17T00:00:00Z',
  quality: 'uniform',
  summary: { heatIndex: 50, contrast: 0, hotCandidates: 0, coldCandidates: 0 },
  regions: [],
};
const pixels = { width: 8, height: 8, values: Array(64).fill(50) };
function fixture({
  complete = { data: { id: 'run' }, error: null },
  current = { data: { status: 'running' }, error: null },
  failed = { data: { id: 'run' }, error: null },
  start = { data: { id: 'run' }, error: null },
} = {}) {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return {
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          return Promise.resolve(
            name === 'start_relative_analysis'
              ? start
              : name === 'complete_relative_analysis'
                ? complete
                : failed,
          );
        },
      };
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        abortSignal() {
          return this;
        },
        maybeSingle() {
          calls.push({ name: 'read_status' });
          return Promise.resolve(current);
        },
      };
    },
  };
  return { client, calls };
}
test('analysis response checks reject malformed/bounded/inconsistent candidates', () => {
  assert.equal(analysisResult(answer).quality, 'uniform');
  for (const bad of [
    null,
    {},
    { ...answer, summary: { ...answer.summary, hotCandidates: 1 } },
    { ...answer, quality: 'success' },
    {
      ...answer,
      regions: [
        {
          kind: 'hot',
          x: 2,
          y: 0,
          width: 1,
          height: 1,
          score: 90,
          areaPercent: 5,
        },
      ],
    },
  ])
    assert.throws(() => analysisResult(bad));
});
test('original checksum permits exact bytes and rejects same-size replacement, missing identity and size change', async () => {
  const blob = new Blob(['abcd']);
  const hash = Buffer.from(
    await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
  ).toString('hex');
  await verifyOriginal(blob, { bytes: 4, sha256: hash });
  await assert.rejects(
    verifyOriginal(new Blob(['abce']), { bytes: 4, sha256: hash }),
    /확인값/,
  );
  await assert.rejects(
    verifyOriginal(blob, { bytes: 5, sha256: hash }),
    /크기/,
  );
  await assert.rejects(
    verifyOriginal(blob, { bytes: 4, sha256: null }),
    /확인 정보/,
  );
});
test('analysis success finalizes once and never records a spurious failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(answer));
  const f = fixture();
  assert.deepEqual(await analyzePixels(f.client, 'file', pixels, 'synthetic'), {
    count: 0,
    uniform: true,
  });
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['start_relative_analysis', 'complete_relative_analysis'],
  );
});
test('lost completion response is reconciled by read without completing or failing twice', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(answer));
  const f = fixture({
    complete: { data: null, error: { message: 'Network lost' } },
    current: { data: { status: 'succeeded' }, error: null },
  });
  assert.equal(
    (await analyzePixels(f.client, 'file', pixels, 'synthetic')).uniform,
    true,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['start_relative_analysis', 'complete_relative_analysis', 'read_status'],
  );
});
test('unknown completion/read outcome remains recoverable, never silently retried/failed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(answer));
  const f = fixture({
    complete: { data: null, error: { message: 'Network lost' } },
    current: { data: null, error: { message: 'offline' } },
  });
  await assert.rejects(
    analyzePixels(f.client, 'file', pixels, 'synthetic'),
    /저장 여부/,
  );
  assert.equal(
    f.calls.filter((c) => c.name === 'complete_relative_analysis').length,
    1,
  );
  assert.equal(
    f.calls.filter((c) => c.name === 'fail_relative_analysis').length,
    0,
  );
});
test('definitive DB rejection records one failure after reconciliation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(answer));
  const f = fixture({
    complete: { data: null, error: { code: 'P0001', message: '검토 중' } },
  });
  await assert.rejects(
    analyzePixels(f.client, 'file', pixels, 'synthetic'),
    /검토 중/,
  );
  assert.equal(
    f.calls.filter((c) => c.name === 'fail_relative_analysis').length,
    1,
  );
});
test('API/auth failure and invalid response cannot create successful empty analysis', async (t) => {
  for (const response of [
    () => Response.json({ error: '다시 로그인' }, { status: 401 }),
    () => Response.json(null),
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response());
    const f = fixture();
    await assert.rejects(analyzePixels(f.client, 'file', pixels, 'synthetic'));
    assert.deepEqual(
      f.calls.map((c) => c.name),
      ['start_relative_analysis', 'fail_relative_analysis'],
    );
    t.mock.restoreAll();
  }
});
test('user cancellation aborts API and retains original with an explicit failed run', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    controller.abort();
    throw controller.signal.reason;
  });
  const f = fixture();
  await assert.rejects(
    analyzePixels(f.client, 'file', pixels, 'synthetic', controller.signal),
    /중단했습니다.*원본은 보존/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['start_relative_analysis', 'fail_relative_analysis'],
  );
});
test('unconfirmed failure record is not presented as saved', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error('offline');
  });
  const f = fixture({ failed: { data: null, error: { message: 'offline' } } });
  await assert.rejects(
    analyzePixels(f.client, 'file', pixels, 'synthetic'),
    /실패 기록을 확인하지/,
  );
});
test('duplicate start rejection never calls API or finalization', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('must not request image API');
  });
  const f = fixture({
    start: { data: null, error: { message: '이미 분석 중' } },
  });
  await assert.rejects(
    analyzePixels(f.client, 'file', pixels, 'synthetic'),
    /이미 분석 중/,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    ['start_relative_analysis'],
  );
});
