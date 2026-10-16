import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
async function load(path) {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
}
const {
  businessNumberValid,
  validateAccountDetails,
  serviceContentReady,
  emptyServiceContent,
} = await load('../lib/service-access.ts');
const { portalPath, portalForRole, portalLabel } =
  await load('../lib/portal.ts');
test('customer category is distinct from role and supports sole proprietors', () => {
  const common = { name: '가상 담당자', phone: '01012345678' };
  assert.equal(
    validateAccountDetails({ ...common, kind: 'individual' }, true),
    null,
  );
  assert.equal(
    validateAccountDetails(
      {
        ...common,
        kind: 'sole_proprietor',
        business_name: '가상 사업자',
        business_number: '1234567891',
        representative: '가상 대표',
      },
      true,
    ),
    null,
  );
  assert.match(
    validateAccountDetails({ ...common, kind: 'corporation' }, true),
    /상호/,
  );
  assert.equal(validateAccountDetails(common, false), null);
});
test('business checksum detects typos without claiming identity verification', () => {
  assert.equal(businessNumberValid('123-45-67891'), true);
  for (const n of ['1234567890', '1', '', null])
    assert.equal(businessNumberValid(n ?? ''), false);
});
test('business contacts may provide representative later without skipping company identity checks', () => {
  const d = {
    name: '가상 담당자',
    phone: '01012345678',
    kind: 'corporation',
    business_name: '가상 업체',
    business_number: '1234567891',
  };
  assert.equal(validateAccountDetails(d, true), null);
  assert.match(
    validateAccountDetails({ ...d, representative: '가'.repeat(81) }, true),
    /80자/,
  );
  assert.match(
    validateAccountDetails({ ...d, business_number: '' }, true),
    /등록번호/,
  );
});
test('profile validation rejects missing contacts and unsupported customer types', () => {
  assert.match(
    validateAccountDetails({ name: '', phone: '01012345678' }, false),
    /이름/,
  );
  assert.match(
    validateAccountDetails({ name: '가상', phone: '123' }, false),
    /연락처/,
  );
  assert.match(
    validateAccountDetails(
      { name: '가상', phone: '01012345678', kind: 'owner' },
      true,
    ),
    /구분/,
  );
});
test('role routes and task labels are separated', () => {
  assert.equal(portalPath('owner'), '/admin');
  assert.equal(portalPath('expert'), '/expert');
  assert.equal(portalPath('client'), '/client');
  assert.equal(portalForRole('unknown'), null);
  assert.equal(portalLabel('client', 'inspections', '점검'), '점검 의뢰');
  assert.equal(portalLabel('expert', 'inspections', '점검'), '배정 점검');
});
test('dedicated portal routes select a matching role and public landing is not the console', () => {
  for (const route of ['admin', 'expert', 'client'])
    assert.ok(
      readFileSync(
        new URL(`../app/${route}/page.tsx`, import.meta.url),
        'utf8',
      ).includes(`portal="${route}"`),
    );
  assert.ok(
    readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8').includes(
      'PublicHome',
    ),
  );
  const code = readFileSync(
    new URL('../components/live/live-app.tsx', import.meta.url),
    'utf8',
  );
  const compact = code.replace(/\s/g, '');
  assert.ok(
    compact.includes('portalForRole(workspace.membership.role)!==portal'),
  );
  assert.ok(compact.includes('if(!details.ready)return;'));
  assert.ok(compact.includes('readiness.role!==role'));
});
test('policy display is plain text, requires two separate explicit choices and does not fabricate consent', () => {
  const code = readFileSync(
    new URL('../components/live/live-profile.tsx', import.meta.url),
    'utf8',
  );
  const compact = code.replace(/\s/g, '');
  assert.ok(compact.includes('(!terms||!privacy)'));
  assert.ok(compact.includes('p_policy_id:data.policy?.id??null'));
  assert.ok(!code.includes('dangerouslySetInnerHTML'));
  const settings = readFileSync(
    new URL('../components/live/live-service-settings.tsx', import.meta.url),
    'utf8',
  );
  assert.ok(
    settings.replace(/\s/g, '').includes('disabled={busy||dirty||!canApply}'),
  );
  assert.ok(settings.includes('AlertDialogTitle'));
  assert.ok(!settings.includes('dangerouslySetInnerHTML'));
});
test('empty or partial legal drafts cannot enable application', () => {
  assert.equal(serviceContentReady(emptyServiceContent), false);
  assert.equal(
    serviceContentReady({
      ...emptyServiceContent,
      operator_name: '가상 운영자',
      contact_email: 'qa@example.invalid',
      privacy_contact: '가상 담당',
      terms: '검수용'.repeat(20),
      privacy: '검수용'.repeat(20),
    }),
    true,
  );
  assert.equal(
    serviceContentReady({ ...emptyServiceContent, contact_email: 'invalid' }),
    false,
  );
});
