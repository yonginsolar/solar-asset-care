import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceTarget } from '../scripts/acceptance-target.mjs';
const hosted = 'https://solar-asset-care-demo.kimminho0914.chatgpt.site';
test('acceptance credentials stay on an explicitly authorized target', () => {
  assert.throws(() => acceptanceTarget({}));
  assert.equal(
    acceptanceTarget({ SOLAR_ACCEPTANCE_RUN: '1' }),
    'http://localhost:3000',
  );
  assert.equal(
    acceptanceTarget({ SOLAR_ACCEPTANCE_RUN: '1', SOLAR_ACCEPTANCE_DEPLOYED: '1' }),
    hosted,
    'explicit deployed mode must not silently test localhost',
  );
  assert.throws(() => acceptanceTarget({
    SOLAR_ACCEPTANCE_RUN: '1', SOLAR_ACCEPTANCE_DEPLOYED: '1', SOLAR_UI_ACCEPTANCE: '1',
  }));
  const env = { SOLAR_ACCEPTANCE_RUN: '1', SOLAR_ACCEPTANCE_ORIGIN: hosted };
  assert.throws(() => acceptanceTarget(env));
  assert.equal(
    acceptanceTarget({ ...env, SOLAR_ACCEPTANCE_DEPLOYED: '1' }),
    hosted,
  );
  for (const bad of [
    hosted + '.evil.test',
    hosted + '/path',
    hosted + '?x=1',
    'http://solar-asset-care-demo.kimminho0914.chatgpt.site',
    'https://solar-asset-care-demo.kimminho0914.chatgpt.site@evil.test',
    'http://localhost.evil.test:3000',
  ]) {
    assert.throws(() =>
      acceptanceTarget({
        ...env,
        SOLAR_ACCEPTANCE_DEPLOYED: '1',
        SOLAR_ACCEPTANCE_ORIGIN: bad,
      }),
    );
  }
  assert.throws(() =>
    acceptanceTarget({
      ...env,
      SOLAR_ACCEPTANCE_DEPLOYED: '1',
      SOLAR_UI_ACCEPTANCE: '1',
    }),
  );
});
