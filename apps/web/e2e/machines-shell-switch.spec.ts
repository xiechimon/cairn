import { expect, type Page, test } from '@playwright/test';

const SWITCH = '[role="switch"]';
const ERROR = '[role="alert"]';

interface StubMachine {
  id: string;
  name: string;
  teamId: string;
  online: boolean;
  latestCliVersion: null;
  kind: 'local' | 'remote';
  enabledRuntimes: string[];
  shellEnabled: boolean;

  maxConcurrent?: number;
  runningSteps?: number;
}

function machine(over: Partial<StubMachine> & { id: string; name: string }): StubMachine {
  return {
    teamId: 'team-1',
    online: true,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: [],
    shellEnabled: false,
    ...over,
  };
}

async function stubStack(page: Page, rows: StubMachine[]) {
  const state = { rows: rows.map((r) => ({ ...r })), patches: [] as unknown[] };

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
  await page.route('**/api/machines/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    state.patches.push(route.request().postDataJSON());
    const body = route.request().postDataJSON() as {
      shellEnabled?: boolean;
      maxConcurrent?: number;
    };
    state.rows = state.rows.map((r) =>
      r.id === id
        ? {
            ...r,
            ...(body.shellEnabled !== undefined ? { shellEnabled: body.shellEnabled } : {}),
            ...(body.maxConcurrent !== undefined ? { maxConcurrent: body.maxConcurrent } : {}),
          }
        : r,
    );
    return route.fulfill({ json: state.rows.find((r) => r.id === id) });
  });
  return state;
}

const LOCAL = machine({ id: 'm-local', name: 'xmonsMac-3574.local', kind: 'local' });
const REMOTE = machine({ id: 'm-remote', name: 'build-box' });

test('each switch reads its own record truth (local on / connected machine off)', async ({ page }) => {
  await stubStack(page, [{ ...LOCAL, shellEnabled: true }, REMOTE]);
  await page.goto('/app/resources/machines');
  const switches = page.locator(SWITCH);
  await expect(switches).toHaveCount(2);
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator(`${SWITCH}[data-machine-id="m-remote"]`)).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('connected-machine rows have switches too: authorization face covers non-local machines', async ({ page }) => {
  await stubStack(page, [LOCAL, REMOTE]);
  await page.goto('/app/resources/machines');
  await expect(page.locator('div[data-kind="remote"]').locator(SWITCH)).toHaveCount(1);
});

test('flipping on: PATCH single field {shellEnabled:true}, still on after reload (read side consistent)', async ({ page }) => {
  const state = await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ shellEnabled: true });
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('flipping off: writes back false the same way and persists', async ({ page }) => {
  const state = await stubStack(page, [{ ...LOCAL, shellEnabled: true }]);
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ shellEnabled: false });
  await page.reload();
  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('new state shown while the response is in flight (optimistic update, no waiting for the server receipt)', async ({ page }) => {
  await stubStack(page, [LOCAL]);

  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/machines/*', async (route) => {
    await held;
    return route.fallback();
  });
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  release();
});

test('PATCH failure: switch rolls back + visible error feedback', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  let patches = 0;
  await page.route('**/api/machines/*', (route) => {
    patches += 1;
    return route.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await page.goto('/app/resources/machines');
  const sw = page.locator(`${SWITCH}[data-machine-id="m-local"]`);
  await sw.click();
  await expect.poll(() => patches).toBe(1);
  const error = page.locator(ERROR);
  await expect(error).toBeVisible();
  await expect(error).toHaveText('保存失败，请重试。');

  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('no error row left after a successful save', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  await page.locator(`${SWITCH}[data-machine-id="m-local"]`).click();
  await expect(page.locator(ERROR)).toHaveCount(0);
});

test('C1+C2+C4: concurrency selector — reads annotation truth, PATCHes a single field, persists across reload', async ({ page }) => {
  const state = await stubStack(page, [
    { ...LOCAL, maxConcurrent: 2, runningSteps: 1 },
  ]);
  await page.goto('/app/resources/machines');

  const readout = page.locator('[data-machine-running="1"]');
  await expect(readout).toHaveText('执行中 1/2');

  const trigger = page.locator('button[aria-label^="并发上限"]');
  await expect(trigger).toHaveAccessibleName('并发上限 2');
  await expect(trigger).toContainText('2');
  await trigger.click();
  await page.getByRole('spinbutton', { name: '并发上限' }).fill('4');
  await page.getByRole('spinbutton', { name: '并发上限' }).press('Enter');

  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0]).toEqual({ maxConcurrent: 4 });

  await page.reload();
  await expect(page.locator('button[aria-label^="并发上限"]')).toContainText('4');
});

test('C3: old server shape (no maxConcurrent field) → the whole control + annotation group retires', async ({ page }) => {
  await stubStack(page, [LOCAL]);
  await page.goto('/app/resources/machines');
  await expect(page.locator('button[aria-label^="并发上限"]')).toHaveCount(0);
  await expect(page.locator('[data-machine-running]')).toHaveCount(0);

  await expect(page.locator(`${SWITCH}[data-machine-id="m-local"]`)).toHaveCount(1);
});
