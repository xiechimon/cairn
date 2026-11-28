import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

type PollReply = { status: number; body: unknown };

interface DeviceServer {
  starts: number;
  polls: number;
  polledStates: string[];
  startDelayMs: number;
  startDelays: number[];
  pollDelayMs: number;
  inflightPolls: number;
  maxInflightPolls: number;
  startFails: boolean;
  nextPoll: PollReply[];
  completed: boolean;
}

const CODEX = '/api/teams/t1/providers/oauth/openai-codex/device';
const XAI = '/api/teams/t1/providers/oauth/xai/device';

async function serve(page: Page, base: string, server: DeviceServer) {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers') {
      return json({ canTestConnection: true, presets: [], providers: server.completed ? [signedIn(base)] : [] });
    }
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/model-routing') {
      return json({
        edges: [],
        connections: server.completed
          ? [{ id: 'prov-signed-in', vendor: 'openai', kind: 'subscription', models: ['gpt-6.1-sol'], available: true }]
          : [],
        quota: [],
      });
    }
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([]);
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
    if (path === base) {
      server.starts += 1;
      const attempt = server.starts;
      if (server.startFails) return json({ error: 'device start upstream refused' }, 502);
      return new Promise<void>((resolve) =>
        setTimeout(
          () =>
            resolve(
              json({
                state: `state-${attempt}`,
                userCode: `WXYZ-000${attempt}`,
                verificationUri: 'https://auth.example.test/device',
                intervalSeconds: 1,
              }),
            ),
          server.startDelays[attempt - 1] ?? server.startDelayMs,
        ),
      );
    }
    if (path === `${base}/poll`) {
      server.polledStates.push((route.request().postDataJSON() as { state: string }).state);
      server.polls += 1;
      const reply = server.nextPoll.shift() ?? { status: 200, body: { status: 'pending' } };
      if ((reply.body as { status?: string }).status === 'complete') server.completed = true;
      server.inflightPolls += 1;
      server.maxInflightPolls = Math.max(server.maxInflightPolls, server.inflightPolls);
      const delay = server.pollDelayMs;
      server.pollDelayMs = 0;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          server.inflightPolls -= 1;
          resolve(json(reply.body, reply.status));
        }, delay),
      );
    }
    return undefined;
  });
}

function device(overrides: Partial<DeviceServer> = {}): DeviceServer {
  return {
    starts: 0,
    polls: 0,
    polledStates: [],
    startDelayMs: 0,
    startDelays: [],
    pollDelayMs: 0,
    inflightPolls: 0,
    maxInflightPolls: 0,
    startFails: false,
    nextPoll: [],
    completed: false,
    ...overrides,
  };
}

function signedIn(base: string) {
  return {
    id: 'prov-signed-in',
    label: base === CODEX ? 'ChatGPT' : base === XAI ? 'xAI' : 'GitHub Copilot',
    kind: 'custom',
    providerId: base === CODEX ? 'openai-codex' : base === XAI ? 'xai' : 'github-copilot',
    baseUrl: 'https://provider.example.test',
    api: 'openai-responses',
    authHeader: false,
    compat: {},
    models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' }],
    createdBy: 'owner',
    createdAt: 1,
    updatedAt: 1,
  };
}

async function openPicker(page: Page) {
  await page.goto('/app/settings/routing');
  await page.getByTestId('routing-add-provider').click();
  const picker = page.getByRole('dialog', { name: '添加服务商' });
  await expect(picker).toBeVisible();
  return picker;
}

