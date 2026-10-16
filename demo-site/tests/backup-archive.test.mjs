import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sealBackup, openBackup } from '../scripts/backup-archive.mjs';
test('backup encryption round-trips binary data without a reusable static key or nonce', () => {
  const key = randomBytes(32), data = randomBytes(8192);
  const a = sealBackup(data, key), b = sealBackup(data, key);
  assert.deepEqual(openBackup(a, key), data);
  assert.notDeepEqual(a, b);
  assert.equal(a.includes(data), false);
});
test('wrong key, truncated archive, changed header, tag and payload fail closed', () => {
  const key = randomBytes(32), sealed = sealBackup(Buffer.from('synthetic-only'), key);
  assert.throws(() => openBackup(sealed, randomBytes(32)));
  for (const n of [0, 5, sealed.length - 1]) assert.throws(() => openBackup(sealed.subarray(0, n), key));
  for (const n of [0, 16, 28, sealed.length - 1]) {
    const changed = Buffer.from(sealed); changed[n] ^= 1;
    assert.throws(() => openBackup(changed, key));
  }
});
