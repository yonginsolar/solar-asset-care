import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createHmac, randomUUID } from 'node:crypto';
const source = readFileSync(
  new URL('../../supabase/functions/workflow-email/mail.ts', import.meta.url),
  'utf8',
);
const mail = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    ).toString('base64')
);
const config = {
  origin: 'https://solar-asset-care-demo.kimminho0914.chatgpt.site',
  from: 'SolarScope <no-reply@auth.coopco.kr>',
};
const renderMail = (job) => mail.renderMail(job, config);
const deliverMail = (job, key, http) =>
  mail.deliverMail(job, key, config, http);
const { safeRecipient } = mail;
const handlerSource = readFileSync(
  new URL(
    '../../supabase/functions/workflow-email/handler.ts',
    import.meta.url,
  ),
  'utf8',
);
const mailUrl =
  'data:text/javascript;base64,' +
  Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
  ).toString('base64');
const handlerJs = ts
  .transpileModule(handlerSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace('"./mail.ts"', JSON.stringify(mailUrl));
const { handleWorkflowEmail } = await import(
  'data:text/javascript;base64,' + Buffer.from(handlerJs).toString('base64')
);
const vars = {
  WORKFLOW_EMAIL_DISPATCH_SECRET:
    'test-only-dispatch-secret-longer-than-32-chars',
  RESEND_WORKFLOW_API_KEY: 'fake',
  WORKFLOW_EMAIL_SITE_ORIGIN: config.origin,
  WORKFLOW_EMAIL_FROM: config.from,
};
const env = (name) => vars[name];
const request = () =>
  new Request('https://local.fixture/worker', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + vars.WORKFLOW_EMAIL_DISPATCH_SECRET },
  });