test('picking ChatGPT subscription opens one sign-in view: instruction, large code, copy, open, waiting, cancel', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = device({ startDelayMs: 400 });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();

  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('搜索服务商…')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('正在获取验证码…');
  await expect(dialog.getByTestId('device-sign-in-open')).toBeDisabled();
  const before = await dialog.getByTestId('device-sign-in').boundingBox();

  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
  const after = await dialog.getByTestId('device-sign-in').boundingBox();
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(4);
  await expect(dialog.getByText('打开登录页，输入下面的验证码。')).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('正在等你在浏览器里完成登录…');
  await expect(dialog.getByTestId('device-sign-in-open')).toBeEnabled();

  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('WXYZ-0001');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('复制', { timeout: 4000 });
  await dialog.getByTestId('sign-in-copy').click();
  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('已复制');
  await page.evaluate(() => navigator.clipboard.writeText('another clipboard value'));

  await page.evaluate(() => {
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    w.open = (url?: string | URL) => {
      w.__opened?.push(String(url));
      return null;
    };
  });
  await dialog.getByTestId('device-sign-in-open').click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened),
  ).toEqual(['https://auth.example.test/device']);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('WXYZ-0001');

  await expect.poll(() => server.polls).toBeGreaterThanOrEqual(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toBeVisible();
  const pollsAtCancel = server.polls;
  await page.waitForTimeout(2500);
  expect(server.polls).toBe(pollsAtCancel);
});

