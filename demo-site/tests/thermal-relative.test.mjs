import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Run the actual route. Authentication is stubbed only here: no network or keys.
const source = readFileSync(
  new URL('../app/api/thermal/analyze/route.ts', import.meta.url),
  'utf8',
);
const authImport = "import { createClient } from '@supabase/supabase-js';";
assert.ok(source.includes(authImport));
const js = ts.transpileModule(
  source.replace(
    authImport,
    "const createClient = () => ({auth:{getUser: async(token) => token==='valid-test' ? {data:{user:{id:'test'}},error:null} : {data:{user:null},error:{message:'invalid'}}}});",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const scope = vm.createContext({
  exports: {},
  Request,
  Response,
  Uint8Array,
  process: {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
});
vm.runInContext(js, scope);
async function analyze(body, token = 'valid-test') {
  const response = await scope.exports.POST(
    new Request('https://example.invalid/api/thermal/analyze', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}
test('uniform black, gray and white images create no contradictory candidates and are not called normal', async () => {
  for (const v of [0, 0.5, 1]) {
    const { status, body } = await analyze({
      width: 8,
      height: 8,
      values: Array(64).fill(v),
    });
    assert.equal(status, 200);
    assert.equal(body.quality, 'uniform');
    assert.equal(body.summary.contrast, 0);
    assert.equal(body.summary.hotCandidates, 0);
    assert.equal(body.summary.coldCandidates, 0);
    assert.deepEqual(body.regions, []);
    assert.match(body.disclaimer, /확정값이 아닙니다/);
  }
});
test('sparse high/low relative spots remain detectable even when p95-p05 is zero', async () => {
  for (const [value, kind] of [
    [0.95, 'hot'],
    [0.05, 'cold'],
  ]) {
    const values = Array(1600).fill(0.5);
    for (const i of [410, 411, 450, 451]) values[i] = value;
    const { status, body } = await analyze({ width: 40, height: 40, values });
    assert.equal(status, 200);
    assert.equal(body.summary.contrast, 0);
    assert.equal(body.quality, 'relative');
    assert.equal(body.regions.length, 1);
    assert.equal(body.regions[0].kind, kind);
    assert.equal(body.regions[0].areaPercent, 0.25);
  }
});
test('hot and cold candidates are disjoint around the median and remain bounded', async () => {
  const values = Array(400).fill(0.5);
  for (const i of [42, 43, 62, 63]) values[i] = 1;
  for (const i of [330, 331, 350, 351]) values[i] = 0;
  const { body } = await analyze({
    width: 20,
    height: 20,
    values,
    sensitivity: 72,
  });
  assert.equal(body.regions.length, 2);
  assert.deepEqual(body.regions.map((r) => r.kind).sort(), ['cold', 'hot']);
  for (const r of body.regions) {
    assert.ok(
      r.width > 0 && r.height > 0 && r.x + r.width <= 1 && r.y + r.height <= 1,
    );
    assert.ok(r.areaPercent < 100);
  }
});
test('invalid dimensions, sensitivity and values fail before candidate computation; authentication stays required', async () => {
  for (const body of [
    null,
    {},
    { width: -2, height: -2, values: [0, 0, 0, 0] },
    { width: 1.5, height: 2, values: [0, 0] },
    { width: 2, height: 2, values: [0, 0, 0, 0], sensitivity: 'invalid' },
    { width: 2, height: 2, values: [-1, 0, 0, 0] },
  ])
    assert.equal((await analyze(body)).status, 400);
  assert.equal(
    (
      await analyze({
        width: 400,
        height: 300,
        values: Array(120000).fill(0.5),
      })
    ).status,
    413,
  );
  assert.equal((await analyze({}, '')).status, 401);
  assert.equal((await analyze({}, 'invalid')).status, 401);
});
