// No remote connections: full migration/RLS regression using synthetic fixtures only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const work = mkdtempSync(join(tmpdir(), 'solar-workflow-'));
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const env = {
  ...process.env,
  PGHOST: work,
  PGPORT: '55441',
  PGUSER: 'solar_test',
  PGDATABASE: 'solar_workflow',
};
let running = false,
  checks = 0;
function run(cmd, args = [], options = {}) {
  return execFileSync(join(bin, cmd), args, {
    encoding: 'utf8',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 12e6,
    ...options,
  });
}
function sql(input) {
  // Notices contain only synthetic fixture labels. Never use this runner on remote data.
  const result = run(
    'psql',
    ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t'],
    { input },
  );
  return result;
}
try {
  run('initdb', [
    '-D',
    join(work, 'data'),
    '-U',
    'solar_test',
    '-A',
    'trust',
    '--no-locale',
    '--encoding=UTF8',
  ]);
  run('pg_ctl', [
    '-D',
    join(work, 'data'),
    '-l',
    join(work, 'postgres.log'),
    '-o',
    `-h '' -k '${work}' -p 55441`,
    '-w',
    'start',
  ]);
  running = true;
  run('createdb', ['solar_workflow'], {
    env: { ...env, PGDATABASE: 'postgres' },
  });
  sql(
    'create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;',
  );
  sql(
    readFileSync(
      join(root, 'supabase/tests/local_auth_storage_fixture.sql'),
      'utf8',
    ),
  );
  for (const name of readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql') && !f.includes('keepalive'))
    .sort()) {
    try {
      sql(readFileSync(join(root, 'supabase/migrations', name), 'utf8'));
    } catch (e) {
      throw Error(name + '\n' + e.stderr);
    }
  }
  sql(readFileSync(join(root, 'supabase/tests/service_access.sql'), 'utf8'));
  checks++;
  const progressive = readFileSync(
    join(root, 'supabase/tests/progressive_photo_diagnosis.sql'),
    'utf8',
  );
  const workflow = readFileSync(
    join(root, 'supabase/tests/workflow_integrity.sql'),
    'utf8',
  );
  sql(progressive.replace('rollback;', workflow + '\nrollback;'));
  checks++;
  console.log(
    'PASS all migrations + service access + progressive diagnosis + workflow integrity SQL assertions',
  );
  console.log('PASS isolated suites: ' + checks + '; no production writes');
} catch (e) {
  console.error(String(e.stderr || e.message));
  process.exitCode = 1;
} finally {
  if (running)
    run('pg_ctl', ['-D', join(work, 'data'), '-m', 'fast', '-w', 'stop']);
  if (!work.startsWith(join(tmpdir(), 'solar-workflow-')))
    throw Error('Unexpected temporary path');
  rmSync(work, { recursive: true, force: true });
  console.log('CLEANED isolated local fixtures and cluster only');
}
