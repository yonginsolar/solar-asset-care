import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = ts
  .transpileModule(read('../lib/inspection-context.tsx'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replace(
    /from ['"]react['"]/g,
    `from '${import.meta.resolve('react')}'`,
  )
  .replace(
    /from ['"]react\/jsx-runtime['"]/g,
    `from '${import.meta.resolve('react/jsx-runtime')}'`,
  );
const { resolveInspectionSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
test('inspection context only resolves currently authorized inspections', () => {
  const rows = [{ id: 'first' }, { id: 'second' }];
  assert.equal(resolveInspectionSelection('second', rows), 'second');
  assert.equal(resolveInspectionSelection('revoked-or-foreign', rows), 'first');
  assert.equal(resolveInspectionSelection('second', []), '');
});
test('short positive payback does not display as zero years', async () => {
  const code = ts.transpileModule(read('../lib/payback-format.ts'), {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText;
  const { formatPaybackYears: fmt } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  assert.equal(fmt(0.03), '1개월 미만');
  assert.equal(fmt(0.5), '6개월');
  assert.equal(fmt(1.2), '1.2년');
  assert.equal(fmt(0), '즉시 (수리비 0원)');
  assert.equal(fmt(null), '산출 불가 (회수가능액 0)');
});
test('intake retains unknown plant facts instead of making up zeros or dates', () => {
  const source = read('../components/live/live-app.tsx');
  assert.ok(
    source.includes('p_capacity_kw: capacity ? Number(capacity) : null'),
  );
  assert.ok(source.includes('p_commissioned_on: commissionedOn || null'));
  assert.ok(source.includes("rpc('update_requester_plant'"));
  assert.ok(!source.includes('required={props.requesterMode}'));
});
test('password visibility and confirmation resend do not replace invite/password gates', () => {
  const source = read('../components/live/live-app.tsx');
  assert.ok(source.includes('supabase.auth.resend({'));
  assert.ok(source.includes("type: 'signup'"));
  assert.ok(source.includes('setResendSeconds(60)'));
  assert.ok(source.includes("showPassword ? 'text' : 'password'"));
  assert.ok(source.includes('initialSetup'));
});
