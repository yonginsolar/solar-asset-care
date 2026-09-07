// Explicit synthetic-account responsive QA. Credentials stay in environment
// variables and the script only accepts a local development origin.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(
  process.env.SOLAR_UI_QA_RUN,
  '1',
  'Responsive QA requires opt-in.',
);
const origin = process.env.SOLAR_UI_QA_ORIGIN || 'http://localhost:3000';
assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
assert.ok(process.env.SOLAR_UI_QA_EMAIL && process.env.SOLAR_UI_QA_PASSWORD);

const chromePath =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputDirectory = fileURLToPath(
  new URL('../work/mobile-qa/', import.meta.url),
);
mkdirSync(outputDirectory, { recursive: true });
const profileDirectory = mkdtempSync(join(tmpdir(), 'solar-mobile-qa-'));

const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function eventually(action, description, attempts = 120) {
  let lastError;
  for (let index = 0; index < attempts; index++) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`Timed out: ${description}`);
}

let socket;
try {
  await eventually(
    async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok,
    'Chrome startup',
  );
  const target = await (
    await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`,
      { method: 'PUT' },
    )
  ).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.text || 'Browser evaluation failed.',
      );
    return response.result.value;
  };
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 740,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await command('Page.navigate', { url: origin });
  await eventually(
    () => evaluate(`document.readyState === 'complete'`),
    'login page load',
  );
  await eventually(
    () => evaluate(`Boolean(document.querySelector('input[type="email"]'))`),
    'login form',
  );
  await evaluate(`(() => {
    const email = document.querySelector('input[type="email"]');
    const password = document.querySelector('input[type="password"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(email, ${JSON.stringify(process.env.SOLAR_UI_QA_EMAIL)});
    email.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(password, ${JSON.stringify(process.env.SOLAR_UI_QA_PASSWORD)});
    password.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(250);
  await evaluate(`(() => {
    const form = document.querySelector('input[type="email"]').form;
    const button = [...form.querySelectorAll('button')].find((item) => item.type === 'submit' && item.textContent.includes('로그인'));
    form.requestSubmit(button);
    return true;
  })()`);
  try {
    await eventually(
      () =>
        evaluate(
          `document.body.innerText.includes('운영 현황') && Boolean([...document.querySelectorAll('option')].find((item) => item.value === 'partners'))`,
        ),
      'administrator workspace',
    );
  } catch (error) {
    const visibleText = await evaluate(
      `document.body.innerText.replace(/acceptance-[^\\s]+/g, '[synthetic-account]').slice(0, 1000)`,
    );
    throw new Error(`${error.message}\nVisible page: ${visibleText}`);
  }
  await evaluate(`(() => {
    const menu = [...document.querySelectorAll('select')].find((item) =>
      [...item.options].some((option) => option.value === 'partners'));
    const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setValue.call(menu, 'partners');
    menu.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await eventually(
    () => evaluate(`document.body.innerText.includes('업체·견적 관리')`),
    'partner management view',
  );

  const results = [];
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
  ]) {
    await command('Emulation.setDeviceMetricsOverride', {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await delay(250);
    const metrics = await evaluate(`(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll('input, select, textarea, button, summary')].filter(visible);
      const name = (element) => element.getAttribute('aria-label') || element.title || element.textContent.trim() ||
        (element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]')?.textContent.trim()) ||
        element.closest('label')?.textContent.trim() || '';
      return {
        title: document.querySelector('h1')?.textContent.trim(),
        viewportWidth: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        outsideControlCount: controls.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > innerWidth + 0.5;
        }).length,
        unnamedControlCount: controls.filter((element) => !name(element)).length,
        visibleControlCount: controls.length,
      };
    })()`);
    assert.equal(metrics.title, '업체·견적 관리');
    assert.equal(metrics.horizontalOverflow, false);
    assert.equal(metrics.outsideControlCount, 0);
    assert.equal(metrics.unnamedControlCount, 0);
    const screenshot = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
    });
    const path = join(
      outputDirectory,
      `partner-management-${viewport.width}.png`,
    );
    writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
    results.push({ ...metrics, screenshot: path });
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  chrome.kill('SIGTERM');
  if (chrome.exitCode === null)
    await Promise.race([
      new Promise((resolve) => chrome.once('exit', resolve)),
      delay(2000),
    ]);
  rmSync(profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
