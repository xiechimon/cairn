import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive } from './chief-home-mock';

const computer = (patch: Record<string, unknown> = {}) => ({
  id: 'comp-1',
  scopeKey: 'private:u1',
  state: 'running',
  controlHolder: 'none',
  browserEnabled: false,
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

test('the machine settings hold the browser and desktop switches and both write through', async ({
  page,
}) => {
  const access = await open(page, [computer()]);
  await expect(access.getByRole('heading', { name: 'Agent 的权限' })).toBeVisible();
  const browser = access.getByRole('switch', { name: '浏览器' });
  const desktop = access.getByRole('switch', { name: '桌面控制' });
  await expect(browser).toBeEnabled();
  await expect(browser).not.toBeChecked();
  await browser.click();
  await expect(browser).toBeChecked();
  await expect(desktop).toBeEnabled();
  await desktop.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'true');
  await desktop.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'false');
});

test('without a computer row both switches are disabled and say why', async ({ page }) => {
  const access = await open(page, []);
  await expect(access.getByRole('switch', { name: '桌面控制' })).toBeDisabled();
  const desktopReason = '这台机器还没有电脑记录，等桌面控制上线后才能在这里打开。';
  await access.getByRole('button', { name: desktopReason }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: desktopReason })).toBeVisible();
  const browser = access.getByRole('switch', { name: '浏览器' });
  await expect(browser).toBeEnabled();
});

test('a machine that reports no browser keeps the browser switch disabled', async ({ page }) => {
  const access = await open(page, [], [{ ...MACHINE, capabilities: { mcpServers: [], skills: [] } }]);
  await expect(access.getByRole('switch', { name: '浏览器' })).toBeDisabled();
  const reason = '这台机器还不支持浏览器。';
  await access.getByRole('button', { name: reason }).focus();
  await page.keyboard.press(' ');
  await expect(page.locator('[data-sonner-toast]', { hasText: reason })).toBeVisible();
});

test('switching desktop control off still releases after another surface replaced the lease', async ({
  page,
}) => {
  const access = await open(page, [computer()]);
  const desktop = access.getByRole('switch', { name: '桌面控制' });
  await desktop.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'true');
  const replaced = await page.evaluate(() =>
    fetch('/api/teams/t1/computers/comp-1/control', { method: 'POST' }).then((res) => res.status),
  );
  expect(replaced).toBe(201);
  await desktop.click();
  await expect(desktop).toHaveAttribute('aria-checked', 'false');
});
