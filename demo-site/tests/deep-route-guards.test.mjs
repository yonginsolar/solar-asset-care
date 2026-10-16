// Actual server route functions; replace Auth and Storage only, never contact a service.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const bytes = new Uint8Array([255, 216, 255, 1, 2, 3, 4, 5]);
const checksum = Buffer.from(
  await webcrypto.subtle.digest('SHA-256', bytes),
).toString('hex');
function routes({ authThrows = false, stored = bytes } = {}) {
  const data = {
    id: '10000000-0000-4000-8000-000000000001',
    storage_bucket: 'inspection-originals',
    storage_path: 'local.jpg',
    original_name: 'local.jpg',
    mime_type: 'image/jpeg',
    bytes: bytes.length,
    sha256: checksum,
  };
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        async maybeSingle() {
          return { data, error: null };
        },
      };
    },
    storage: {
      from() {
        return {
          async download() {
            return { data: new Blob([stored]), error: null };
          },
        };
      },
    },
  };
  function load(path) {
    const js = ts.transpileModule(
      readFileSync(new URL('../' + path, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const context = vm.createContext({
      exports: {},
      require(name) {
        if (name === '@supabase/supabase-js')
          return {
            createClient: () => ({
              auth: {
                async getUser() {
                  if (authThrows) throw Error('transport rejected');
                  return { data: { user: { id: 'fixture' } }, error: null };
                },
              },
            }),
          };
        if (name === '@/lib/supabase/request-client')
          return {
            requestClient: async () => client,
            privateHeaders: { 'Cache-Control': 'private, no-store' },
          };
        const deps = {
          '@/lib/inspection-preview': 'lib/inspection-preview.ts',
          '@/lib/report-visuals': 'lib/report-visuals.ts',
          '@/lib/original-integrity': 'lib/original-integrity.ts',
          './original-integrity': 'lib/original-integrity.ts',
        };
        if (deps[name]) return load(deps[name]);
        throw Error('Unexpected dependency: ' + name);
      },
      Request,
      Response,
      Blob,
      FormData,
      Uint8Array,
      AbortSignal,
      crypto: webcrypto,
      URL,
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
        },
      },
    });
    vm.runInContext(js, context);
    return context.exports;
  }
  return { load, data };
}
test('analysis Auth transport rejection returns controlled 503 without an unhandled rejection', async () => {
  const { load } = routes({ authThrows: true });
  const result = await load('app/api/thermal/analyze/route.ts').POST(
    new Request('https://example.invalid/api/thermal/analyze', {
      method: 'POST',
      headers: { authorization: 'Bearer fixture' },
      body: JSON.stringify({ width: 1, height: 1, values: [0] }),
    }),
  );
  assert.equal(result.status, 503);
  assert.equal(typeof (await result.json()).error, 'string');
});
test('actual download route blocks same-size changed original and serves exact original privately', async () => {
  for (const [stored, expected] of [
    [bytes, 200],
    [new Uint8Array([255, 216, 255, 1, 2, 3, 4, 6]), 409],
  ]) {
    const { load, data } = routes({ stored });
    const result = await load('app/api/inspection-files/route.ts').GET(
      new Request(
        `https://example.invalid/api/inspection-files?id=${data.id}&original=1`,
      ),
    );
    assert.equal(result.status, expected);
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
    if (expected === 409)
      assert.equal((await result.json()).code, 'original_integrity_mismatch');
    else assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  }
});
test('actual algorithm stays bounded for 280 deterministic uniform/random image arrays', async () => {
  const { load } = routes();
  const route = load('app/api/thermal/analyze/route.ts');
  let seed = 123456;
  for (let i = 0; i < 280; i++) {
    const width = 3 + (i % 17),
      height = 3 + (i % 19);
    const values = Array.from({ length: width * height }, () =>
      i < 120
        ? (i % 11) / 10
        : (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32,
    );
    const r = await route.POST(
      new Request('https://example.invalid/api/thermal/analyze', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture' },
        body: JSON.stringify({
          width,
          height,
          values,
          sensitivity: (i % 100) + 1,
        }),
      }),
    );
    assert.equal(r.status, 200);
    const a = await r.json();
    assert.ok(a.regions.length <= 10);
    if (i < 120) {
      assert.equal(a.quality, 'uniform');
      assert.equal(a.regions.length, 0);
    }
    for (const x of a.regions) {
      assert.ok(x.score >= 0 && x.score <= 100 && Number.isFinite(x.score));
      assert.ok(
        x.x >= 0 &&
          x.y >= 0 &&
          x.x + x.width <= 1.000001 &&
          x.y + x.height <= 1.000001,
      );
    }
  }
});
