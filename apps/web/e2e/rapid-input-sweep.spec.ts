import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const SLOW_API_MS = 400;
const PRESS_GAP_MS = 50;
const HAND_DRIFT_PX = 6;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function slowNetwork(page: Page) {
  await page.route('**/api/**', async (route) => {
    await pause(SLOW_API_MS);
    await route.fallback();
  });
}

async function pressInMotion(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (box === null) throw new Error('control not laid out');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + HAND_DRIFT_PX, y + 1);
  await page.mouse.up();
  await pause(PRESS_GAP_MS);
}

async function rapidPresses(page: Page, controls: Locator[], order: number[]) {
  for (const index of order) {
    const control = controls[index];
    if (control === undefined) throw new Error(`no control ${index}`);
    await pressInMotion(page, control);
  }
}

const ORDER = [2, 0, 3, 1, 2, 3, 1];

const provider = (id: string) => ({
  id,
  providerId: `svc-${id}`,
  label: `svc-${id}`,
  kind: 'custom',
  baseUrl: 'http://127.0.0.1:8798/v1',
  api: 'openai-completions',
  models: [{ id: 'glm', name: 'glm' }],
});

const PROVIDER_IDS = ['p-a', 'p-b', 'p-c', 'p-d'];

function mountProviders(page: Page) {
  return mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/devin-subscriptions') return json([]);
    if (path === '/api/teams/t1/claude-subscriptions') return json([]);
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([]);
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: PROVIDER_IDS.map(provider), order: null });
    return undefined;
  });
}

test('provider list: presses 50ms apart while the hand moves select the last one pressed', async ({
  page,
}) => {
  await mountProviders(page);
  await slowNetwork(page);
  await page.goto('/app/resources/providers');
  const rows = PROVIDER_IDS.map((id) =>
    page.locator(`[data-instance-id="provider:${id}"] button`).first(),
  );
  await expect(page.getByTestId('provider-instance')).toHaveCount(PROVIDER_IDS.length);
  await rapidPresses(page, rows, ORDER);
  const selected = page.locator('[data-testid="provider-instance"][aria-current="true"]');
  await expect(selected).toHaveAttribute('data-instance-id', 'provider:p-b');
  await expect(page).toHaveURL(/[?&]item=provider%3Ap-b/);
});

test('provider list: a press that drifts does not reorder the list', async ({ page }) => {
  await mountProviders(page);
  await slowNetwork(page);
  await page.goto('/app/resources/providers');
  await expect(page.getByTestId('provider-instance')).toHaveCount(PROVIDER_IDS.length);
  await rapidPresses(
    page,
    PROVIDER_IDS.map((id) => page.locator(`[data-instance-id="provider:${id}"] button`).first()),
    ORDER,
  );
  await expect
    .poll(() =>
      page
        .getByTestId('provider-instance')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-instance-id'))),
    )
    .toEqual(PROVIDER_IDS.map((id) => `provider:${id}`));
});

test('settings nav: presses 50ms apart on a slow network open the last section pressed', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [] });
  await slowNetwork(page);
  await page.goto('/app/settings/routing');
  const nav = page.getByRole('navigation', { name: '设置分区' });
  const links = nav.locator('a[data-settings-section]');
  await expect(links.first()).toBeVisible();
  const sections = await links.evaluateAll((all) =>
    all.slice(0, 4).map((link) => link.getAttribute('data-settings-section') ?? ''),
  );
  await rapidPresses(
    page,
    sections.map((id) => nav.locator(`[data-settings-section="${id}"]`)),
    ORDER,
  );
  await expect(nav.locator('[aria-current="page"]')).toHaveAttribute(
    'data-settings-section',
    sections[1] ?? '',
  );
});

test('tasks panel tabs: presses 50ms apart on a slow network select the last tab pressed', async ({
  page,
}) => {
  await slowNetwork(page);
  await page.goto('/app?scenario=home-c&pane=tasks');
  const panel = page.getByRole('complementary', { name: '任务' });
  const tabs = panel.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await rapidPresses(page, [0, 1, 2, 3].map((index) => tabs.nth(index)), ORDER);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('[aria-selected="true"]')).toHaveCount(1);
});
