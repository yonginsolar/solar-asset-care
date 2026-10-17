import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const load = async (p) =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(
        ts.transpileModule(read(p), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      ).toString('base64')
  );
const { collectPagedRows, collectionRowKey } = await load(
  '../lib/paged-rows.ts',
);
const { reportSessionBoundary } = await load('../lib/report-session.ts');
test('all 1,004 rows survive an API cap, with bounded requests and preserved order', async () => {
  const rows = Array.from({ length: 1004 }, (_, id) => ({ id: String(id) }));
  const calls = [];
  const actual = await collectPagedRows(
    (from, to) => {
      calls.push([from, to]);
      return {
        data: rows.slice(from, to + 1),
        error: null,
        count: rows.length,
      };
    },
    new AbortController().signal,
    collectionRowKey,
  );
  assert.deepEqual(actual.data, rows);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(([f, t]) => t - f === 499));
});
test('an API cap smaller than requested pages still does not truncate a collection', async () => {
  const rows = Array.from({ length: 1004 }, (_, id) => ({ id: String(id) }));
  const actual = await collectPagedRows(
    (from) => ({
      data: rows.slice(from, from + 75),
      error: null,
      count: from === 0 ? 1004 : null,
    }),
    new AbortController().signal,
    collectionRowKey,
  );
  assert.deepEqual(actual.data, rows);
});
test('empty list is a confirmed zero, not a failed or missing page', async () => {
  assert.deepEqual(
    (
      await collectPagedRows(
        () => ({ data: [], error: null, count: 0 }),
        new AbortController().signal,
        collectionRowKey,
      )
    ).data,
    [],
  );
  for (const result of [
    { data: [], error: null, count: 1 },
    { data: [], error: null, count: null },
    { data: null, error: null, count: 0 },
    { data: [], error: new Error('denied'), count: 0 },
  ])
    await assert.rejects(
      collectPagedRows(
        () => result,
        new AbortController().signal,
        collectionRowKey,
      ),
    );
});
test('changed totals, duplicate rows and cancelled late reads never become a partial success', async () => {
  let calls = 0;
  await assert.rejects(
    collectPagedRows(
      () => ({
        data: [{ id: String(calls++) }],
        error: null,
        count: calls === 1 ? 2 : 3,
      }),
      new AbortController().signal,
      collectionRowKey,
      1,
    ),
    /변경/,
  );
  await assert.rejects(
    collectPagedRows(
      () => ({ data: [{ id: 'a' }], error: null, count: 2 }),
      new AbortController().signal,
      collectionRowKey,
      1,
    ),
    /순서/,
  );
  const controller = new AbortController();
  await assert.rejects(
    collectPagedRows(
      () => {
        controller.abort();
        return { data: [{ id: 'a' }], error: null, count: 1 };
      },
      controller.signal,
      collectionRowKey,
    ),
  );
});
test('composite membership, requester and private partner rows retain distinct identities', () => {
  assert.notEqual(
    collectionRowKey({ plant_id: 'p', requester_user_id: 'a' }),
    collectionRowKey({ plant_id: 'p', requester_user_id: 'b' }),
  );
  assert.notEqual(
    collectionRowKey({ organization_id: 'a', user_id: 'u' }),
    collectionRowKey({ organization_id: 'b', user_id: 'u' }),
  );
  assert.equal(collectionRowKey({ partner_id: 'p' }), 'p');
});
test('logout/account switch invalidates report data and pending downloads, including returning to the same account', () => {
  const boundary = reportSessionBoundary();
  assert.equal(boundary.current(boundary.ticket()), false);
  boundary.change('a');
  const ticket = boundary.ticket();
  assert.equal(boundary.current(ticket), true);
  assert.equal(boundary.change('a'), false);
  assert.equal(boundary.current(ticket), true);
  boundary.change(null);
  assert.equal(boundary.current(ticket), false);
  boundary.change('a');
  assert.equal(boundary.current(ticket), false);
  const next = boundary.ticket();
  boundary.change('b');
  assert.equal(boundary.current(next), false);
});
test('actual UI connects identity fencing, replay identifiers, one-field member CAS, and invite-only draft protection', () => {
  const report = read('../components/live/live-report.tsx'),
    app = read('../components/live/live-app.tsx');
  assert.ok(report.includes('supabase.auth.onAuthStateChange'));
  assert.ok(report.includes('reportState?.owner === sessionUserId'));
  assert.ok(report.includes('if (!boundary.current(ticket)) return'));
  const members = app.slice(app.indexOf('function MembersView('));
  assert.ok(members.includes('p_expected_updated_at: member.updated_at'));
  assert.ok(members.includes('p_role: updates.role ?? null'));
  assert.ok(members.includes('p_status: updates.status ?? null'));
  assert.ok(members.includes('invitationDraft !== invitationBaseline.current'));
  assert.ok(
    members.includes('organizationName !== organizationBaseline.current'),
  );
  assert.ok(!members.includes('useDraftProtection(Boolean(memberSearch'));
  assert.ok(app.includes('p_request_id: registrationId.current'));
  assert.ok(app.includes('p_request_id: intakeRequestId.current'));
});
