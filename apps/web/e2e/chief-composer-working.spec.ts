import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock.js';

test('the ring under the composer stays still while a turn runs and reads in K', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  const line = page.getByTestId('home-c');
  const meter = line.getByTestId('composer-context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveText('');
  await expect(meter).toHaveAttribute('aria-busy', 'false');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(meter.locator('[data-slot="context-arc"]')).toBeVisible();
  await expect(meter.locator('[data-compact-tick]')).toHaveCount(1);
  await expect(meter).toHaveAttribute('aria-label', 'Context 24K / 200K, 70K 时 auto-compact');
  await expect(line.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
  await meter.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('Context 24K / 200K');
  await expect(tip).toContainText('70K 时 auto-compact');
});

test('clicking the ring opens the context panel with only the rows it can read', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  await page.getByTestId('home-c').getByTestId('composer-context-meter').click();
  const panel = page.getByTestId('context-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('context-panel-reading')).toHaveText('24K / 200K');
  await expect(panel.getByTestId('context-panel-compact')).toContainText('70K');
  await expect(panel.getByTestId('context-panel-cache')).toHaveCount(0);
  await expect(panel.getByTestId('context-panel-hit')).toHaveText(/Hit rate\s*90%/);
});

test('an idle coordinator shows the same still ring and no timer', async ({ page }) => {
  await page.goto('/app?scenario=111');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute('aria-busy', 'false');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
});

test('the narrow menu shows the context panel without animation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=chief-draft');
  await page.getByTestId('composer-plus').click();
  const meter = page.getByTestId('composer-context-meter');
  await expect(meter).toHaveAttribute('aria-busy', 'false');
  await expect(meter.getByTestId('context-panel-reading')).toHaveText('24K / 200K');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('usage loading draws a still bare ring until the request settles', async ({ page }) => {
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
    expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
    await expect(meter.locator('circle')).toBeVisible();
    await expect(meter.locator('[data-slot="context-arc"]')).toHaveCount(0);
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
    '插进这一轮 · ⌘↵ 排队',
  );
  await expect(meter).toHaveAccessibleName('正在加载用量…');
  await expect(meter).toHaveText('');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(meter.locator('[data-slot="context-arc"]')).toHaveCount(0);
});

test('a new reading grows the ring arc from the old share instead of redrawing it', async ({ page }) => {
  let tokens = 24_000;
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/chief')
      return json({
        chief: { id: 'chief-u1-t1', userId: 'u1', teamId: 't1', agent: { agentId: 'agent-1' }, lastTurnAt: null, createdAt: 0, tz: null },
        context: { tokens, contextWindow: 200_000 },
        watches: [],
        wakes: [],
      });
    return undefined;
  });
  await page.goto('/app');
  const meter = page.getByTestId('home-c').getByTestId('composer-context-meter');
  const arc = meter.locator('[data-slot="context-arc"]');
  await expect(meter).toHaveAttribute('data-percent', '12');
  expect(await meter.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.waitForFunction(() => window.__es.some((es) => es.url.includes('/api/teams/t1/stream')));
  tokens = 140_000;
  await page.evaluate(() =>
    (
      window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
        onerror: () => void;
      }
    ).onerror(),
  );
  await expect(meter).toHaveAttribute('data-percent', '70');
  const shares = await arc.evaluate(
    (el) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const read = () => {
          seen.push(Number.parseFloat(getComputedStyle(el).strokeDasharray));
          if (seen.length < 40) requestAnimationFrame(read);
          else resolve(seen);
        };
        read();
      }),
  );
  expect(shares.some((share) => share > 12 && share < 70)).toBe(true);
  expect(shares.at(-1)).toBe(70);
});

test('reduced motion sets the new ring reading at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app?scenario=chief-draft');
  const arc = page.getByTestId('home-c').getByTestId('composer-context-meter').locator('[data-slot="context-arc"]');
  await expect(arc).toBeVisible();
  expect(await arc.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});
