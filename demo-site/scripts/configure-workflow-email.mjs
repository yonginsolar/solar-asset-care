// Project-scoped dispatcher setup after the four server secrets are saved via
// the authenticated Supabase dashboard. No provider key is read or stored here.
// Supply {dispatchSecret: "..."} via hidden stdin/private FIFO, never argv/files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const project = 'vzgmryqglptxowbdewkf';
const endpoint =
  'https://' + project + '.supabase.co/functions/v1/workflow-email';
if (process.env.SOLAR_EMAIL_SETUP !== '1')
  throw Error('Explicit SOLAR_EMAIL_SETUP=1 required');
function sql(input) {
  return execFileSync(
    'npx',
    [
      '--yes',
      'supabase@2.121.0',
      'db',
      'query',
      '--linked',
      '--project-ref',
      project,
      '--file',
      '/dev/stdin',
    ],
    {
      cwd: root,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 2e6,
      timeout: 60000,
    },
  );
}
let echoDisabled = false,
  stage = 'input';
try {
  if (process.stdin.isTTY) {
    execFileSync('stty', ['-echo'], { stdio: 'inherit' });
    echoDisabled = true;
    console.log('Ready for hidden dispatcher configuration JSON on stdin.');
  }
  const input = JSON.parse(
    await new Promise((resolve) => {
      let s = '';
      process.stdin.on('data', (c) => {
        s += c;
        if (s.includes('\n')) resolve(s.trim());
      });
      process.stdin.on('end', () => resolve(s.trim()));
    }),
  );
  if (echoDisabled) {
    execFileSync('stty', ['echo'], { stdio: 'inherit' });
    echoDisabled = false;
  }
  const token = input.dispatchSecret;
  process.stdin.pause();
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    throw Error('Invalid dispatcher secret');
  stage = 'preflight';
  sql(
    "do $check$ begin if (select enabled from private.workflow_email_settings where singleton) then raise exception 'Disable mail before changing configuration';end if;end $check$;",
  );
  stage = 'vault';
  sql(
    'do $vault$ declare id uuid;begin ' +
      "select s.id into id from vault.secrets s where name='solar_workflow_email_dispatch_secret';" +
      "if id is null then perform vault.create_secret('" +
      token +
      "','solar_workflow_email_dispatch_secret','Internal workflow mail dispatcher only');" +
      "else perform vault.update_secret(id,'" +
      token +
      "');end if;" +
      "select s.id into id from vault.secrets s where name='solar_workflow_email_endpoint';" +
      "if id is null then perform vault.create_secret('" +
      endpoint +
      "','solar_workflow_email_endpoint','Solar workflow endpoint');" +
      "else perform vault.update_secret(id,'" +
      endpoint +
      "');end if;end $vault$;",
  );
  stage = 'cron';
  sql(
    readFileSync(
      resolve(root, 'supabase/operations/workflow_email_dispatcher.sql'),
      'utf8',
    ),
  );
  stage = 'worker';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200 || (await response.json()).processed !== 0)
    throw Error('Worker configuration check failed');
  console.log(
    JSON.stringify({
      configured: true,
      workerAuthenticated: true,
      enabled: false,
      customerEmailsSent: 0,
    }),
  );
} catch {
  console.error(
    'Workflow mail configuration did not complete at ' +
      stage +
      '; mail remains disabled. Inspect configuration without exposing secret values.',
  );
  process.exitCode = 1;
} finally {
  if (echoDisabled) execFileSync('stty', ['echo'], { stdio: 'inherit' });
}
