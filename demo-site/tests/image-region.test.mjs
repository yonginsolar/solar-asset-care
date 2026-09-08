import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = ts.transpileModule(
  readFileSync(new URL('../lib/image-region.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { regionFromPoints, validImageRegion } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

test('dragging in either direction creates the same normalized image region', () => {
  const forward = regionFromPoints({ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.7 });
  const reverse = regionFromPoints({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 });
  assert.deepEqual(reverse, forward);
  assert.ok(forward);
  assert.equal(forward.x, 0.2);
  assert.equal(forward.y, 0.1);
});

test('drag points are clamped to the image and taps do not create a region', () => {
  assert.deepEqual(regionFromPoints({ x: -1, y: -1 }, { x: 2, y: 2 }), {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.equal(regionFromPoints({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), null);
});

test('stored image regions must remain inside the original image', () => {
  assert.equal(validImageRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }), true);
  for (const value of [
    null,
    { x: -0.1, y: 0, width: 0.2, height: 0.2 },
    { x: 0.9, y: 0, width: 0.2, height: 0.2 },
    { x: 0, y: 0, width: 0, height: 0.2 },
    { x: 0, y: 0, width: Number.NaN, height: 0.2 },
  ])
    assert.equal(validImageRegion(value), false);
});
