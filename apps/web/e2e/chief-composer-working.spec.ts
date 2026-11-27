import { expect, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock.js';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

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
  await expect(meter).toHaveAttribute('aria-label', '上下文 24K / 200K, 70K 时自动压缩');
  await expect(line.getByText(/工作中 ·|Working ·/)).toHaveCount(0);
  await meter.hover();
  const tip = page.locator('[data-slot="tooltip-content"]');
  await expect(tip).toContainText('上下文 24K / 200K');
  await expect(tip).toContainText('70K 时自动压缩');
});

test('clicking the ring opens the context panel with only the rows it can read', async ({ page }) => {
  await page.goto('/app?scenario=chief-draft');
  await page.getByTestId('home-c').getByTestId('composer-context-meter').click();
  const panel = page.getByTestId('context-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('context-panel-reading')).toHaveText('24K / 200K');
  await expect(panel.getByTestId('context-panel-compact')).toContainText('70K');
  await expect(panel.getByTestId('context-panel-cache')).toHaveCount(0);
  await expect(panel.getByTestId('context-panel-hit')).toHaveCount(0);
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
    '继续说，会直接打断',
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
  const sharesPromise = arc.evaluate(
    (el) =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const read = () => {
          seen.push(Number.parseFloat(getComputedStyle(el).strokeDasharray));
          if ((seen.at(-1) ?? 0) >= 70 || seen.length >= 300) resolve(seen);
          else requestAnimationFrame(read);
        };
        read();
      }),
  );
  tokens = 140_000;
  await page.evaluate(() =>
    (
      window.__es.find((es) => es.url.includes('/api/teams/t1/stream')) as unknown as {
        onerror: () => void;
      }
    ).onerror(),
  );
  await expect(meter).toHaveAttribute('data-percent', '70');
  const shares = await sharesPromise;
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

test('project channel renders reply footer parity and channel usage stats on desktop and phone', async ({
  page,
}) => {
  const channelThread = { ...THREAD, id: `chief-${PROJECT.id}`, projectId: PROJECT.id, title: PROJECT.name };
  const envelope = {
    chief: {
      id: 'chief-u1-t1',
      userId: 'u1',
      teamId: 't1',
      agent: { agentId: 'agent-1' },
      lastTurnAt: 20,
      createdAt: 0,
      tz: 'Asia/Shanghai',
    },
    agentActor: null,
    context: {
      tokens: 17_367,
      contextWindow: 183_000,
      compactAt: 150_000,
      cache: { read: 44_312, write: 6_545, input: 8 },
    },
    usage: {
      rows: [
        {
          buildId: channelThread.id,
          model: 'claude-code/claude-opus-5-5',
          input: 8,
          output: 355,
          cacheRead: 44_312,
          cacheWrite: 6_545,
          costInput: 0.0001,
          costOutput: 0.0089,
          costCacheRead: 0.0222,
          costCacheWrite: 0.0409,
          costTotal: 0.0721,
        },
      ],
      durationSeconds: 14,
      engines: ['Claude Code'],
      machines: ['Studio-Mac-mini'],
      turns: 1,
    },
    watches: [],
    wakes: [],
  };
  await mockLive(
    page,
    {
      threads: [THREAD, channelThread],
      messages: [],
      projects: [PROJECT],
      channels: {
        [PROJECT.id]: [
          {
            id: 'a-greet',
            role: 'assistant',
            content: [{ type: 'text', text: '这里是 cairn 项目的频道。' }],
            createdAt: Date.UTC(2026, 10, 24, 5, 23, 48),
            projectId: PROJECT.id,
          },
        ],
      },
    },
    (path, _route, json) => (path === '/api/teams/t1/chief' ? json(envelope) : undefined),
  );
  await page.goto(`/app?project=${PROJECT.id}&chat=1`);
  const bubble = page.getByTestId('chief-reply-bubble').first();
  await expect(bubble).toBeVisible();
  await bubble.hover();
  await expect(page.locator('[data-slot="message-meta"]').first()).toHaveCSS('opacity', '1');
  await page.getByTestId('home-c').getByTestId('composer-context-meter').click();
  const stats = page.getByTestId('channel-usage-stats');
  await expect(stats).toBeVisible();
  await expect(stats).toContainText('Claude Code');
  await expect(stats).toContainText('14s');
  await expect(stats).toContainText('$0.07');
  await expect(stats).toContainText('Studio-Mac-mini');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('composer-plus').click();
  await expect(page.getByTestId('channel-usage-stats')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
