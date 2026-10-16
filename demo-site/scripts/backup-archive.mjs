import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Authenticated encryption: corruption or the wrong key must never produce a restore.
// The drill keeps its throw-away key only in memory; this is not key custody for a retained backup.
const magic = Buffer.from('SOLAR-BACKUP-1\n');
export function sealBackup(bytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}
export function openBackup(bytes, key) {
  if (bytes.length < magic.length + 28 || !bytes.subarray(0, magic.length).equals(magic))
    throw new Error('Unsupported backup envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(magic.length, magic.length + 12));
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(magic.length + 12, magic.length + 28));
  return Buffer.concat([decipher.update(bytes.subarray(magic.length + 28)), decipher.final()]);
}
