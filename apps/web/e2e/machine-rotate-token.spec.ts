import { expect, type Locator, type Page, test } from '@playwright/test';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  lastSeenAt: number | null;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  tokenReauthRequired?: boolean;
}

const MACHINES_URL = '/app/settings/machines';

async function openRowMenu(page: Page, row: Locator) {
  await row.getByTestId('machine-menu').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect
    .poll(() => menu.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  return menu;
}

async function setupStubs(
  page: Page,
  opts: {
    online?: boolean;
    tokenReauthRequired?: boolean;
    failDelete?: boolean;
    secondMachine?: boolean;
  } = {},
) {
  const state = {
    requests: [] as string[],
    machines: [
      {
        id: 'm-rot-1',
        name: 'mini-runner',
        teamId: 'team-1',
        online: opts.online ?? true,
        lastSeenAt: Date.now(),
        latestCliVersion: null,
        kind: 'remote' as const,
        enabledRuntimes: [],
        ...(opts.tokenReauthRequired ? { tokenReauthRequired: true } : {}),
      } satisfies StubMachine,
      ...(opts.secondMachine
        ? [
            {
              id: 'm-rot-2',
              name: 'studio-runner',
              teamId: 'team-1',
              online: true,
              lastSeenAt: Date.now(),
              latestCliVersion: null,
              kind: 'local' as const,
              enabledRuntimes: [],
            } satisfies StubMachine,
          ]
        : []),
    ],
    defaultMachineId: 'm-rot-1',
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
          defaultMachineId: state.defaultMachineId,
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/teams/team-1/machines', (route) => route.fulfill({ json: state.machines }));
  await page.route('**/api/teams/team-1', async (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    state.requests.push('PATCH:/api/teams/team-1');
    const body = request.postDataJSON() as { defaultMachineId?: string };
    if (body.defaultMachineId) state.defaultMachineId = body.defaultMachineId;
    return route.fulfill({
      json: {
        id: 'team-1',
        name: 'Team',
        createdAt: 0,
        plan: 'free',
        avatarStyle: null,
        defaultMachineId: state.defaultMachineId,
      },
    });
  });
  await page.route('**/api/machines/*', async (route, request) => {
    state.requests.push(`${request.method()}:${request.url()}`);
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { isDefault?: boolean };
      const machineId = request.url().split('/').pop();
      if (body.isDefault && machineId) state.defaultMachineId = machineId;
      const target = state.machines.find((m) => m.id === machineId) ?? state.machines[0];
      return route.fulfill({ json: target });
    }
    if (request.method() === 'DELETE') {
      if (opts.failDelete) return route.fulfill({ status: 500, json: { error: 'boom' } });
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
  return state;
}

test('machine row menu holds only default and delete; R key does nothing; pre-upgrade tokenReauthRequired shows plain offline', async ({
  page,
}) => {
  const state = await setupStubs(page, {
    online: false,
    tokenReauthRequired: true,
    secondMachine: true,
  });
  await page.goto(MACHINES_URL);
  const rows = page.getByTestId('machine-item');
  await expect(rows).toHaveCount(2);

  const first = rows.first();
  await expect(first.getByTestId('machine-item-status')).toHaveText('离线');
  await expect(page.getByTestId('machine-token-reauth-status')).toHaveCount(0);
  await expect(page.getByTestId('machine-token-reauth-drawer')).toHaveCount(0);

  await openRowMenu(page, first);
  await expect(page.getByTestId('machine-menu-rotate-token')).toHaveCount(0);
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByTestId('machine-menu-default')).toBeDisabled();
  await expect(page.getByTestId('machine-menu-delete')).toBeEnabled();

  await page.keyboard.press('r');
  expect(state.requests).toEqual([]);
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  const second = rows.nth(1);
  await openRowMenu(page, second);
  await expect(page.getByTestId('machine-menu-default')).toBeEnabled();
  await page.keyboard.press('f');
  await expect.poll(() => state.defaultMachineId).toBe('m-rot-2');
});

test('delete cancel, delete failure toast, fixture guard, and zero horizontal overflow at 1440px and 390px in light and dark', async ({
  page,
}) => {
  const state = await setupStubs(page, { online: true, failDelete: true });
  await page.goto(MACHINES_URL);
  const row = page.getByTestId('machine-item').first();

  await openRowMenu(page, row);
  await page.keyboard.press('d');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.requests).toEqual([]);

  await openRowMenu(page, row);
  await page.getByTestId('machine-menu-delete').click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click();
  await expect(page.getByText(/删除执行机失败/)).toBeVisible();

  await page.goto('/app/settings/machines?scenario=machines-master-detail');
  const demoRow = page.getByTestId('machine-item').nth(1);
  await openRowMenu(page, demoRow);
  await expect(page.getByTestId('machine-menu-rotate-token')).toHaveCount(0);
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  const requestsBeforeDemo = state.requests.length;
  await page.getByTestId('machine-menu-default').click();
  expect(state.requests.slice(requestsBeforeDemo)).toEqual([]);

  for (const theme of ['light', 'dark'] as const) {
    await page.addInitScript((mode) => {
      localStorage.setItem('cairn-theme', mode);
    }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/app/settings/machines?scenario=machines-master-detail');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${theme} ${width}px`).toBe(false);
    }
  }
});
