import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const { accountDetailsFingerprint: fp } = await load(
  '../lib/service-access.ts',
);
const { quoteSelectionLock } = await load('../lib/quote-selection.ts');
const { portalPath, portalTitle } = await load('../lib/portal.ts');

test('reverted optional profile values are clean regardless of missing/null/empty keys and formatting', () => {
  const original = {
    name: '가상 고객',
    phone: '01012345678',
    kind: 'individual',
  };
  assert.equal(
    fp(original, true),
    fp(
      {
        ...original,
        business_name: '',
        business_number: '',
        representative: null,
      },
      true,
    ),
  );
  assert.equal(
    fp(original, true),
    fp(
      {
        phone: '010-1234-5678',
        name: '가상 고객 ',
        kind: 'individual',
        business_number: ' ',
      },
      true,
    ),
  );
  for (const patch of [
    { name: '수정' },
    { phone: '01022223333' },
    { kind: 'corporation' },
    { business_name: '숨겨진 실제 초안' },
  ])
    assert.notEqual(fp(original, true), fp({ ...original, ...patch }, true));
  const business = {
    ...original,
    kind: 'sole_proprietor',
    business_name: '시험',
    business_number: '1234567891',
  };
  assert.equal(
    fp(business, true),
    fp(
      { ...business, business_number: '123-45-67891', representative: '' },
      true,
    ),
  );
  assert.notEqual(
    fp(business, true),
    fp({ ...business, representative: '새 이름' }, true),
  );
});
test('staff profile comparisons do not invent customer-kind requirements', () => {
  const d = { name: '가상 전문가', phone: '01012345678' };
  assert.equal(
    fp(d, false),
    fp({ ...d, kind: 'individual', business_name: '' }, false),
  );
  assert.notEqual(fp(d, false), fp({ ...d, name: '다른 전문가' }, false));
});
test('quotation lock mirrors work state, never enables missing work or non-designated actors', () => {
  const r = {
    status: 'selected',
    requester_user_id: 'client',
    maintenance_request_id: 'work',
  };
  for (const status of ['requested', 'assigned', 'quoting', 'scheduled'])
    assert.equal(
      quoteSelectionLock(r, [{ id: 'work', status }], 'client'),
      null,
    );
  for (const status of ['in_progress', 'completed', 'cancelled'])
    assert.match(
      quoteSelectionLock(r, [{ id: 'work', status }], 'client'),
      /변경할 수 없습니다/,
    );
  assert.match(quoteSelectionLock(r, [], 'client'), /확인할 수 없습니다/);
  assert.match(
    quoteSelectionLock(r, [{ id: 'work', status: 'requested' }], 'other'),
    /지정/,
  );
  assert.match(
    quoteSelectionLock({ ...r, status: 'completed' }, [], 'client'),
    /종료/,
  );
  assert.equal(
    quoteSelectionLock({ ...r, maintenance_request_id: null }, [], 'client'),
    null,
  );
});
test('report return destinations follow only current server membership and include failure fallback', () => {
  for (const [role, path, label] of [
    ['owner', '/admin', '관리자 운영센터'],
    ['expert', '/expert', '전문가 작업실'],
    ['client', '/client', '내 발전소 관리'],
  ]) {
    assert.equal(portalPath(role), path);
    assert.equal(portalTitle(role), label);
  }
  const report = read('../components/live/live-report.tsx');
  assert.equal((report.match(/href=\{backPath\}/g) || []).length, 2);
  assert.ok(!report.includes('href="/admin"'));
  assert.ok(report.includes("rpc('get_my_account_state')"));
  assert.ok(report.includes(".from('organization_members')"));
  assert.ok(!report.includes('user_metadata'));
});
test('schedule editing keeps exact revision, unchanged timestamp precision and pending/draft protection', () => {
  const code = read('../components/live/live-inspection-schedule.tsx');
  assert.ok(code.includes('useDraftProtection(dirty, busy)'));
  assert.ok(code.includes('p_expected_updated_at: original.updated_at'));
  assert.ok(code.includes('scheduledAt === start'));
  assert.ok(code.includes('original.scheduled_at'));
  assert.ok(code.includes("parseKoreanInput(scheduledAt, '예정 일시')"));
  assert.ok(code.includes('Date.parse(due) < Date.parse(scheduled)'));
  assert.ok(code.includes('disabled={busy || !dirty}'));
  const app = read('../components/live/live-app.tsx');
  assert.match(
    app,
    /props\.canUpdate\s*&&\s*!props\.requesterMode\s*&&\s*!props\.expertMode\s*&&\s*!inspectionLocked\(inspection.status\)/,
  );
  assert.ok(app.includes('Boolean(selectionLock)'));
});
