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

// #1342 Bugbot 回归：失焦提交与 恢复推荐 / ± 竞态；未编辑的超区间值失焦被夹值保存。
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

test('编辑后点 恢复推荐：只发一次 PATCH（null），不先存手动值', async ({ page }) => {
  const { bodies } = await stubStack(page, [manual5()]);
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await input(page).fill('7');
  await page.getByTestId('machine-concurrency-reset').click();
  await expect(trigger(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'measured');
  await page.waitForTimeout(300);
  expect(bodies).toEqual([{ maxConcurrent: null }]);
});

test('编辑后点 +：只发一次 PATCH（草稿 + 1）', async ({ page }) => {
  const { bodies } = await stubStack(page, [manual5()]);
  await page.goto('/app/resources/machines');
  await trigger(page, 'm-1').click();
  await input(page).fill('7');
  await page.getByTestId('machine-concurrency-inc').click();
  await expect(input(page)).toHaveValue('8');
  await page.waitForTimeout(300);
  expect(bodies).toEqual([{ maxConcurrent: 8 }]);
});

test('未编辑的超区间值：聚焦再失焦不发 PATCH、不夹值', async ({ page }) => {
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

test('连续两次写：后一次等前一次回执再发（按序，最终 = 最后意图）', async ({ page }) => {
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
