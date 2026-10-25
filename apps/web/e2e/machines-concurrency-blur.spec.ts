import { expect, type Page, test } from '@playwright/test';

type Source = 'measured' | 'estimate' | 'manual';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  shellEnabled: boolean;
  maxConcurrent: number;
  maxConcurrentOverridden: boolean;
  recommendedConcurrent: number;
  concurrencySource: Source;
  runningSteps: number;
  capabilities: {
    mcpServers: string[];
    skills: string[];
    hardware?: {
      cpuCores: number;
      memoryTotalMb: number;
      memoryAvailableMb: number;
      loadAvg1: number;
      diskFreeMb: number;
    };
  } | null;
}

const HARDWARE = {
  cpuCores: 32,
  memoryTotalMb: 64 * 1024,
  memoryAvailableMb: 60 * 1024,
  loadAvg1: 1,
  diskFreeMb: 100_000,
};

function machine(over: Partial<StubMachine> & { id: string }): StubMachine {
  return {
    name: `box-${over.id}`,
    teamId: 'team-1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: [],
    shellEnabled: false,
    maxConcurrent: 16,
    maxConcurrentOverridden: false,
    recommendedConcurrent: 16,
    concurrencySource: 'measured',
    runningSteps: 0,
    capabilities: { mcpServers: [], skills: [], hardware: HARDWARE },
    ...over,
  };
}

async function stubStack(page: Page, rows: StubMachine[], opts: { hold?: boolean } = {}) {
  const bodies: { maxConcurrent?: number | null }[] = [];
  const pending: (() => void)[] = [];
  const state = { rows: rows.map((r) => ({ ...r })) };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/machines', (route) => route.fulfill({ json: state.rows }));
  await page.route('**/api/machines/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() as { maxConcurrent?: number | null };
    bodies.push(body);
    if (opts.hold) await new Promise<void>((resolve) => pending.push(resolve));
    state.rows = state.rows.map((r) => {
      if (r.id !== id) return r;
      if (body.maxConcurrent === null) {
        return {
          ...r,
          maxConcurrentOverridden: false,
          maxConcurrent: r.recommendedConcurrent,
          concurrencySource: r.capabilities?.hardware ? 'measured' : 'estimate',
        };
      }
      return {
        ...r,
        maxConcurrent: body.maxConcurrent ?? r.maxConcurrent,
        maxConcurrentOverridden: true,
        concurrencySource: 'manual',
      };
    });
    return route.fulfill({ json: state.rows.find((r) => r.id === id) });
  });
  return { bodies, pending, state };
}

const trigger = (page: Page, id: string) =>
  page.locator(`button[aria-label^="并发上限"][data-machine-id="${id}"]`);
const input = (page: Page) => page.getByTestId('machine-concurrency-input');
const manual5 = () =>
  machine({ id: 'm-1', maxConcurrent: 5, maxConcurrentOverridden: true, concurrencySource: 'manual' });

test('edit then click `恢复推荐`: sends exactly one PATCH (null), does not save a manual value first', async ({ page }) => {
  const { bodies } = await stubStack(page, [manual5()]);
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await input(page).fill('7');
  await page.getByTestId('machine-concurrency-reset').click();
  await expect(trigger(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'measured');
  await page.waitForTimeout(300);
  expect(bodies).toEqual([{ maxConcurrent: null }]);
});

test('edit then click +: sends exactly one PATCH (draft + 1)', async ({ page }) => {
  const { bodies } = await stubStack(page, [manual5()]);
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await input(page).fill('7');
  await page.getByTestId('machine-concurrency-inc').click();
  await expect(input(page)).toHaveValue('8');
  await page.waitForTimeout(300);
  expect(bodies).toEqual([{ maxConcurrent: 8 }]);
});

test('out-of-range value left unedited: focus then blur sends no PATCH, does not clamp', async ({ page }) => {
  const { bodies } = await stubStack(page, [
    machine({
      id: 'm-1',
      maxConcurrent: 12,
      maxConcurrentOverridden: true,
      concurrencySource: 'manual',
      recommendedConcurrent: 3,
      capabilities: { mcpServers: [], skills: [] },
    }),
  ]);
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await expect(page.getByTestId('machine-concurrency-out-of-range')).toBeVisible();
  await input(page).focus();
  await input(page).blur();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(bodies).toEqual([]);
  await expect(trigger(page, 'm-1')).toHaveAttribute('aria-label', '并发上限 12，手动');
});

test('two consecutive writes: the second waits for the first receipt (ordered, final = last intent)', async ({ page }) => {
  const { bodies, pending, state } = await stubStack(page, [manual5()], { hold: true });
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await input(page).fill('6');
  await input(page).press('Enter');
  await page.getByTestId('machine-concurrency-reset').click();
  await expect.poll(() => bodies.length).toBe(1);
  await page.waitForTimeout(300);
  expect(bodies.length).toBe(1);
  pending.shift()!();
  await expect.poll(() => bodies.length).toBe(2);
  pending.shift()!();
  expect(bodies).toEqual([{ maxConcurrent: 6 }, { maxConcurrent: null }]);
  await expect.poll(() => state.rows[0]?.maxConcurrentOverridden).toBe(false);
  await expect(trigger(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'measured');
});

test('three + clicks while a PATCH is in flight: 3 → 6, draft does not bounce back, final stored value 6', async ({ page }) => {
  const { bodies, pending, state } = await stubStack(
    page,
    [machine({ id: 'm-1', maxConcurrent: 3, maxConcurrentOverridden: true, concurrencySource: 'manual' })],
    { hold: true },
  );
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  const inc = page.getByTestId('machine-concurrency-inc');
  await inc.click();
  await expect.poll(() => bodies.length).toBe(1);
  await inc.click();
  await inc.click();
  await expect(input(page)).toHaveValue('6');
  await page.waitForTimeout(300);
  await expect(input(page)).toHaveValue('6');
  for (let i = 2; i <= 3; i++) {
    pending.shift()!();
    await expect.poll(() => bodies.length).toBe(i);
  }
  pending.shift()!();
  expect(bodies).toEqual([{ maxConcurrent: 4 }, { maxConcurrent: 5 }, { maxConcurrent: 6 }]);
  await expect.poll(() => state.rows[0]?.maxConcurrent).toBe(6);
  await expect(input(page)).toHaveValue('6');
  await expect(trigger(page, 'm-1')).toHaveAttribute('aria-label', '并发上限 6，手动');
});
