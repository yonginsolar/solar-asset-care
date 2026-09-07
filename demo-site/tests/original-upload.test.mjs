import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts
  .transpileModule(
    readFileSync(new URL('../lib/original-upload.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replace(
    /from ['"]tus-js-client['"]/g,
    `from '${import.meta.resolve('tus-js-client')}'`,
  );
export const uploader = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const {
  originalPath,
  uploadEndpoint,
  resumeFingerprint,
  trustedUploadUrl,
  originalImageType,
  fileChecksum,
  ORIGINAL_CHUNK_BYTES,
  MAX_ORIGINAL_BYTES,
} = uploader;
test('resumable identity separates account, project, inspection, kind and content', () => {
  const org = '11111111-1111-4111-8111-111111111111',
    inspection = '22222222-2222-4222-8222-222222222222';
  const path = originalPath(
    org,
    inspection,
    'thermal_original',
    'a'.repeat(64),
    'png',
  );
  assert.equal(
    path,
    originalPath(org, inspection, 'thermal_original', 'a'.repeat(64), 'png'),
  );
  assert.notEqual(
    path,
    originalPath(org, inspection, 'visible_original', 'a'.repeat(64), 'png'),
  );
  const endpoint = uploadEndpoint('https://example.supabase.co');
  assert.equal(
    endpoint,
    'https://example.storage.supabase.co/storage/v1/upload/resumable',
  );
  assert.notEqual(
    resumeFingerprint('one', endpoint, path, 'a'),
    resumeFingerprint('two', endpoint, path, 'a'),
  );
  assert.throws(() =>
    originalPath(
      org,
      '../elsewhere',
      'thermal_original',
      'a'.repeat(64),
      'png',
    ),
  );
  assert.equal(ORIGINAL_CHUNK_BYTES, 6 * 1024 * 1024);
});
test('a forged resume URL cannot receive an access token', () => {
  const endpoint = uploadEndpoint('https://example.supabase.co');
  assert.ok(trustedUploadUrl(`${endpoint}/fixture`, endpoint));
  for (const bad of [
    'https://evil.invalid/steal',
    'https://example.storage.supabase.co/storage/v1/upload/resumable-evil',
    'https://user:pass@example.storage.supabase.co/storage/v1/upload/resumable/file',
    'http://example.storage.supabase.co/storage/v1/upload/resumable/file',
    null,
  ])
    assert.equal(trustedUploadUrl(bad, endpoint), false);
});
test('upload validation checks the actual signature, not the filename; content hash is stable', async () => {
  const png = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    'wrong.txt',
  );
  assert.equal((await originalImageType(png)).mimeType, 'image/png');
  assert.equal(
    await fileChecksum(png),
    await fileChecksum(new File([png], 'different-name.png')),
  );
  await assert.rejects(() =>
    originalImageType(new File(['<script>bad</script>'], 'safe.png')),
  );
  await assert.rejects(() =>
    originalImageType(
      new File([new Uint8Array([73, 73, 42, 1, 0, 0, 0, 0])], 'bad.tiff'),
    ),
  );
});
test('50MB is accepted and one byte over the limit is rejected without allocating a large fixture', async () => {
  const signature = new Blob([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ]);
  const atLimit = {
    size: MAX_ORIGINAL_BYTES,
    slice() {
      return signature;
    },
  };
  const overLimit = { ...atLimit, size: MAX_ORIGINAL_BYTES + 1 };
  assert.equal((await originalImageType(atLimit)).mimeType, 'image/png');
  await assert.rejects(() => originalImageType(overLimit), /50MB 이하/);
});
