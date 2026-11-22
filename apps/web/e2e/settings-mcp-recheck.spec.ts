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

interface Check {
  next: McpConnectorRecord | 'error';
  gate: Promise<void> | null;
}

async function open(page: Page, check: Check, initial = record()) {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/mcp-connectors') return json([initial]);
    if (path === '/api/teams/t1/mcp-connectors/github')
      return json({ available: false, installUrl: null, connectionReady: false });
    if (path === '/api/teams/t1/mcp-connectors/composio') return json({ configured: false, apps: [] });
    if (path === '/api/teams/t1/mail/accounts') return json({ accounts: [] });
    if (path === '/api/teams/t1/mcp-connectors/mcp-context7/check' && method === 'POST')
      return (async () => {
        if (check.gate !== null) await check.gate;
        if (check.next === 'error') return json({ error: 'boom' }, 500);
        return json({ ...check.next, checkedAt: Date.now() });
      })();
    if (path === '/api/teams/t1/mcp-connectors/mcp-context7' && method === 'PATCH')
      return json(record({ status: 'error', statusReason: 'unauthorized', toolCount: null }));
    return undefined;
  });
  await page.goto('/app/resources/mcp-servers');
  await page.getByRole('button', { name: '管理 Context7' }).click();
  const dialog = page.getByRole('dialog', { name: 'Context7' });
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  return dialog;
}

const result = (page: Page) => page.getByTestId('mcp-recheck-result');
const recheck = (page: Page) =>
  page.getByRole('dialog', { name: 'Context7' }).getByRole('button', { name: '重新检查' });
const fieldTop = async (page: Page) =>
  (await page.getByRole('dialog', { name: 'Context7' }).getByText('https://mcp.context7.com/mcp').boundingBox())?.y;

async function shot(page: Page, name: string) {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${SCHEME}-${WIDTH}-${name}.png` });
}

test('C22: Recheck reports loading then success in a popover on the button, and Esc returns focus', async ({
  page,
}) => {
  let release = () => {};
  const check: Check = { next: record(), gate: new Promise((done) => (release = done)) };
  const dialog = await open(page, check);
  const before = await fieldTop(page);

  await recheck(page).click();
  await expect(result(page)).toHaveAttribute('data-phase', 'checking');
  await expect(result(page)).toContainText('正在检查 Context7 能不能连上…');
  await expect(result(page).locator('[data-slot="spinner"]')).toHaveCount(1);
  await expect(recheck(page)).toBeDisabled();
  expect(await fieldTop(page)).toBe(before);
  await shot(page, 'loading');

  release();
  await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  await expect(result(page)).toContainText('Context7 回应了，能用。');
  await expect(result(page)).not.toContainText('已连接');
  await expect(dialog).toContainText('已连接 · 2 个工具');
  expect(await fieldTop(page)).toBe(before);
  await shot(page, 'connected');

  await page.keyboard.press('Escape');
  await expect(result(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(recheck(page)).toBeFocused();
  await shot(page, 'esc-focus');
});

const FAILURES: { reason: string; text: string }[] = [
  { reason: 'unauthorized', text: 'Context7 拒绝了这个令牌。检查令牌是否填对、有没有过期，然后换一个新的。' },
  { reason: 'forbidden', text: '令牌有效，但权限不够。给令牌加上需要的权限后重新检查。' },
  { reason: 'timeout', text: 'Context7 10 秒内没有响应。稍后重新检查。' },
  { reason: 'unreachable', text: '连不上这个地址。检查地址是否正确、服务器是否在线。' },
  { reason: 'refresh_failed', text: '刷新 Context7 的授权时出错，稍后重新检查。' },
  { reason: 'upstream', text: 'Context7 返回了错误。稍后重新检查。' },
];

for (const { reason, text } of FAILURES) {
  test(`C22: a ${reason} Recheck fails in the popover without moving the form`, async ({ page }) => {
    const check: Check = {
      next: record({ status: 'error', statusReason: reason, toolCount: null }),
      gate: null,
    };
    const dialog = await open(page, check);
    const before = await fieldTop(page);

    await recheck(page).click();
    await expect(result(page)).toHaveAttribute('data-phase', 'failed');
    await expect(result(page)).toContainText(text);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByText(text)).toHaveCount(0);
    expect(await fieldTop(page)).toBe(before);
    if (reason === 'unauthorized') await shot(page, 'failed');

    await dialog.getByRole('heading', { name: 'Context7' }).click();
    await expect(result(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: '连不上' }).click();
    await expect(result(page)).toContainText(text);
    expect(await fieldTop(page)).toBe(before);
  });
}

test('C22: a Recheck request that does not finish says so in the popover', async ({ page }) => {
  const dialog = await open(page, { next: 'error', gate: null });
  const before = await fieldTop(page);
  await recheck(page).click();
  await expect(result(page)).toHaveAttribute('data-phase', 'failed');
  await expect(result(page)).toContainText('没能完成检查，稍后重试。');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await fieldTop(page)).toBe(before);
});

test('a connector opened in error shows its cause from the status, not inline', async ({ page }) => {
  const text = 'Context7 10 秒内没有响应。稍后重新检查。';
  const dialog = await open(
    page,
    { next: record(), gate: null },
    record({ status: 'error', statusReason: 'timeout', toolCount: null }),
  );
  await expect(dialog.getByText(text)).toHaveCount(0);
  await expect(result(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: '连不上' }).click();
  await expect(result(page)).toContainText(text);
});

test('保存并检查 keeps its inline result', async ({ page }) => {
  const dialog = await open(page, { next: record(), gate: null });
  await dialog.getByLabel('API 密钥（可选）').fill('ctx7-new-key');
  await dialog.getByRole('button', { name: '保存并检查' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Context7 拒绝了这个令牌。');
  await expect(result(page)).toHaveCount(0);
});
