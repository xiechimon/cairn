import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

type PollReply = { status: number; body: unknown };

interface DeviceServer {
  starts: number;
  polls: number;
  polledStates: string[];
  startDelayMs: number;
  startFails: boolean;
  nextPoll: PollReply[];
  completed: boolean;
}

const CODEX = '/api/teams/t1/providers/oauth/openai-codex/device';
const XAI = '/api/teams/t1/providers/oauth/xai/device';

async function serve(page: Page, base: string, server: DeviceServer) {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers') {
      return json({ presets: [], providers: server.completed ? [signedIn(base)] : [] });
    }
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/model-routing') {
      return json({
        edges: [],
        connections: server.completed
          ? [{ id: 'prov-signed-in', vendor: 'openai', kind: 'subscription', models: ['m-1'], available: true }]
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
          server.startDelayMs,
        ),
      );
    }
    if (path === `${base}/poll`) {
      server.polledStates.push((route.request().postDataJSON() as { state: string }).state);
      server.polls += 1;
      const reply = server.nextPoll.shift() ?? { status: 200, body: { status: 'pending' } };
      if ((reply.body as { status?: string }).status === 'complete') server.completed = true;
      return json(reply.body, reply.status);
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
    startFails: false,
    nextPoll: [],
    completed: false,
    ...overrides,
  };
}

function signedIn(base: string) {
  return {
    id: 'prov-signed-in',
    label: base === CODEX ? 'ChatGPT' : 'xAI',
    kind: 'custom',
    providerId: base === CODEX ? 'openai-codex' : 'xai',
    baseUrl: 'https://provider.example.test',
    api: 'openai-responses',
    authHeader: false,
    compat: {},
    models: [{ id: 'm-1', name: 'Model One' }],
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

  await dialog.getByTestId('sign-in-copy').click();
  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('WXYZ-0001');
  await expect(dialog.getByTestId('sign-in-copy')).toHaveText('复制', { timeout: 4000 });

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

  await expect.poll(() => server.polls).toBeGreaterThanOrEqual(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toBeVisible();
  const pollsAtCancel = server.polls;
  await page.waitForTimeout(2500);
  expect(server.polls).toBe(pollsAtCancel);
});

test('a completed sign-in closes the view and the new provider appears in the list', async ({ page }) => {
  const server = device({ nextPoll: [{ status: 200, body: { status: 'complete' } }] });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  await expect(page.getByRole('dialog', { name: '登录 ChatGPT' })).toBeVisible();
  await expect(page.locator('[data-instance-id="provider:prov-signed-in"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: '登录 ChatGPT' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '添加服务商' })).toHaveCount(0);
});

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
  await expect(dialog.getByRole('alert')).toHaveText('没能拿到验证码，请重新开始。');
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
  const server = device({ startDelayMs: 800 });
  await serve(page, CODEX, server);
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByRole('status')).toHaveText('正在获取验证码…');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await picker.locator('[data-preset-id="openai-codex"]').click();
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0002');
  await page.waitForTimeout(3500);
  expect(server.starts).toBe(2);
  expect(server.polledStates.length).toBeGreaterThanOrEqual(1);
  expect(server.polledStates.length).toBeLessThanOrEqual(4);
  expect(new Set(server.polledStates)).toEqual(new Set(['state-2']));
});

test('a refused clipboard never shows Copied and says the copy failed', async ({ page }) => {
  await serve(page, CODEX, device());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
  });
  const picker = await openPicker(page);
  await picker.locator('[data-preset-id="openai-codex"]').click();
  const dialog = page.getByRole('dialog', { name: '登录 ChatGPT' });
  await expect(dialog.getByTestId('sign-in-code')).toHaveText('WXYZ-0001');
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
