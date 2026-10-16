import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(
  readFileSync(
    new URL('../lib/original-integrity.ts', import.meta.url),
    'utf8',
  ) +
    '\n' +
    readFileSync(
      new URL('../lib/inspection-preview.ts', import.meta.url),
      'utf8',
    ).replace("import { verifyOriginal } from './original-integrity';", ''),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { previewDimensions, inspectionPreviewPath } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
test('screen previews preserve aspect ratio, never enlarge a small source, and bound decoded dimensions', () => {
  assert.deepEqual(previewDimensions(4032, 3024), { width: 960, height: 720 });
  assert.deepEqual(previewDimensions(3024, 4032), { width: 720, height: 960 });
  assert.deepEqual(previewDimensions(640, 512), { width: 640, height: 512 });
  for (const args of [
    [0, 3],
    [3, 0],
    [NaN, 3],
    [1.5, 3],
    [8000, 8000],
  ])
    assert.throws(() => previewDimensions(...args));
});
test('previews live under the exact source organization and inspection and change with original checksum', () => {
  const file = {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    inspection_id: '33333333-3333-4333-8333-333333333333',
    sha256: 'a'.repeat(64),
  };
  const path = inspectionPreviewPath(file);
  assert.equal(
    path,
    `${file.organization_id}/${file.inspection_id}/${file.id}-${file.sha256}.jpg`,
  );
  assert.notEqual(
    path,
    inspectionPreviewPath({ ...file, sha256: 'b'.repeat(64) }),
  );
  for (const patch of [
    { sha256: null },
    { id: '../../other' },
    { organization_id: 'other' },
    { inspection_id: '../other' },
  ])
    assert.throws(() => inspectionPreviewPath({ ...file, ...patch }));
});
