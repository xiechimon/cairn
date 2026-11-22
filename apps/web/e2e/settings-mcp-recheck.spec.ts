import { expect, type Page, test } from '@playwright/test';
import type { McpConnectorRecord } from '@cairn/shared';
import { mockLive } from './chief-home-mock';

const SHOTS = process.env.MCP_RECHECK_SHOTS;
const SCHEME = process.env.MCP_RECHECK_SCHEME === 'light' ? 'light' : 'dark';
const WIDTH = Number(process.env.MCP_RECHECK_WIDTH ?? 1440);

test.use({
  colorScheme: SCHEME,
  viewport: { width: WIDTH, height: WIDTH < 500 ? 812 : 732 },
});

const NOW = Date.now();

const record = (fields: Partial<McpConnectorRecord> = {}): McpConnectorRecord => ({
  id: 'mcp-context7',
  teamId: 't1',
  slug: 'context7',
  label: 'Context7',
  catalogId: 'context7',
  transport: 'http',
  url: 'https://mcp.context7.com/mcp',
  headerNames: [],
  authKind: 'none',
  account: null,
  status: 'connected',
  statusReason: null,
  toolCount: 2,
  checkedAt: NOW - 3_600_000,
  createdAt: NOW - 86_400_000,
  updatedAt: NOW - 3_600_000,
  ...fields,
});

interface Reply {
  next: McpConnectorRecord | 'error';
  gate: Promise<void> | null;
}

const FAILING = record({ status: 'error', statusReason: 'timeout', toolCount: null });
const CUSTOM = record({
  id: 'mcp-example',
  slug: 'example',
  label: 'Example',
  catalogId: null,
  url: 'https://mcp.example.com/mcp',
});

async function open(
  page: Page,
  replies: { check?: Reply; patch?: Reply },
  initial = record(),
  patches: unknown[] = [],
) {
  const base = `/api/teams/t1/mcp-connectors/${initial.id}`;
  const answer = async (reply: Reply | undefined, json: (body: unknown, status?: number) => unknown) => {
    if (reply === undefined) return json({ error: 'unexpected' }, 500);
    if (reply.gate !== null) await reply.gate;
    if (reply.next === 'error') return json({ error: 'boom' }, 500);
    return json({ ...reply.next, checkedAt: Date.now() });
  };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/mcp-connectors') return json([initial]);
    if (path === '/api/teams/t1/mcp-connectors/github')
      return json({ available: false, installUrl: null, connectionReady: false });
    if (path === '/api/teams/t1/mcp-connectors/composio') return json({ configured: false, apps: [] });
    if (path === '/api/teams/t1/mail/accounts') return json({ accounts: [] });
    if (path === `${base}/check` && method === 'POST') return answer(replies.check, json);
    if (path === base && method === 'PATCH') {
      patches.push(route.request().postDataJSON());
      return answer(replies.patch, json);
    }
    return undefined;
  });
  await page.goto('/app/resources/mcp-servers');
  await page.getByRole('button', { name: `管理 ${initial.label}` }).click();
  const dialog = page.getByRole('dialog', { name: initial.label });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  return dialog;
}

const result = (page: Page) => page.getByTestId('mcp-recheck-result');
const button = (page: Page, name: string, label = 'Context7') =>
  page.getByRole('dialog', { name: label }).getByRole('button', { name, exact: true });
const fieldTop = async (page: Page, url = 'https://mcp.context7.com/mcp') =>
  (await page.getByRole('dialog').first().getByText(url).boundingBox())?.y;

