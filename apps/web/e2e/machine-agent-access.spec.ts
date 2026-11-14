import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive } from './chief-home-mock';

const computer = (patch: Record<string, unknown> = {}) => ({
  id: 'comp-1',
  scopeKey: 'private:u1',
  state: 'running',
  controlHolder: 'none',
  browserEnabled: false,
  handoffReason: null,
  machine: { id: 'm1', name: 'omarchy', online: true },
  ...patch,
});

const MACHINE = {
  id: 'm1',
  name: 'omarchy',
  online: true,
  teamId: 't1',
  latestCliVersion: null,
  kind: 'remote',
  enabledRuntimes: ['pi'],
  providers: [],
  runningSteps: 0,
  capabilities: { browser: true, mcpServers: [], skills: [] },
};

async function open(page: Page, computers: unknown[], machines: unknown[] = [MACHINE]) {
  let rows = computers;
  let leases = 0;
  await mockLive(page, { threads: [], messages: HISTORY, machines }, (path, route, json) => {
    if (path === '/api/computers' && route.request().method() === 'GET') {
      return json({ computers: rows });
    }
    if (path === '/api/computers/comp-1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { browserEnabled?: boolean };
      const updated = { ...computer(), browserEnabled: body.browserEnabled === true };
      rows = [updated];
      return json({ computer: updated });
    }
    if (path === '/api/teams/t1/computers/comp-1/control') {
      if (route.request().method() === 'DELETE') {
        const body = route.request().postDataJSON() as { leaseId?: string };
        if (body.leaseId !== `lease-${leases}`) return json({ error: 'stale lease' }, 409);
        rows = [computer({ controlHolder: 'none' })];
        return json({ released: true });
      }
      leases += 1;
      rows = [computer({ controlHolder: 'user' })];
      return json(
        { leaseId: `lease-${leases}`, expiresAt: Date.now() + 60_000, controlFence: leases },
        201,
      );
    }
    return undefined;
  });
  await page.goto('/app/settings/machines?machine=m1');
  return page.getByTestId('machine-agent-access');
}

test('the machine settings hold only the browser switch and it writes through', async ({
  page,
}) => {
  const access = await open(page, [computer()]);
  await expect(access.getByRole('heading', { name: 'Agent 的权限' })).toBeVisible();
  const browser = access.getByRole('switch', { name: '浏览器' });
  await expect(access.getByRole('switch')).toHaveCount(1);
  await expect(browser).toBeEnabled();
  await expect(browser).not.toBeChecked();
  await browser.click();
  await expect(browser).toBeChecked();
});

test('without a computer row the browser switch still enables the first computer', async ({
  page,
}) => {
  const access = await open(page, []);
  await expect(access.getByRole('switch')).toHaveCount(1);
  await expect(access.getByRole('switch', { name: '浏览器' })).toBeEnabled();
});

test('a machine that reports no browser keeps the browser switch disabled', async ({ page }) => {
  const access = await open(page, [], [{ ...MACHINE, capabilities: { mcpServers: [], skills: [] } }]);
  await expect(access.getByRole('switch', { name: '浏览器' })).toBeDisabled();
  const reason = '这台机器还不支持浏览器。';
  await access.getByRole('button', { name: reason }).focus();
  await page.keyboard.press(' ');
  await expect(page.locator('[data-sonner-toast]', { hasText: reason })).toBeVisible();
});

test('a mac that denies accessibility and screen recording shows one guidance row per permission', async ({
  page,
}) => {
  const access = await open(page, [computer()], [
    {
      ...MACHINE,
      capabilities: {
        browser: true,
        mcpServers: [],
        skills: [],
        osPlatform: 'darwin',
        hostPermissions: {
          accessibility: 'denied',
          automation: 'granted',
          screenRecording: 'denied',
        },
      },
    },
  ]);
  await expect(access.getByTestId('machine-permission-accessibility')).toHaveText('辅助功能未授予');
  await expect(access.getByTestId('machine-permission-screen-recording')).toHaveText(
    '屏幕录制未授予',
  );
  await expect(access.locator('[data-settings-label="辅助功能未授予"]')).toContainText(
    '隐私与安全性',
  );
  await expect(access.locator('[data-settings-label="屏幕录制未授予"]')).toContainText(
    '隐私与安全性',
  );
  await expect(access.getByTestId('machine-permission-accessibility')).toHaveCount(1);
  await expect(access.getByRole('switch')).toHaveCount(1);
});

test('a linux machine without an accessibility bus shows the AT-SPI hint', async ({ page }) => {
  const access = await open(page, [computer()], [
    {
      ...MACHINE,
      capabilities: {
        browser: true,
        mcpServers: [],
        skills: [],
        osPlatform: 'linux',
        hostPermissions: {
          accessibility: 'unknown',
          automation: 'granted',
          screenRecording: 'not_required',
        },
      },
    },
  ]);
  await expect(access.getByTestId('machine-permission-accessibility')).toHaveText(
    '桌面辅助通道不可用',
  );
  await expect(access.locator('[data-settings-label="桌面辅助通道不可用"]')).toContainText(
    'AT-SPI',
  );
  await expect(access.getByTestId('machine-permission-screen-recording')).toHaveCount(0);
});

test('a machine with all permissions granted or not required renders no guidance rows', async ({
  page,
}) => {
  const access = await open(page, [computer()], [
    {
      ...MACHINE,
      capabilities: {
        browser: true,
        mcpServers: [],
        skills: [],
        osPlatform: 'darwin',
        hostPermissions: {
          accessibility: 'granted',
          automation: 'granted',
          screenRecording: 'not_required',
        },
      },
    },
  ]);
  await expect(access.getByTestId('machine-permission-accessibility')).toHaveCount(0);
  await expect(access.getByTestId('machine-permission-screen-recording')).toHaveCount(0);
});

