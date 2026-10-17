// Explicit, project-scoped setup only. Secrets travel by pipe, never argv/files/logs.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deliverMail } from '../../supabase/functions/workflow-email/mail.ts';
import { randomUUID } from 'node:crypto';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const project = 'vzgmryqglptxowbdewkf';
const endpoint =
  'https://' + project + '.supabase.co/functions/v1/workflow-email';
if (process.env.SOLAR_EMAIL_SETUP !== '1')
  throw Error('Explicit SOLAR_EMAIL_SETUP=1 required');
function cli(args, input) {
  return execFileSync('npx', ['--yes', 'supabase@2.121.0', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 2e6,
    timeout: 60000,
  });
}
function sql(query) {
  return cli(
    [
      'db',
      'query',
      '--linked',
      '--project-ref',
      project,
      '--file',
      '/dev/stdin',
    ],
    query,
  );
}
let echoDisabled = false;
try {
  if (process.stdin.isTTY) {
    execFileSync('stty', ['-echo'], { stdio: 'inherit' });
    echoDisabled = true;
    console.log('Ready for hidden provider configuration JSON on stdin.');
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
  const key = input.providerKey;
  if (typeof key !== 'string' || !/^re_[A-Za-z0-9_-]{16,200}$/.test(key))
    throw Error('Invalid key');
  sql(
    "do $check$ begin if (select enabled from private.workflow_email_settings where singleton) then raise exception 'Disable mail before changing configuration';end if;end $check$;",
  );
  // Provider-owned test sinks only, never a customer mailbox.
  // They simulate delivery and are not proof of an actual user's inbox.
  for (const [kind, role] of [
    ['inspection_received', 'client'],
    ['expert_assigned', 'expert'],
    ['report_published', 'client'],
  ]) {
    const probe = await deliverMail(
      {
        id: randomUUID(),
        claimToken: 'provider-test',
        kind,
        role,
        email: 'delivered+solar-' + kind + '@resend.dev',
        inspectionCode: '공급자 연결 시험 · 실제 점검 아님',
        inspectionId: randomUUID(),
        reportId: randomUUID(),
      },
      key,
      {
        origin: 'https://solar-asset-care-demo.kimminho0914.chatgpt.site',
        from: 'SolarScope <no-reply@auth.coopco.kr>',
      },
    );
    if (probe.result !== 'accepted') throw Error('Provider test failed');
    console.log('Provider test accepted: ' + kind);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const token = randomBytes(32).toString('hex');
  cli(
    ['secrets', 'set', '--project-ref', project, '--env-file', '/dev/stdin'],
    [
      'RESEND_WORKFLOW_API_KEY=' + key,
      'WORKFLOW_EMAIL_DISPATCH_SECRET=' + token,
      'WORKFLOW_EMAIL_SITE_ORIGIN=https://solar-asset-care-demo.kimminho0914.chatgpt.site',
      'WORKFLOW_EMAIL_FROM="SolarScope <no-reply@auth.coopco.kr>"',
      '',
    ].join('\n'),
  );
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
  sql(
    readFileSync(
      resolve(root, 'supabase/operations/workflow_email_dispatcher.sql'),
      'utf8',
    ),
  );
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
    'Workflow mail configuration did not complete; mail remains disabled. Inspect project configuration without exposing secret values.',
  );
  process.exitCode = 1;
} finally {
  if (echoDisabled) execFileSync('stty', ['echo'], { stdio: 'inherit' });
}
