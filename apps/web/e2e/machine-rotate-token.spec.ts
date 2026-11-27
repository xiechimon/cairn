import { expect, type Page, test } from '@playwright/test';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  tokenReauthRequired?: boolean;
}

const MACHINES_URL = '/app/settings/machines';

async function setupStubs(
  page: Page,
  opts: {
    online?: boolean;
    delayMs?: number;
    failRotate?: boolean;
    delivery?: 'pushed' | 'offline';
  } = {},
) {
  const state = {
    rotateCalls: 0,
    machine: {
      id: 'm-rot-1',
      name: 'mini-runner',
      teamId: 'team-1',
      online: opts.online ?? true,
      latestCliVersion: null,
      kind: 'remote' as const,
      enabledRuntimes: [],
      tokenReauthRequired: false,
    } satisfies StubMachine,
  };

  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: unexpected GET' } });
  });
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } }),
  );
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [
        {
          id: 'team-1',
          name: 'Team',
          createdAt: 0,
          plan: 'free',
          avatarStyle: null,
          defaultMachineId: 'm-rot-1',
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/teams/team-1/machines', (route) => route.fulfill({ json: [state.machine] }));
  await page.route('**/api/remote/tailscale', (route) =>
    route.fulfill({ json: { state: 'ready', url: 'https://studio-mac.tail4c2a.ts.net', consentUrl: null } }),
  );
  await page.route('**/api/machines/m-rot-1/rotate-token', async (route) => {
    state.rotateCalls += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.failRotate) {
      return route.fulfill({ status: 500, json: { error: 'boom' } });
    }
    const delivery = opts.delivery ?? (state.machine.online ? 'pushed' : 'offline');
    if (delivery === 'offline') {
      state.machine = { ...state.machine, online: false, tokenReauthRequired: true };
    }
    return route.fulfill({ json: { delivery, machine: state.machine } });
  });
  return state;
}

test('in-menu one-step confirm resets on Escape/outside click, ignores repeat R, disables while pending, keeps row Online', async ({
  page,
}) => {
  const state = await setupStubs(page, { online: true, delayMs: 400, delivery: 'pushed' });
  await page.goto(MACHINES_URL);
  const row = page.getByTestId('machine-item').first();
  await expect(row).toBeVisible();

  await row.getByTestId('machine-menu').click();
  const item = page.getByTestId('machine-menu-rotate-token');
  await expect(item).toBeVisible();
  await expect(item).toContainText('更换令牌');
  await expect(item).toHaveAttribute('title', /删除执行机/);

  await item.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(item).toBeVisible();
  await expect(item).toContainText('确认更换令牌');
  await expect(item).toHaveAttribute('data-confirming', 'true');
  expect(state.rotateCalls).toBe(0);

  await page.keyboard.press('Escape');
  await expect(item).toBeHidden();

  await row.getByTestId('machine-menu').click();
  await expect(item).toContainText('更换令牌');
  await page.evaluate(() => {
    const popup = document.querySelector('[role="menu"]');
    popup?.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, repeat: true }));
  });
  await expect(item).toContainText('更换令牌');

  await page.keyboard.press('r');
  await expect(item).toContainText('确认更换令牌');

  await item.click();
  expect(state.rotateCalls).toBe(1);
  await expect(row.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(row.getByTestId('machine-default')).toBeVisible();
});

test('offline rotation shows reconnect status and command drawer across reload, clears when back online', async ({
  page,
}) => {
  const state = await setupStubs(page, { online: false, delivery: 'offline' });
  await page.goto(MACHINES_URL);
  const row = page.getByTestId('machine-item').first();

  await row.getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-rotate-token').click();
  await page.getByTestId('machine-menu-rotate-token').click();

  await expect(row.getByTestId('machine-token-reauth-status')).toHaveText('需要重新连接');
  const drawer = row.getByTestId('machine-token-reauth-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('cairn logout && cairn start');

  await page.reload();
  await expect(row.getByTestId('machine-token-reauth-drawer')).toBeVisible();

  state.machine = { ...state.machine, online: true, tokenReauthRequired: false };
  await page.reload();
  await expect(row.getByTestId('machine-token-reauth-drawer')).toHaveCount(0);
  await expect(row.getByTestId('machine-item-status')).toHaveText('在线');
});

test('error toast on failure and zero horizontal scroll at 1440px and 390px in light and dark', async ({
  page,
}) => {
  await setupStubs(page, { online: false, failRotate: true });
  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((mode) => {
      localStorage.setItem('cairn-theme', mode);
    }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(MACHINES_URL);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${theme} ${width}px`).toBe(false);
    }
  }
  const row = page.getByTestId('machine-item').first();
  await row.getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-rotate-token').click();
  await page.getByTestId('machine-menu-rotate-token').click();
  await expect(page.getByText(/更换令牌失败/)).toBeVisible();
});
