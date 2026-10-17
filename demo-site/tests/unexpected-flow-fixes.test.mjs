import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../components/live/live-app.tsx');
const migration = read(
  '../../supabase/migrations/20261017082126_fix_revision_analysis_and_schedule_consistency.sql',
);
const section = (start, end) =>
  app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));

test('all relative-analysis writes use one current-revision predicate without granting client execution', () => {
  for (const ref of ['i.id', 'run_row.inspection_id', 'parent'])
    assert.ok(
      migration.includes(`if not private.relative_analysis_editable(${ref})`),
    );
  assert.match(migration, /draft\.version>issued\.version/);
  assert.match(migration, /status in \('review','approved'\)/);
  assert.match(
    migration,
    /i\.status not in \('published','closed','cancelled'\)/,
  );
  assert.match(
    migration,
    /revoke all on function private\.relative_analysis_editable\(uuid\) from public,anon,authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute|disable row level|drop policy|update public\.reports/i,
  );
  assert.equal(
    (migration.match(/Unexpected relative analysis /g) || []).length,
    3,
  );
});

test('schedule invariant covers direct writes while RPC only synchronizes initial states', () => {
  assert.match(migration, /new\.status='scheduled'.*new\.scheduled_at is null/);
  assert.match(migration, /before insert or update on public\.inspections/);
  assert.match(
    migration.replaceAll("''", "'"),
    /when i\.status in \('requested','scheduled'\)/,
  );
  assert.match(migration, /else i\.status end/);
  assert.doesNotMatch(
    migration,
    /update public\.inspections where|update public\.inspections set status=/,
  );
});

function statusHandler() {
  const source = section(
    'async function updateStatus(inspection:',
    'async function assignExpert(',
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const events = [];
  const chain = {
    update: () => chain,
    eq: () => chain,
    select: () => chain,
    maybeSingle: async () => ({ data: { id: 'one' }, error: null }),
  };
  const props = {
    setNotice: (x) => events.push(['notice', x]),
    organizationId: 'org',
    supabase: {
      from: () => {
        events.push(['write']);
        return chain;
      },
    },
    refresh: async () => events.push(['refresh']),
  };
  const fn = new vm.Script(js + '; updateStatus;').runInNewContext({
    props,
    rowLock: { current: false },
    setRowBusy: (x) => events.push(['busy', x]),
    setConfirmScheduleId: (x) => events.push(['confirm', x]),
    setEditingScheduleId: (x) => events.push(['editor', x]),
    errorMessage: String,
  });
  return { fn, events };
}

test('confirming a dateless request opens schedule input without any premature write', async () => {
  const { fn, events } = statusHandler();
  await fn({ id: 'one', scheduled_at: null }, 'scheduled');
  assert.deepEqual(events, [
    ['notice', null],
    ['confirm', 'one'],
    ['editor', 'one'],
  ]);
});

test('normal status updates retain the existing write and refresh path', async () => {
  const { fn, events } = statusHandler();
  await fn({ id: 'one', scheduled_at: '2026-10-20T00:00:00Z' }, 'scheduled');
  assert.equal(events.filter((e) => e[0] === 'write').length, 1);
  assert.equal(events.filter((e) => e[0] === 'refresh').length, 1);
  assert.match(
    section(
      'async function updateStatus(inspection:',
      'async function assignExpert(',
    ),
    /\.eq\('updated_at', inspection.updated_at\)/,
  );
});

test('errors inside existing action dialogs remain in that dialog and focus the error', () => {
  const resolution = section(
    'async function resolveAnalysis()',
    'const hasSuccessfulAnalysis',
  );
  const quote = section(
    'async function selectQuote(',
    'if (props.requesterMode)',
  );
  assert.match(resolution, /setResolutionError\(errorMessage\(error\)\)/);
  assert.match(quote, /setQuoteError\(errorMessage\(error\)\)/);
  assert.doesNotMatch(resolution, /tone: 'error'/);
  assert.doesNotMatch(quote, /tone: 'error'/);
  assert.match(
    app,
    /if \(resolutionError\) resolutionErrorRef.current\?\.focus\(\)/,
  );
  assert.match(app, /if \(quoteError\) quoteErrorRef.current\?\.focus\(\)/);
  assert.match(app, /ref=\{resolutionErrorRef\}[\s\S]{0,100}tabIndex=\{-1\}/);
  assert.match(app, /ref=\{quoteErrorRef\}[\s\S]{0,100}tabIndex=\{-1\}/);
});

test('successful customer intake selects only its confirmed, freshly authorized row after busy/draft guards', () => {
  const inspection = section(
    'function InspectionsView(',
    'function FilesView(',
  );
  assert.match(
    inspection,
    /if \(props.requesterMode && data\?\.id\) setCreatedInspectionId\(data.id\)/,
  );
  assert.match(inspection, /if \(!createdInspectionId \|\| busy\) return/);
  assert.match(inspection, /draftNavigationState\(window\) !== 'clean'/);
  assert.match(
    inspection,
    /receiptRows.find\(\(row\) => row.id === createdInspectionId\)/,
  );
  assert.match(inspection, /if \(!created\) return/);
  assert.match(inspection, /!selectInspection\(created.id\)/);
  assert.match(inspection, /clearTimeout\(timer\)/);
});

test('schedule confirmation focuses date, and publication does not advertise unavailable automatic analysis', () => {
  const editor = read('../components/live/live-inspection-schedule.tsx');
  assert.match(editor, /required=\{confirmSchedule\}/);
  assert.match(editor, /startRef.current\?\.focus/);
  assert.match(editor, /if \(confirmSchedule && !scheduled\)/);
  const files = section('function FilesView(', 'function ReportsView(');
  assert.match(files, /checked=\{runAnalysis && canAnalyzeSelected\}/);
  assert.match(files, /runAnalysis &&\s*canAnalyzeSelected &&/);
  assert.match(files, /추가 분석은 새 보고서 초안을 만든 뒤/);
});
