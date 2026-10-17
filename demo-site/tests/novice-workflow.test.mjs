import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
async function load(p) {
  const js = ts.transpileModule(read(p), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  );
}
const {
  newInspectionCode,
  reportReturnPath,
  reportLoginPath,
  inspectionNextStep,
} = await load('../lib/novice-workflow.ts');
const { userFacingError, serviceRpc } = await load('../lib/service-access.ts');
const id = '11111111-1111-4111-8111-111111111111';
test('same-day remounts and parallel forms get independent compact reference numbers', () => {
  const codes = new Set(
    Array.from({ length: 1000 }, () =>
      newInspectionCode('2026-10-17', randomUUID()),
    ),
  );
  assert.equal(codes.size, 1000);
  assert.equal(
    newInspectionCode('2026-10-17', id),
    'INS-20261017-1111111111114111',
  );
});
test('report login encodes and restores only the exact internal report route', () => {
  const login = new URL(reportLoginPath(id), 'https://site.example');
  assert.equal(login.pathname, '/login');
  assert.equal(
    reportReturnPath(login.searchParams.get('next')),
    '/reports/' + id,
  );
  for (const value of [
    null,
    '',
    '//evil.example',
    'https://evil.example/reports/' + id,
    '/reports/' + id + '?next=https://evil.example',
    '/reports/' + id + '#x',
    '/reports/' + id + '/..',
    '/reports/%2f%2fevil.example',
    '\\evil.example',
    '/admin',
    '/api/reports/' + id,
    '/reports/not-a-uuid',
    '/reports/' + id + '\n',
  ]) {
    assert.equal(reportReturnPath(value), null, String(value));
  }
  assert.equal(reportLoginPath('not-an-id'), '/login');
});
test('all request stages explain the next step without inventing upload or approval rights', () => {
  for (const s of [
    'requested',
    'scheduled',
    'uploading',
    'quality_review',
    'analysis',
    'expert_review',
    'approval',
    'published',
    'closed',
    'cancelled',
  ]) {
    assert.ok(inspectionNextStep(s).length > 10);
  }
  assert.match(inspectionNextStep('requested'), /담당자/);
  assert.match(inspectionNextStep('cancelled'), /새로 의뢰/);
  assert.match(inspectionNextStep('__proto__'), /확인/);
});
test('database rejects remain visible but are translated without leaking schema details', () => {
  assert.match(
    userFacingError({
      code: '23505',
      message: 'duplicate key inspections_organization_id_inspection_code_key',
    }),
    /점검 번호/,
  );
  assert.match(
    userFacingError({
      code: '23514',
      message: 'violates check constraint customer_accounts_name_check',
    }),
    /고객명/,
  );
  assert.match(
    userFacingError({ code: '42501', message: 'permission denied' }),
    /권한/,
  );
  assert.match(userFacingError(new Error('Failed to fetch')), /연결/);
  assert.equal(
    userFacingError(new Error('완료 목표는 예정 일시보다 빠를 수 없습니다.')),
    '완료 목표는 예정 일시보다 빠를 수 없습니다.',
  );
  for (const message of [
    'new row violates check constraint other_name',
    'unknown SQL detail',
    'secret relation name',
  ]) {
    assert.doesNotMatch(
      userFacingError(new Error(message)),
      /constraint|SQL|secret|relation/,
    );
  }
});
test('service RPC retains rejection and never turns a failed write into success', async () => {
  let writes = 0;
  await assert.rejects(
    serviceRpc(
      {
        rpc: async () => {
          writes++;
          return {
            error: { code: '23514', message: 'customer_accounts_name_check' },
            data: null,
          };
        },
      },
      'service_admin_action',
    ),
    /고객명/,
  );
  assert.equal(writes, 1);
});
test('production fixes keep existing current-account and draft boundaries', () => {
  const app = read('../components/live/live-app.tsx');
  assert.match(
    app,
    /reportReturnPath\(\s*new URLSearchParams\(window.location.search\).get\('next'\),?\s*\)/,
  );
  assert.ok(
    app.indexOf('if (!details.ready) return') <
      app.indexOf('const destination = reportReturnPath'),
  );
  assert.match(
    app,
    /props\.inspections\.find\(\(row\) => row.id === selectedId\)/,
  );
  assert.match(app, /draftNavigationState\(window\) === 'clean'/);
  assert.match(
    read('../components/live/error-notice.tsx'),
    /AlertDialogContent finalFocus/,
  );
});
test('help uses only published contact and invalid names never reach customer create', () => {
  const help = read('../components/service-help.tsx');
  assert.match(help, /get_public_service_policy/);
  assert.doesNotMatch(
    help,
    /settings\.read|organization_members|profiles|\.auth\./,
  );
  const customers = read('../components/live/live-customers.tsx');
  assert.ok(
    customers.indexOf('if (!name.trim())') <
      customers.indexOf("void act('customers.create'"),
  );
  assert.match(customers, /name: name.trim\(\)/);
  assert.match(read('../app/not-found.tsx'), /href="\/"/);
  assert.match(read('../app/not-found.tsx'), /href="\/login"/);
});
