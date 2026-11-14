import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';

test('the line under the composer shows context usage, not a turn timer', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  const line = page.getByTestId('home-c');
  const meter = line.getByTestId('composer-context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveText('');
  await expect(meter).toHaveAttribute('aria-busy', 'true');
  await expect
    .poll(() => meter.evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')))
    .toBe(true);
  await expect(meter).toHaveAttribute('aria-label', '已用 2.4万 / 20万, 7万时自动压缩');
  await expect(line.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
  await meter.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('已用 2.4万 / 20万');
  await expect(tip).toContainText('7万时自动压缩');
});

test('an idle coordinator shows the same context line and still no timer', async ({ page }) => {
  await page.goto('/app?scenario=111');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute('aria-busy', 'false');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
});

test('the narrow menu animates the same running context ring', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=chief-draft');
  await page.getByTestId('composer-plus').click();
  const meter = page.getByTestId('composer-context-meter');
  await expect(meter).toHaveAttribute('aria-busy', 'true');
  await expect(meter).not.toContainText('%');
  await expect
    .poll(() => meter.evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')))
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reduced motion keeps the busy ring still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app?scenario=chief-draft');
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  await expect(meter).toHaveAttribute('aria-busy', 'true');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test('usage loading spins until the request settles, not forever on an empty reading', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await mockLive(page, { threads: [THREAD], messages: [] });
  await page.route('**/chief?threadId=*', async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto('/app');
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  try {
    await expect(meter).toHaveAttribute('aria-busy', 'true');
    await expect(meter).toHaveAccessibleName('正在加载用量…');
    await expect
      .poll(() => meter.evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')))
      .toBe(true);
  } finally {
    release();
  }
  await expect(meter).toHaveCount(0);
});

test('usage loading stays truthful during a first reply without a reading', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/chief/threads')
      return json([{ ...THREAD, activeRun: { phase: 'streaming' } }]);
    return undefined;
  });
  const usage = page.waitForResponse((response) => response.url().includes('/chief?threadId='));
  await page.goto('/app');
  await (await usage).finished();
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  await expect(page.getByTestId('chief-composer-input')).toHaveAttribute(
    'placeholder',
    '发出的话会直接插进 Coordinator 这一轮',
  );
  await expect(meter).toHaveAccessibleName('正在加载用量…');
  await expect(meter).toHaveText('');
  await expect
    .poll(() => meter.evaluate((el) => el.getAnimations({ subtree: true }).some((a) => a.playState === 'running')))
    .toBe(true);
});
