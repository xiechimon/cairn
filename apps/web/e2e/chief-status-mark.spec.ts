import { expect, test } from '@playwright/test';

const STATES = [
  ['114', 'idle', ''],
  ['chief-working', 'think', '正在思考'],
  ['chief-md', 'write', '正在回复'],
  ['chief-mark-look', 'look', '正在查看项目'],
  ['chief-mark-run', 'run', '正在运行命令'],
  ['chief-mark-task', 'task', '正在创建任务'],
  ['chief-question', 'ask', '等你确认'],
  ['chief-mark-error', 'error', '出错了'],
  ['chief-mark-offline', 'offline', '等待电脑上线'],
] as const;

test.use({ locale: 'zh-CN' });

for (const [scenario, state, label] of STATES) {
  test(`the mark shows ${state} for ${scenario}`, async ({ page }) => {
    await page.goto(`/app?scenario=${scenario}`);
    const mark = page.getByTestId('chief-status-mark');
    await expect(mark).toHaveAttribute('data-state', state);
    await expect(page.getByTestId('chief-status-pill')).toHaveText(label);
    await expect(mark.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  });
}

test('the pill fades after a few seconds and the mark stays', async ({ page }) => {
  await page.goto('/app?scenario=chief-mark-run');
  const pill = page.getByTestId('chief-status-pill');
  await expect(pill).toHaveAttribute('data-visible', 'true');
  expect(await pill.evaluate((el) => el.getBoundingClientRect().height)).toBe(34);
  await expect(pill).toHaveAttribute('data-visible', 'false', { timeout: 8000 });
  await expect(page.getByTestId('chief-status-mark').locator('path')).toHaveAttribute('d', /^M/);
  await page.getByTestId('chief-status-mark').locator('svg').hover();
  await expect(pill).toHaveAttribute('data-visible', 'true');
});

test('the status is exposed once through a polite live region', async ({ page }) => {
  await page.goto('/app?scenario=chief-mark-run');
  const live = page.getByTestId('chief-status-live');
  await expect(live).toHaveAttribute('role', 'status');
  await expect(live).toHaveText('正在运行命令');
  await expect(page.getByTestId('chief-status-pill')).toHaveAttribute('aria-hidden', 'true');
});

test('only the disc takes the pointer; the transcript under the pill stays clickable', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-mark-run');
  const mark = page.getByTestId('chief-status-mark');
  const events = await mark.evaluate((el) => ({
    wrapper: getComputedStyle(el).pointerEvents,
    pill: getComputedStyle(el.querySelector('[data-testid=chief-status-pill]') as Element)
      .pointerEvents,
  }));
  expect(events).toEqual({ wrapper: 'none', pill: 'none' });
});

test('the mark keeps moving while a command runs', async ({ page }) => {
  await page.goto('/app?scenario=chief-mark-run');
  const path = page.getByTestId('chief-status-mark').locator('path');
  const first = await path.getAttribute('d');
  await expect.poll(() => path.getAttribute('d')).not.toBe(first);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the mark holds still', async ({ page }) => {
    await page.goto('/app?scenario=chief-mark-run');
    const path = page.getByTestId('chief-status-mark').locator('path');
    await expect(path).toHaveAttribute('d', /^M/);
    const first = await path.getAttribute('d');
    await page.waitForTimeout(500);
    expect(await path.getAttribute('d')).toBe(first);
  });
});

test('the mark stays inside the conversation at 390px with no horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=chief-mark-run');
  const disc = page.getByTestId('chief-status-mark').locator('svg');
  await expect(disc).toBeVisible();
  const box = await disc.boundingBox();
  expect(box?.x ?? -1).toBeGreaterThan(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
