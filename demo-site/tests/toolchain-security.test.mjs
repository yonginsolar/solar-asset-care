import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url)),
);
const lock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url)),
);

function atLeast(actual, minimum) {
  assert.match(
    actual,
    /^\d+\.\d+\.\d+$/,
    'Security floor requires a stable release',
  );
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

test('direct dependency versions are exact and agree with the reproducible lockfile', () => {
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[''][group], manifest[group]);
    for (const [name, version] of Object.entries(manifest[group])) {
      assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/, name);
      assert.equal(
        lock.packages[`node_modules/${name}`].version,
        version,
        name,
      );
    }
  }
});

test('all copies of repaired toolchain dependencies meet the reviewed security floors', () => {
  const floors = {
    tinypool: '2.1.2',
    'proxy-addr': '2.0.8',
    sharp: '0.35.5',
    undici: '7.29.1',
    '@modelcontextprotocol/sdk': '1.31.0',
    'brace-expansion': '5.0.12',
    'fast-uri': '3.1.8',
    hono: '4.13.7',
    'ip-address': '10.7.1',
    'postcss-selector-parser': '7.1.6',
    'source-map-js': '1.2.2',
  };
  for (const [name, minimum] of Object.entries(floors)) {
    const copies = Object.entries(lock.packages).filter(([path]) =>
      path.endsWith(`node_modules/${name}`),
    );
    assert.ok(copies.length, `${name} must remain covered`);
    for (const [path, entry] of copies) {
      assert.ok(
        atLeast(entry.version, minimum),
        `${path}@${entry.version} is below ${minimum}`,
      );
    }
  }
});

test('security update retains the existing application and authentication framework', () => {
  assert.equal(manifest.dependencies.vinext, '1.0.0-beta.8');
  assert.equal(manifest.dependencies.react, '19.2.8');
  assert.equal(manifest.dependencies['react-dom'], '19.2.8');
  assert.equal(manifest.dependencies['react-server-dom-webpack'], '19.2.8');
  assert.equal(manifest.dependencies['@supabase/supabase-js'], '2.113.0');
});
