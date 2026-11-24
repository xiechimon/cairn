import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive } from './chief-home-mock';

const MACHINE = { id: 'm1', name: 'Mac', online: true, kind: 'local', runningSteps: 0 };

const computer = (state = 'running') => ({
  id: 'comp-1',
  scopeKey: 'chief:u1',
  state,
  controlHolder: 'none',
  handoffReason: null,
  machine: { id: 'm1', name: 'Mac', online: true },
  activity: null,
});

async function open(page: Page) {
  await mockLive(
    page,
    { threads: [], messages: HISTORY, machines: [MACHINE] },
    (path, route, json) => {
      if (path === '/api/computers' && route.request().method() === 'GET')
        return json({ computers: [computer()] });
      if (path === '/api/teams/t1/computers/comp-1/screen')
        return json({ error: 'the computer is not connected' }, 409);
      return undefined;
    },
  );
  await page.goto('/app?pane=machines');
  const panel = page.getByRole('complementary', { name: '执行机' });
  return { panel };
}

test.describe('Coordinator computer actions menu', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the machine menu has rename and settings', async ({ page }) => {
    const { panel } = await open(page);
    await panel.getByTestId('machine-menu').click();
    await expect(page.getByTestId('machine-rename')).toBeVisible();
    await expect(page.getByTestId('machine-settings')).toBeVisible();
  });

  test('rename sends the trimmed name and closes', async ({ page }) => {
    const { panel } = await open(page);
    const patches: unknown[] = [];
    await page.route('**/api/machines/m1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patches.push(route.request().postDataJSON());
      await route.fulfill({ json: { ...MACHINE, name: '工作室的 Mac', teamId: 't1' } });
    });
    await panel.getByTestId('machine-menu').click();
    await page.getByTestId('machine-rename').click();
    const input = page.getByTestId('machine-rename-input');
    await expect(input).toHaveValue('Mac');
    await input.fill('  工作室的 Mac ');
    await page.getByRole('button', { name: '保存' }).click();
    await expect.poll(() => patches).toEqual([{ name: '工作室的 Mac' }]);
    await expect(input).toHaveCount(0);
  });
});