async function shot(page: Page, name: string) {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${SCHEME}-${WIDTH}-${name}.png` });
}

test('a connected, healthy connector offers no recheck and no reconnect', async ({ page }) => {
  const dialog = await open(page, {});
  await expect(dialog).toContainText('已连接 · 2 个工具');
  await expect(button(page, '重新检查')).toHaveCount(0);
  await expect(button(page, '重新连接')).toHaveCount(0);
  await expect(button(page, '保存')).toHaveCount(0);
  await expect(button(page, '完成')).toBeVisible();
  await shot(page, 'healthy');
  await dialog.getByLabel('API 密钥（可选）').fill('ctx7-new-key');
  await expect(button(page, '保存')).toBeEnabled();
});

test('C22: saving a new key re-verifies and reports loading then success in the popover on Save', async ({
  page,
}) => {
  let release = () => {};
  const patches: unknown[] = [];
  const dialog = await open(
    page,
    { patch: { next: record(), gate: new Promise((done) => (release = done)) } },
    record(),
    patches,
  );
  await dialog.getByLabel('API 密钥（可选）').fill('ctx7-new-key');
  await button(page, '保存').click();
  await expect(result(page)).toHaveAttribute('data-phase', 'checking');
  await expect(result(page)).toContainText('正在检查 Context7 能不能连上…');
  await expect(button(page, '保存')).toBeDisabled();
  await shot(page, 'save-loading');
  release();
  await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  await expect(result(page)).toContainText('Context7 回应了，能用。');
  expect(patches).toEqual([{ token: 'ctx7-new-key' }]);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('API 密钥（可选）')).toHaveValue('');

  await page.keyboard.press('Escape');
  await expect(result(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(button(page, '完成')).toBeFocused();
});

test('C22: a rejected key after Save fails in the popover, not inline', async ({ page }) => {
  const dialog = await open(page, {
    patch: { next: record({ status: 'error', statusReason: 'unauthorized', toolCount: null }), gate: null },
  });
  const before = await fieldTop(page);
  await dialog.getByLabel('API 密钥（可选）').fill('ctx7-bad-key');
  await button(page, '保存').click();
  await expect(result(page)).toHaveAttribute('data-phase', 'failed');
  await expect(result(page)).toContainText('Context7 拒绝了这个令牌。');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await fieldTop(page)).toBe(before);
  await expect(button(page, '重新连接')).toBeVisible();
  await shot(page, 'save-failed');
});

test('C22: editing a custom server URL saves it and re-verifies in the popover', async ({ page }) => {
  const patches: unknown[] = [];
  const dialog = await open(
    page,
    { patch: { next: { ...CUSTOM, url: 'https://mcp.example.com/v2' }, gate: null } },
    CUSTOM,
    patches,
  );
  const url = dialog.getByLabel('地址', { exact: true });
  await expect(button(page, '保存', 'Example')).toHaveCount(0);
  await url.fill('https://mcp.example.com/v2');
  await button(page, '保存', 'Example').click();
  await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  await expect(result(page)).toContainText('Example 回应了，能用。');
  expect(patches).toEqual([{ url: 'https://mcp.example.com/v2' }]);
});

test('C22: a failing connector reconnects from its primary button, reports in the popover, and Esc returns focus', async ({
  page,
}) => {
  let release = () => {};
  const dialog = await open(
    page,
    { check: { next: record(), gate: new Promise((done) => (release = done)) } },
    FAILING,
  );
  const before = await fieldTop(page);
  await expect(button(page, '重新检查')).toHaveCount(0);
  const reconnect = button(page, '重新连接');
  await expect(reconnect).toBeVisible();
  await shot(page, 'failing');

  await reconnect.click();
  await expect(result(page)).toHaveAttribute('data-phase', 'checking');
  await expect(result(page).locator('[data-slot="spinner"]')).toHaveCount(1);
  await expect(reconnect).toBeDisabled();
  expect(await fieldTop(page)).toBe(before);
  await shot(page, 'reconnect-loading');

  release();
  await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  await expect(result(page)).toContainText('Context7 回应了，能用。');
  await expect(result(page)).toContainText('tools/list');
  await expect(dialog).toContainText('已连接 · 2 个工具');
  expect(await fieldTop(page)).toBe(before);
  await shot(page, 'reconnected');

  await page.keyboard.press('Escape');
  await expect(result(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(button(page, '完成')).toBeFocused();
  await expect(button(page, '重新连接')).toHaveCount(0);
});

const FAILURES: { reason: string; text: string }[] = [
  { reason: 'unauthorized', text: 'Context7 拒绝了这个令牌。检查令牌是否填对、有没有过期，然后换一个新的。' },
  { reason: 'forbidden', text: '令牌有效，但权限不够。给令牌加上需要的权限后重新连接。' },
  { reason: 'timeout', text: 'Context7 10 秒内没有响应。稍后重新连接。' },
  { reason: 'unreachable', text: '连不上这个地址。检查地址是否正确、服务器是否在线。' },
  { reason: 'refresh_failed', text: '刷新 Context7 的授权时出错，稍后重新连接。' },
  { reason: 'upstream', text: 'Context7 返回了错误。稍后重新连接。' },
];

for (const { reason, text } of FAILURES) {
  test(`C22: a ${reason} reconnect fails in the popover without moving the form`, async ({ page }) => {
    const dialog = await open(
      page,
      { check: { next: record({ status: 'error', statusReason: reason, toolCount: null }), gate: null } },
      FAILING,
    );
    const before = await fieldTop(page);

    await button(page, '重新连接').click();
    await expect(result(page)).toHaveAttribute('data-phase', 'failed');
    await expect(result(page)).toContainText(text);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByText(text)).toHaveCount(0);
    expect(await fieldTop(page)).toBe(before);
    if (reason === 'unauthorized') await shot(page, 'reconnect-failed');

    await dialog.getByRole('heading', { name: 'Context7' }).click();
    await expect(result(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '连不上' }).click();
    await expect(result(page)).toContainText(text);
    expect(await fieldTop(page)).toBe(before);
  });
}

test('C22: a reconnect request that does not finish says so in the popover', async ({ page }) => {
  const dialog = await open(page, { check: { next: 'error', gate: null } }, FAILING);
  const before = await fieldTop(page);
  await button(page, '重新连接').click();
  await expect(result(page)).toHaveAttribute('data-phase', 'failed');
  await expect(result(page)).toContainText('没能完成检查，稍后重试。');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await fieldTop(page)).toBe(before);
});

test('a connector opened in error shows its cause from the status, not inline', async ({ page }) => {
  const text = 'Context7 10 秒内没有响应。稍后重新连接。';
  const dialog = await open(page, {}, FAILING);
  await expect(dialog.getByText(text)).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: '连不上' }).click();
  await expect(result(page)).toContainText(text);
});
