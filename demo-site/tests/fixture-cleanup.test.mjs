import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../scripts/verify-service-access-local.mjs', import.meta.url), 'utf8')
    .replaceAll('import.meta.dirname', '"/fixture/scripts"'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture({ originalFailure = false, cleanupFailure = false } = {}) {
  const commands = [], messages = [], process = { env: { SOLAR_LOCAL_QA: '1' }, exitCode: undefined };
  let drops = 0, failure;
  const scope = vm.createContext({ exports: {}, process,
    console: { log: (...args) => messages.push(args.join(' ')), error: (...args) => messages.push(args.join(' ')) },
    require: (name) => {
      if (name === 'node:child_process') return { execFileSync: (command, args) => {
        commands.push([command, args]);
        if (originalFailure && command.endsWith('psql') && args.some(a => a.endsWith('service_access.sql')))
          throw Object.assign(Error('original test failed'), { stderr: 'original test failed' });
        if (command.endsWith('dropdb') && ++drops === 1 && cleanupFailure)
          throw Object.assign(Error('cleanup failed'), { stderr: 'cleanup failed' });
        return '';
      } };
      if (name === 'node:fs') return { readFileSync: () => '', readdirSync: () => [], mkdtempSync: () => '/tmp/solar-service-restore-fixture' };
      if (name === 'node:os') return { tmpdir: () => '/tmp' };
      if (name === 'node:path') return path;
      if (name === 'node:crypto') return { randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' };
      throw Error(name);
    },
  });
  try { vm.runInContext(source, scope); } catch (error) { failure = error; }
  return { commands, messages, process, drops, failure };
}
test('isolated restore fixture normally drops both explicitly generated test databases', () => {
  const result = fixture();
  assert.equal(result.failure, undefined);
  assert.equal(result.drops, 2);
  assert.ok(result.messages.some(m => m.startsWith('CLEANED')));
  for (const [command, args] of result.commands.filter(([command]) => command.endsWith('dropdb'))) {
    assert.ok(command.endsWith('dropdb'));
    assert.match(args.at(-1), /^solar_service_qa_[a-f0-9]{12}(_restored)?$/);
  }
});
test('cleanup failure remains a failure, continues the other cleanup and never claims CLEANED', () => {
  const result = fixture({ cleanupFailure: true });
  assert.equal(result.process.exitCode, 1);
  assert.equal(result.drops, 2);
  assert.ok(result.messages.some(m => m.includes('cleanup failed')));
  assert.ok(!result.messages.some(m => m.startsWith('CLEANED')));
});
test('cleanup cannot mask the original assertion failure', () => {
  const result = fixture({ originalFailure: true, cleanupFailure: true });
  assert.match(result.failure.message, /original test failed/);
  assert.equal(result.process.exitCode, 1);
  assert.ok(result.messages.some(m => m.includes('cleanup failed')));
});
