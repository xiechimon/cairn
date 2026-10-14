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

async function stubStack(page: Page, rows: StubMachine[]) {
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
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({ json: state.rows }),
  );
  await page.route('**/api/machines/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const body = route.request().postDataJSON() as { maxConcurrent?: number | null };
    await new Promise<void>((resolve) => pending.push(resolve));
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
  return { pending, state };
}

const source = (page: Page, id: string) =>
  page.locator(`[data-testid="machine-concurrency"][data-machine-id="${id}"] [data-concurrency-source]`);
const trigger = (page: Page, id: string) =>
  page.locator(`[data-testid="machine-concurrency"][data-machine-id="${id}"]`);

test('选数即标手动：PATCH 在途时来源已是手动，回执后仍是手动', async ({ page }) => {
  const { pending, state } = await stubStack(page, [machine({ id: 'm-1' })]);
  await page.goto('/app/resources/machines');
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'measured');

  await trigger(page, 'm-1').click();
  await page.locator('[data-testid="machine-concurrency-option"]', { hasText: /^5$/ }).click();

  await expect.poll(() => pending.length).toBe(1);
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'manual');

  pending.shift()!();
  await expect.poll(() => state.rows[0]?.maxConcurrentOverridden).toBe(true);
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'manual');
});

test('恢复推荐（有指纹）：PATCH 在途时来源先复判为推荐', async ({ page }) => {
  const { pending } = await stubStack(page, [
    machine({ id: 'm-1', maxConcurrent: 5, maxConcurrentOverridden: true, concurrencySource: 'manual' }),
  ]);
  await page.goto('/app/resources/machines');
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'manual');

  await trigger(page, 'm-1').click();
  await page.getByTestId('machine-concurrency-reset').click();

  await expect.poll(() => pending.length).toBe(1);
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'measured');
  pending.shift()!();
});

test('恢复推荐（无指纹）：PATCH 在途时来源先复判为估算，不说成推荐', async ({ page }) => {
  const { pending } = await stubStack(page, [
    machine({
      id: 'm-1',
      maxConcurrent: 5,
      maxConcurrentOverridden: true,
      concurrencySource: 'manual',
      recommendedConcurrent: 3,
      capabilities: null,
    }),
  ]);
  await page.goto('/app/resources/machines');

  await trigger(page, 'm-1').click();
  await page.getByTestId('machine-concurrency-reset').click();

  await expect.poll(() => pending.length).toBe(1);
  await expect(source(page, 'm-1')).toHaveAttribute('data-concurrency-source', 'estimate');
  pending.shift()!();
});