test('a completed sign-in closes the view and the new provider appears in the list', async ({ page }) => {
  const server = device({ nextPoll: [{ status: 200, body: { status: 'complete', created: true } }] });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  await expect(page.getByRole('dialog', { name: '登录 ChatGPT' })).toBeVisible();
  await expect(page.locator('[data-instance-id="provider:prov-signed-in"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '登录 ChatGPT' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toHaveCount(0);
  await expect(page.locator('[data-sonner-toast]')).toContainText('已添加服务商');
});

test('device sign-in on an existing provider reports connection, not addition', async ({ page }) => {
  const server = device({ completed: true, nextPoll: [{ status: 200, body: { status: 'complete', created: false } }] });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const toast = page.locator('[data-sonner-toast]');
  await expect(toast).toContainText('已连接服务商');
  await expect(toast).not.toContainText('已添加服务商');
});

test('OAuth return confirms the provider once and clears its result from the URL', async ({ page }) => {
  const server = device();
  await serve(page, 'oauth', server);
  const callback = '/app/settings/routing?oauth=connected&provider=github-copilot';
  await page.goto(callback);
  await expect(page).not.toHaveURL(/[?&]oauth=/);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  server.completed = true;
  await page.goto(callback);
  await expect(page.locator('[data-sonner-toast]')).toContainText('已连接服务商');
  await expect(page).not.toHaveURL(/[?&]oauth=/);
  await page.reload();
  await expect(page.getByTestId('routing-add-provider')).toBeVisible();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

test('ChatGPT model picker reports the first failure plainly and loads selectable options on retry', async ({ page }) => {
  await serve(page, CODEX, device({ completed: true }));
  let calls = 0;
  await page.route('**/providers/prov-signed-in/upstream-models', (route) => {
    calls += 1;
    return route.fulfill({ json: calls === 1
      ? { status: 'failed', failure: 'auth', httpStatus: 401 }
      : { status: 'ok', models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }] } });
  });
  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="provider:prov-signed-in"]').click();
  await page.getByRole('button', { name: '从上游选择' }).click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-error')).not.toContainText('第 0 次刷新');
  await expect(picker.getByRole('alert')).toContainText('请重新登录后重试');
  await expect(picker).toContainText('/backend-api/codex/models');
  await picker.getByRole('button', { name: '重试' }).click();
  const row = picker.locator('[data-model-id="gpt-6.2-sol"]');
  await row.click();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await expect(picker.getByRole('status')).toContainText('第 1 次刷新');
});

test('provider removal shows an error on refusal and success after confirmation', async ({ page }) => {
  const server = device({ completed: true });
  await serve(page, CODEX, server);
  let calls = 0;
  await page.route('**/providers/prov-signed-in', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    if (++calls === 1) return route.fulfill({ status: 409, json: { error: 'cannot remove yet' } });
    server.completed = false;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/app/settings/routing');
  await page.locator('[data-instance-id="provider:prov-signed-in"]').click();
  const remove = async () => {
    await page.getByTestId('provider-editor').getByRole('button', { name: '移除', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: '移除', exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await remove();
  const toasts = page.locator('[data-sonner-toast]');
  await expect(toasts).toContainText(['移除失败，请重试。']);
  await remove();
  await expect(toasts.filter({ hasText: '已移除服务商' })).toHaveCount(1);
  await expect(page.locator('[data-instance-id="provider:prov-signed-in"]')).toHaveCount(0);
});

const evidenceDir = process.env.PROVIDER_EVIDENCE_DIR;
if (evidenceDir !== undefined) {
  for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
    test(`provider fixture screenshots at ${width}px in ${theme}`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const capture = async (state: string) => {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${evidenceDir}/fixture-${width}-${theme}-${state}.png`, animations: 'disabled' });
      };
      const server = device({ startDelayMs: 1600 });
      await serve(page, CODEX, server);
      let succeed = false;
      let settle!: () => void;
      const loading = new Promise<void>((resolve) => { settle = resolve; });
      await page.route('**/providers/prov-signed-in/upstream-models', async (route) => {
        await loading;
        await route.fulfill({ json: succeed
          ? { status: 'ok', models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }, { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }] }
          : { status: 'failed', failure: 'not-found', httpStatus: 404 } });
      });
      const picker = await openPicker(page);
      const choose = () => picker.locator('[data-preset-id="openai-codex"]').click();
      await choose();
      const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
      await expect(dialog.getByText('正在获取验证码…')).toBeVisible();
      await capture('login-waiting');
      await expect(dialog.getByTestId('sign-in-copy')).toHaveText('已复制');
      await capture('code-copied');
      server.nextPoll.push({ status: 200, body: { status: 'expired' } });
      await expect(dialog.getByRole('alert')).toBeVisible();
      await capture('login-failed');
      server.startDelayMs = 0;
      server.nextPoll.push({ status: 200, body: { status: 'complete', created: true } });
      await dialog.getByTestId('device-sign-in-restart').click();
      await expect(page.locator('[data-sonner-toast]')).toContainText('已添加服务商');
      await capture('success-toast');
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
      await page.locator('[data-instance-id="provider:prov-signed-in"]').click();
      await page.getByRole('button', { name: '从上游选择' }).click();
      await expect(page.getByTestId('upstream-loading')).toBeVisible();
      await capture('picker-loading');
      settle();
      await expect(page.getByTestId('upstream-error')).toBeVisible();
      await capture('picker-failed');
      await page.keyboard.press('Escape');
      succeed = true;
      await page.getByRole('button', { name: '从上游选择' }).click();
      await expect(page.getByTestId('upstream-model')).toHaveCount(3);
      await capture('picker-loaded');
    });
  }
}

test('a lost sign-in (poll 404) stops polling, says so in the view and raises no toast', async ({
  page,
}) => {
  const server = device({
    nextPoll: [{ status: 404, body: { error: 'Codex device login not found' } }],
  });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByRole('alert')).toHaveText('登录已过期，请重新开始');
  await page.waitForTimeout(2500);
  expect(server.polls).toBe(1);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByText('Codex device login not found')).toHaveCount(0);

  await dialog.getByTestId('device-sign-in-restart').click();
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0002');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('a failed start says it could not get a code, raises no toast, and Start over retries', async ({
  page,
}) => {
  const server = device({ startFails: true });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByRole('alert')).toHaveText('获取验证码失败，请重新开始。');
  await expect(dialog.getByTestId('sign-in-code')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  server.startFails = false;
  await dialog.getByTestId('device-sign-in-restart').click();
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0002');
});

for (const [status, line] of [
  ['denied', 'ChatGPT 登录被拒绝。'],
  ['expired', '验证码已过期，请重新开始。'],
  ['superseded', '已有更新的 ChatGPT 凭证，这次登录没有覆盖它。'],
] as const) {
  test(`a ${status} sign-in shows its sentence, greys the code and offers Start over`, async ({
    page,
  }) => {
    const server = device({ nextPoll: [{ status: 200, body: { status } }] });
    await serve(page, CODEX, server);
    const picker = await openPicker(page);
    await picker.locator('[data-preset-id="openai-codex"]').click();
    const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
    await expect(dialog.getByRole('alert')).toHaveText(line);
    await expect(dialog.getByTestId('sign-in-code')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(dialog.getByTestId('sign-in-copy')).toHaveCount(0);
    await expect(dialog.getByTestId('device-sign-in-restart')).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
}

test('Escape while waiting returns to the picker and stops polling', async ({ page }) => {
  const server = device();
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toBeVisible();
  const pollsAtCancel = server.polls;
  await page.waitForTimeout(2500);
  expect(server.polls).toBe(pollsAtCancel);
});

test('xAI sign-in uses the same view and Cancel returns to the xAI form with its draft kept', async ({
  page,
}) => {
  const server = device();
  await serve(page, XAI, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="xai"]').click();
  await picker.locator('#dlg-provider-apikey').fill('xai-draft-key');
  await picker.getByRole('button', { name: '用 SuperGrok 或 X Premium 登录' }).click();

  const dialog = page.getByRole('dialog', { name: '登录 xAI' });
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
  await expect(dialog.getByTestId('sign-in-copy')).toBeVisible();
  await expect(dialog.getByTestId('device-sign-in-open')).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  const form = page.getByRole('dialog', { name: '添加服务商' });
  await expect(form.locator('#dlg-provider-apikey')).toHaveValue('xai-draft-key');
});

test('a completed xAI sign-in closes the view', async ({ page }) => {
  const server = device({ nextPoll: [{ status: 200, body: { status: 'complete' } }] });
  await serve(page, XAI, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="xai"]').click();
  await picker.getByRole('button', { name: '用 SuperGrok 或 X Premium 登录' }).click();
  await expect(page.getByRole('dialog', { name: '登录 xAI' })).toBeVisible();
  await expect(page.locator('[data-instance-id="provider:prov-signed-in"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '登录 xAI' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toHaveCount(0);
  expect(server.starts).toBe(1);
});

test('cancelling while the code is still coming, then picking again, runs one poll loop for the new code only', async ({
  page,
}) => {
  const server = device({ startDelays: [2500, 100], pollDelayMs: 2500 });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByRole('status')).toHaveText('正在获取验证码…');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await picker.locator('[data-preset-id="openai-codex"]').click();
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0002');
  await page.waitForTimeout(5000);
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0002');
  expect(server.starts).toBe(2);
  expect(server.polledStates.length).toBeGreaterThanOrEqual(2);
  expect(server.polledStates.length).toBeLessThanOrEqual(4);
  expect(new Set(server.polledStates)).toEqual(new Set(['state-2']));
  expect(server.maxInflightPolls).toBe(1);
});

test('a refused clipboard never shows Copied and says the copy failed', async ({ page }) => {
  await serve(page, CODEX, device());
  await page.addInitScript(() => {
    window.open = () => {
      document.documentElement.dataset.loginOpened = 'yes';
      return null;
    };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => {
        const data = document.documentElement.dataset;
        data.copyAttempts = String(Number(data.copyAttempts ?? '0') + 1);
        return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      } },
    });
  });
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
  await expect(page.locator('html')).toHaveAttribute('data-copy-attempts', '1');
  await dialog.getByTestId('device-sign-in-open').click();
  await expect(page.locator('html')).toHaveAttribute('data-copy-attempts', '2');
  await expect(page.locator('html')).toHaveAttribute('data-login-opened', 'yes');
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await dialog.getByTestId('sign-in-copy').click();
  await expect(page.locator('[data-sonner-toast]')).toContainText('复制失败，请重试。');
  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('复制');
});

test('at 390 px the sign-in view fits the window with the code and both buttons visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page, CODEX, device());
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
  const box = await dialog.boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await expect(dialog.getByTestId('device-sign-in-open')).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('the code row keeps the height of its loading placeholder', async ({ page }) => {
    const server = device({ startDelayMs: 600 });
    await serve(page, CODEX, server);
    const picker = await openPicker(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await picker.locator('[data-preset-id="openai-codex"]').click();
    const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
    await expect(dialog.getByRole('status')).toHaveText('正在获取验证码…');
    const before = await dialog.getByTestId('device-sign-in').boundingBox();
    await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
    const after = await dialog.getByTestId('device-sign-in').boundingBox();
    expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(4);
  });
});