const job = {
  id: '00000000-0000-4000-8000-000000000001',
  claimToken: 'test',
  kind: 'inspection_received',
  role: 'client',
  email: 'qa@local.fixture',
  inspectionCode: 'CASE-001',
  inspectionId: '00000000-0000-4000-8000-000000000002',
  reportId: null,
};
test('all three events render Korean transactional mail for their role', () => {
  for (const [kind, role, route] of [
    ['inspection_received', 'owner', 'admin?view'],
    ['inspection_received', 'client', 'client?view'],
    ['expert_assigned', 'expert', 'expert?view'],
    ['expert_assigned', 'client', 'client?view'],
    ['report_published', 'client', 'reports/'],
  ]) {
    const message = renderMail({ ...job, kind, role, reportId: job.id });
    assert.match(message.subject, /^\[SolarScope\] /);
    assert.ok(message.text.includes(route));
    assert.ok(message.html.includes('로그인 후 확인하기'));
    assert.equal(message.to.length, 1);
    assert.equal(message.cc, undefined);
    assert.equal(message.attachments, undefined);
    assert.ok(!message.text.includes('조합'));
    assert.match(message.html, /lang="ko"/);
  }
});
for (const [kind, role, title, detail, thanks, path] of [
  [
    'inspection_received',
    'owner',
    '점검이 접수되었습니다',
    '새로운 점검 요청이 접수되었습니다. 관리자 화면에서 요청 내용을 확인해 주시기 바랍니다.',
    '원활한 점검 운영에 협조해 주셔서 감사합니다.',
    'admin?view=inspections&inspection=' + job.inspectionId,
  ],
  [
    'inspection_received',
    'client',
    '점검이 접수되었습니다',
    '요청하신 점검이 정상적으로 접수되었습니다. 로그인하시면 접수 내용과 진행 상황을 확인하실 수 있습니다.',
    'SolarScope를 이용해 주셔서 감사합니다.',
    'client?view=inspections&inspection=' + job.inspectionId,
  ],
  [
    'expert_assigned',
    'expert',
    '점검 담당 전문가가 배정되었습니다',
    '새로운 점검의 담당 전문가로 배정되셨습니다. 전문가 화면에서 점검 내용을 확인해 주시기 바랍니다.',
    '점검 업무에 협조해 주셔서 감사합니다.',
    'expert?view=inspections&inspection=' + job.inspectionId,
  ],
  [
    'expert_assigned',
    'client',
    '점검 담당 전문가가 배정되었습니다',
    '요청하신 점검을 담당할 전문가가 배정되었습니다. 로그인하시면 점검 진행 상황을 확인하실 수 있습니다.',
    'SolarScope를 이용해 주셔서 감사합니다.',
    'client?view=inspections&inspection=' + job.inspectionId,
  ],
  [
    'report_published',
    'client',
    '점검 보고서가 발행되었습니다',
    '요청하신 점검의 보고서가 발행되었습니다. 로그인하신 후 보고서를 확인해 주시기 바랍니다.',
    'SolarScope를 이용해 주셔서 감사합니다.',
    'reports/' + job.id,
  ],
]) {
  test(`polite ${kind}/${role} copy reaches the provider with unchanged routing`, async () => {
    const input = { ...job, kind, role, reportId: job.id };
    const message = renderMail(input);
    const paragraphs = [
      '안녕하세요. SolarScope입니다.',
      detail,
      thanks,
      '이 메일은 서비스 진행 안내입니다. 회신은 수신되지 않습니다.',
    ];
    assert.equal(message.subject, '[SolarScope] ' + title);
    assert.equal(message.from, config.from);
    assert.deepEqual(message.to, [job.email]);
    for (const paragraph of paragraphs) {
      assert.equal(message.text.split(paragraph).length - 1, 1);
      assert.equal(message.html.split(paragraph).length - 1, 1);
    }
    assert.ok(message.text.includes('\n\n안녕하세요. SolarScope입니다.\n\n'));
    assert.ok(message.text.includes('\n\n' + thanks + '\n\n'));
    assert.ok(message.text.includes('확인하기: ' + config.origin + '/' + path));
    assert.ok(message.text.includes('점검번호: ' + job.inspectionCode));
    assert.ok(message.html.includes('>로그인 후 확인하기</a>'));
    assert.ok(!JSON.stringify(message).includes('조합'));
    let sends = 0;
    const result = await deliverMail(input, 'fake', async (_url, options) => {
      sends++;
      assert.deepEqual(JSON.parse(options.body), message);
      assert.equal(
        options.headers['Idempotency-Key'],
        'solar-workflow-v1/' + job.id,
      );
      return Response.json({ id: 'fake-message-id' });
    });
    assert.equal(sends, 1);
    assert.deepEqual(result, {
      result: 'accepted',
      providerId: 'fake-message-id',
    });
  });
}
for (const role of ['owner', 'expert', 'client']) {
  test(`report mail uses the same customer-friendly closing for ${role}`, async () => {
    const input = { ...job, kind: 'report_published', role, reportId: job.id };
    const message = renderMail(input);
    assert.equal(message.subject, '[SolarScope] 점검 보고서가 발행되었습니다');
    assert.equal(message.from, config.from);
    assert.deepEqual(message.to, [job.email]);
    for (const body of [message.text, message.html]) {
      assert.equal(
        body.split('SolarScope를 이용해 주셔서 감사합니다.').length - 1,
        1,
      );
      assert.ok(!body.includes('협조해 주셔서'));
      assert.ok(!/\[TEST\]|테스트/.test(body));
      assert.ok(body.includes(config.origin + '/reports/' + job.id));
      assert.ok(body.includes(job.inspectionCode));
    }
    let sends = 0;
    const result = await deliverMail(input, 'fake', async (_url, options) => {
      sends++;
      assert.deepEqual(JSON.parse(options.body), message);
      assert.equal(
        options.headers['Idempotency-Key'],
        'solar-workflow-v1/' + job.id,
      );
      return Response.json({ id: 'fake-report-message-id' });
    });
    assert.equal(sends, 1);
    assert.deepEqual(result, {
      result: 'accepted',
      providerId: 'fake-report-message-id',
    });
  });
}
test('template escapes uploaded identifiers and uses canonical login URL, not supplied origin', () => {
  const m = renderMail({
    ...job,
    inspectionCode: '<script>alert(1)</script>\r\nBCC: attacker',
  });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
  assert.match(
    m.html,
    /https:\/\/solar-asset-care-demo\.kimminho0914\.chatgpt\.site/,
  );
});
test('reserved addresses and invalid recipients never reach provider', async () => {
  for (const email of [
    'a@example.invalid',
    'a@example.com',
    'a@unit.test',
    'a@localhost',
    'x\r\n@y.com',
  ]) {
    assert.equal(safeRecipient(email), false);
    await deliverMail({ ...job, email }, 'fake', () => {
      throw Error('Provider must not be called');
    });
  }
});
test('provider request has one recipient, stable idempotency key and abort timeout', async () => {
  let first;
  const http = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.ok(options.signal);
    assert.equal(
      options.headers['Idempotency-Key'],
      'solar-workflow-v1/' + job.id,
    );
    if (first) assert.equal(options.body, first);
    first = options.body;
    return Response.json({ id: 'fake-message-id' });
  };
  assert.deepEqual(await deliverMail(job, 'fake', http), {
    result: 'accepted',
    providerId: 'fake-message-id',
  });
  assert.deepEqual(await deliverMail(job, 'fake', http), {
    result: 'accepted',
    providerId: 'fake-message-id',
  });
});
test('only explicit rate limit permits delayed retry', async () => {
  assert.deepEqual(
    await deliverMail(
      job,
      'fake',
      async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '7200' } }),
    ),
    { result: 'failed' },
  );
  assert.deepEqual(
    await deliverMail(
      job,
      'fake',
      async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
    ),
    { result: 'rate_limited', retrySeconds: 120 },
  );
  assert.deepEqual(
    await deliverMail(
      job,
      'fake',
      async () => new Response('', { status: 429 }),
    ),
    { result: 'rate_limited', retrySeconds: 300 },
  );
});
test('ambiguous provider/network results never claim delivery or retry automatically', async () => {
  for (const status of [409, 500, 502, 503]) {
    assert.deepEqual(
      await deliverMail(job, 'fake', async () => new Response('', { status })),
      { result: 'unknown' },
    );
  }
  assert.deepEqual(
    await deliverMail(job, 'fake', async () => {
      throw Error('secret address/network error');
    }),
    { result: 'unknown' },
  );
  assert.deepEqual(
    await deliverMail(job, 'fake', async () => Response.json({})),
    { result: 'unknown' },
  );
});
test('permanent rejects are failures without leaking provider body', async () => {
  for (const status of [400, 401, 403, 422])
    assert.deepEqual(
      await deliverMail(
        job,
        'fake',
        async () => new Response('sensitive provider body', { status }),
      ),
      { result: 'failed' },
    );
});
test('worker denies missing/wrong/browser credentials before touching database', async () => {
  for (const auth of [
    undefined,
    'Bearer user-jwt',
    'Bearer sb_publishable_fake',
  ]) {
    const response = await handleWorkflowEmail(
      new Request('https://local.fixture', {
        method: 'POST',
        headers: auth ? { authorization: auth } : {},
      }),
      env,
      () => {
        throw Error('DB should not be called');
      },
    );
    assert.equal(response.status, 401);
  }
});
test('missing provider or invalid origin fails closed before claiming work', async () => {
  for (const missing of [
    'RESEND_WORKFLOW_API_KEY',
    'WORKFLOW_EMAIL_SITE_ORIGIN',
    'WORKFLOW_EMAIL_FROM',
  ]) {
    const response = await handleWorkflowEmail(
      request(),
      (name) => (name === missing ? undefined : vars[name]),
      () => {
        throw Error('DB should not be called');
      },
    );
    assert.equal(response.status, 503);
  }
  for (const origin of [
    'http://insecure.test',
    'https://site.test/path',
    'https://name:pass@site.test',
    'https://site.test/',
  ]) {
    assert.throws(() => mail.validateConfig({ ...config, origin }));
  }
});
test('worker only sends DB-supplied jobs and never trusts request recipients', async () => {
  let claimed = false,
    sends = 0,
    finished = 0;
  const response = await handleWorkflowEmail(
    request(),
    env,
    async (name, args) => {
      if (name === 'claim_workflow_emails') {
        const data = claimed ? [] : [job];
        claimed = true;
        return { data, error: null };
      }
      assert.equal(args.p_id, job.id);
      assert.equal(args.p_claim_token, job.claimToken);
      assert.equal(args.p_result, 'accepted');
      finished++;
      return { data: true, error: null };
    },
    async () => {
      sends++;
      return { result: 'accepted', providerId: 'fake-id' };
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1 });
  assert.equal(sends, 1);
  assert.equal(finished, 1);
});
test('uncertain result storage stops the worker without a second provider call', async () => {
  let sends = 0;
  const response = await handleWorkflowEmail(
    request(),
    env,
    async (name) =>
      name === 'claim_workflow_emails'
        ? { data: [job], error: null }
        : { data: null, error: { message: 'synthetic error' } },
    async () => {
      sends++;
      return { result: 'accepted', providerId: 'fake-id' };
    },
  );
  assert.equal(response.status, 503);
  assert.equal(sends, 1);
  assert.ok(!(await response.text()).includes('synthetic'));
});
test('worker bounds batches, stops on 429, and handles transport rejection', async () => {
  for (const result of ['accepted', 'rate_limited']) {
    let sends = 0;
    const response = await handleWorkflowEmail(
      request(),
      env,
      async (name) => ({
        data: name === 'claim_workflow_emails' ? [job] : true,
        error: null,
      }),
      async () => {
        sends++;
        return { result };
      },
    );
    assert.equal(response.status, 200);
    assert.equal(sends, result === 'accepted' ? 5 : 1);
  }
  const failed = await handleWorkflowEmail(request(), env, () => {
    throw Error('network secret');
  });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('secret'));
});
test('scheduled calls use expiring signed nonces; replay and tampering fail closed', async () => {
  const seen = new Set();
  let claims = 0;
  const rpc = async (name, args) => {
    if (name === 'accept_workflow_email_invocation') {
      if (seen.has(args.p_nonce)) return { data: false, error: null };
      seen.add(args.p_nonce);
      return { data: true, error: null };
    }
    claims++;
    return { data: [], error: null };
  };
  const nonce = randomUUID(),
    stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', vars.WORKFLOW_EMAIL_DISPATCH_SECRET)
    .update('POST:workflow-email:' + stamp + ':' + nonce)
    .digest('hex');
  const signed = (overrides = {}) =>
    new Request('https://local.fixture/worker', {
      method: 'POST',
      headers: {
        'x-workflow-timestamp': stamp,
        'x-workflow-nonce': nonce,
        'x-workflow-signature': signature,
        ...overrides,
      },
    });
  assert.equal((await handleWorkflowEmail(signed(), env, rpc)).status, 200);
  assert.equal((await handleWorkflowEmail(signed(), env, rpc)).status, 401);
  assert.equal(claims, 1);
  for (const overrides of [
    { 'x-workflow-signature': '0'.repeat(64) },
    { 'x-workflow-nonce': randomUUID() },
    { 'x-workflow-timestamp': String(Number(stamp) - 120) },
  ]) {
    const response = await handleWorkflowEmail(signed(overrides), env, () => {
      throw Error('unauthenticated DB call');
    });
    assert.equal(response.status, 401);
  }
});
