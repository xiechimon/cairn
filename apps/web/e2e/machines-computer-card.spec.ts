import { expect, type Page, test } from '@playwright/test';
import { relativeTime } from '../src/board/rel-time.js';
import { HISTORY, mockLive } from './chief-home-mock';

const SHOTS = process.env.D75_SHOTS;

const computer = (patch: Record<string, unknown> = {}) => ({
  id: 'comp-1',
  scopeKey: 'private:u1',
  state: 'running',
  controlHolder: 'none',
  handoffReason: null,
  kind: 'host',
  machine: { id: 'm1', name: 'omarchy', online: true },
  activity: null,
  ...patch,
});

interface Feed {
  computers: unknown[];
  controlCalls?: string[];
  holdControl?: boolean;
}

const FEED_MACHINE = { id: 'm1', name: 'omarchy', online: true, kind: 'remote', runningSteps: 0 };

async function open(
  page: Page,
  feed: Feed,
  machines: unknown[] = [FEED_MACHINE],
  url = '/app?pane=machines',
) {
  await mockLive(page, { threads: [], messages: HISTORY, machines }, (path, route, json) => {
    if (path === '/api/computers' && route.request().method() === 'GET') {
      return json({ computers: feed.computers });
    }
    if (path === '/api/teams/t1/computers/comp-1/screen') {
      return json({ error: 'the computer is not connected' }, 409);
    }
    if (path === '/api/teams/t1/computers/comp-1/control') {
      if (feed.holdControl === true) return new Promise<void>(() => {});
      const method = route.request().method();
      feed.controlCalls?.push(method);
      if (method === 'DELETE') return json({ released: true });
      return json({ leaseId: 'lease-1', expiresAt: Date.now() + 60_000, controlFence: 1 }, 201);
    }
    return undefined;
  });
  await page.goto(url);
  return page.getByRole('complementary', { name: '执行机' });
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const minutesAgo = (n: number) => Date.now() - n * 60_000;

test('one card per machine names the task using it as a link under the name, with no state words or command list', async ({
  page,
}) => {
  const panel = await open(page, {
    computers: [
      computer({
        activity: {
          inUse: true,
          title: 'BOSS 合肥 8 岗位全 JD 报告',
          todoId: 'todo-boss',
          threadId: null,
          at: minutesAgo(3),
        },
      }),
    ],
  });
  await expect(panel.getByTestId('machine-card')).toHaveCount(1);
  await expect(panel.getByText('Coordinator 的电脑')).toHaveCount(0);
  await expect(panel.getByTestId('computer-feed')).toHaveCount(0);
  await expect(panel.getByTestId('machine-list-row')).not.toContainText(/在线|开着|正在开机/);
  const line = panel.getByTestId('machine-activity');
  await expect(line).toHaveText('BOSS 合肥 8 岗位全 JD 报告正在用');
  const link = line.getByRole('link', { name: 'BOSS 合肥 8 岗位全 JD 报告' });
  await expect(link).toHaveAttribute('href', /thread=todo-boss/);
  await shot(page, 'activity-using');
});

test('an idle computer shows only its name, and the Coordinator using it links to its view', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [
      computer({
        activity: { inUse: false, title: null, todoId: null, threadId: 'th-1', at: minutesAgo(20) },
      }),
    ],
  };
  const panel = await open(page, feed);
  await expect(panel.getByTestId('machine-list-row')).toHaveText('omarchy');
  await expect(panel.getByTestId('machine-line')).toHaveCount(0);
  feed.computers = [
    computer({
      activity: { inUse: true, title: null, todoId: null, threadId: 'th-1', at: minutesAgo(1) },
    }),
  ];
  const line = panel.getByTestId('machine-activity');
  await expect(line).toHaveText('Coordinator正在用', { timeout: 10_000 });
  await expect(line.getByRole('link', { name: 'Coordinator' })).toHaveAttribute('href', '/app');
});

test('an offline machine shows only its header and no activity line', async ({ page }) => {
  const lastSeenAt = minutesAgo(120);
  const panel = await open(
    page,
    {
      computers: [
        computer({
          machine: { id: 'm1', name: 'omarchy', online: false },
          activity: { inUse: false, title: 'old task', todoId: 't', threadId: null, at: 1 },
        }),
      ],
    },
    [{ ...FEED_MACHINE, online: false, lastSeenAt }],
  );
  await expect(panel.getByTestId('machine-list-row')).toContainText(
    `离线 · ${relativeTime(lastSeenAt, Date.now())}`,
  );
  await expect(panel.getByTestId('machine-line')).toHaveAttribute(
    'title',
    '在这台执行机上打开 Cairn，它就会上线',
  );
  await expect(panel.getByTestId('machine-activity')).toHaveCount(0);
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
});

test('a computer nobody has used shows no activity line', async ({ page }) => {
  const panel = await open(page, { computers: [computer()] });
  await expect(panel.getByTestId('machine-card')).toHaveCount(1);
  await expect(panel.getByTestId('machine-activity')).toHaveCount(0);
});

test('with a machine listed the panel still shows its card and the screen placeholder', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [computer()] },
    [
      {
        id: 'm1',
        name: 'omarchy',
        online: true,
        runningSteps: 0,
        capabilities: { browser: true },
      },
    ],
  );
  const card = panel;
  await expect(card.getByTestId('machine-screen')).toBeVisible();
  await expect(card.getByRole('tab')).toHaveCount(0);
  await expect(card.getByText('已安装')).toHaveCount(0);
  await expect(card.getByText('未安装')).toHaveCount(0);
  await expect(card.getByRole('switch')).toHaveCount(0);
  await expect(card.getByRole('heading', { name: '能力' })).toHaveCount(0);
});

test('with no machines the list is only the add row', async ({ page }) => {
  const panel = await open(page, { computers: [] }, []);
  await expect(panel.getByRole('heading', { name: '你的电脑' })).toHaveCount(0);
  await expect(panel.locator('[data-slot="list-card"]')).toHaveCount(1);
  await expect(panel.getByTestId('machine-list-row')).toHaveCount(0);
  await expect(panel.getByTestId('machines-add').getByRole('link', { name: '添加执行机' })).toBeVisible();
  await expect(panel).not.toContainText('没有其他电脑时');
});

test('an offline Coordinator machine reads offline in the chip and the card, with no running count', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [] },
    [{ id: 'm1', name: 'omarchy', online: false, runningSteps: 3 }],
  );
  const chip = page.getByTestId('machines-button');
  await expect(chip).toHaveAccessibleName(/omarchy/);
  await expect(chip).toHaveAccessibleName(/离线/);
  await expect(chip).not.toHaveAccessibleName(/在跑/);
  await expect(chip.locator('span:not([data-slot="fleet-badge"])')).toHaveCount(0);
  await expect(chip.locator('[data-slot="fleet-badge"]')).toHaveAttribute('data-fleet', 'offline');
  const row = panel.locator('[data-slot="list-card"]').first();
  await expect(row).toContainText('离线');
  await expect(row).not.toContainText('在跑');
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
  await expect(panel.getByTestId('machine-screen-hint')).toHaveCount(0);
});

const SCREEN_MACHINE = { id: 'm1', name: 'omarchy', online: true, runningSteps: 0 };

async function screenCenter(locator: ReturnType<Page['getByTestId']>) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
}

const AWAY = { x: 4, y: 4 };

test('the owner screen has no take-over or give-back buttons', async ({ page }) => {
  const feed: Feed = { computers: [computer()], controlCalls: [] };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-screen')).toBeVisible();
  await expect(panel.getByRole('button', { name: /接管|交还/ })).toHaveCount(0);
  await expect(page.getByTestId('machine-screen-activate')).toHaveCount(0);
  await expect(page.getByTestId('computer-control-bar')).toHaveCount(0);
  await expect(panel.getByTestId('machine-screen-note')).toHaveCount(0);
});

test('the card screen only highlights under the pointer, and a click opens the enlarged desktop', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer()], controlCalls: [] };
  await open(page, feed, [SCREEN_MACHINE]);
  const cardScreen = page.getByTestId('machine-card').getByTestId('machine-screen');
  await expect(cardScreen).toBeVisible();
  const center = await screenCenter(cardScreen);
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(1_200);
  expect(feed.controlCalls).toEqual([]);
  await expect(cardScreen).toHaveAttribute('data-interactive', 'false');
  await page.mouse.click(center.x, center.y);
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
});

test('Enlarge fills the window with the screen, and the bar shows only while the pointer is at the top', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const shell = window as Window & { cairnDesktop?: unknown; __windowButtons?: boolean[] };
    const calls: boolean[] = [];
    shell.__windowButtons = calls;
    shell.cairnDesktop = { windowControls: { setVisible: (visible: boolean) => calls.push(visible) } };
  });
  const windowButtons = () =>
    page.evaluate(() => (window as Window & { __windowButtons?: boolean[] }).__windowButtons);
  const feed: Feed = { computers: [computer()], controlCalls: [] };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await panel.getByTestId('machine-screen-expand').click();
  const enlarged = page.getByTestId('machine-screen-enlarged');
  await expect(enlarged).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const box = await enlarged.boundingBox();
  expect(box?.width).toBe(viewport.width);
  expect(box?.height).toBe(viewport.height);
  const shown = await enlarged.getByTestId('machine-screen').boundingBox();
  expect(shown).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  const bar = enlarged.getByTestId('machine-screen-bar');
  const opacity = () => bar.evaluate((element) => getComputedStyle(element).opacity);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect(bar).toHaveAttribute('data-shown', 'false');
  await expect.poll(opacity).toBe('0');
  await expect.poll(windowButtons).toEqual([false]);
  await shot(page, 'enlarged-bar-hidden');
  await page.mouse.move(viewport.width / 2, 20);
  await expect(bar).toHaveAttribute('data-shown', 'true');
  await expect.poll(opacity).toBe('1');
  await expect(bar).toContainText('omarchy');
  await expect.poll(windowButtons).toEqual([false, true]);
  await shot(page, 'enlarged-bar-shown');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(400);
  await expect(bar).toHaveAttribute('data-shown', 'true');
  await expect(bar).toHaveAttribute('data-shown', 'false', { timeout: 3_000 });
  await expect.poll(windowButtons).toEqual([false, true, false]);
  await page.mouse.move(viewport.width / 2, 20);
  await bar.getByRole('button', { name: '缩小' }).click();
  await expect(enlarged).toHaveCount(0);
  await expect.poll(async () => (await windowButtons())?.at(-1)).toBe(true);
});

test('the pointer on the enlarged screen opens the control channel, and Shrink gives control back', async ({
  page,
}) => {
  const screenOpens: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/computers/comp-1/screen'))
      screenOpens.push(request.postDataJSON());
  });
  const feed: Feed = { computers: [computer()], controlCalls: [] };
  await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
  const enlarged = page.getByTestId('machine-screen-enlarged');
  await expect(enlarged).toBeVisible();
  const cardScreen = page.getByTestId('machine-card').getByTestId('machine-screen');
  const cardSurface = await cardScreen.evaluateHandle((element) => element);
  await expect.poll(() => screenOpens.slice(0, 2)).toEqual([{ kind: 'view' }, { kind: 'view' }]);
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-fill', 'true');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect.poll(() => feed.controlCalls).toEqual(['POST']);
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'true', {
    timeout: 15_000,
  });
  await expect(cardScreen).toHaveAttribute('data-interactive', 'false');
  await expect.poll(() => screenOpens).toContainEqual({ kind: 'control', leaseId: 'lease-1' });
  await page.mouse.move(viewport.width / 2, 20);
  await enlarged.getByTestId('machine-screen-bar').getByRole('button', { name: '缩小' }).click();
  await expect(enlarged).toHaveCount(0);
  await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE']);
  expect(await cardSurface.evaluate((element) => element.isConnected)).toBe(true);
  await expect(cardScreen).toHaveAttribute('data-interactive', 'false');
});

test('keyboard focus in the enlarged view shows the bar with how to take control', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer()], controlCalls: [], holdControl: true };
  await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
  const enlarged = page.getByTestId('machine-screen-enlarged');
  const bar = page.getByTestId('machine-screen-bar');
  await expect(enlarged).toBeVisible();
  await expect(bar).toHaveAttribute('data-shown', 'false');
  const center = await screenCenter(enlarged.getByTestId('machine-screen'));
  await page.mouse.move(center.x, center.y);
  await page.keyboard.press('Tab');
  await expect(bar).toHaveAttribute('data-shown', 'true');
  await expect(bar).toContainText('鼠标移进画面就能操作');
});

test('opening the machine while a user lease exists elsewhere does not take control', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [computer({ controlHolder: 'user' })],
    controlCalls: [],
  };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-screen-expand')).toBeVisible();
  await expect(panel.getByRole('button', { name: /接管|交还/ })).toHaveCount(0);
  await expect(panel.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'false');
  await page.waitForTimeout(400);
  expect(feed.controlCalls).toEqual([]);
});

test('without a computer row the machine card shows no screen and no turn-on hint', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [] },
    [{ id: 'm1', name: 'omarchy', online: true, runningSteps: 0 }],
  );
  const card = panel;
  await expect(card.getByTestId('machine-screen')).toHaveCount(0);
  await expect(card.getByTestId('machine-list-row')).toContainText('omarchy');
  await expect(card.getByText(/桌面控制/)).toHaveCount(0);
  await expect(card.getByRole('switch')).toHaveCount(0);
});

test('a pending login handoff asks the owner to log in and labels the screen Take over', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [computer({ handoffReason: 'login' })],
    controlCalls: [],
  };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-screen-note')).toHaveText('需要你登录，点屏幕接管');
  await shot(page, 'card-login-note');
  const takeOver = panel.getByTestId('machine-screen-expand');
  await expect(takeOver).toHaveAccessibleName('接管');
  await expect(takeOver).toContainText('接管');
  expect(feed.controlCalls).toEqual([]);
  await takeOver.click();
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
});

test('a starting computer shows only a spinner on its screen and a stopped one stays asleep', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer({ state: 'starting' })], controlCalls: [] };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-screen-starting')).toBeVisible();
  await expect(panel.getByTestId('machine-list-row')).toHaveText('omarchy');
  feed.computers = [computer({ state: 'stopped' })];
  await expect(panel.getByTestId('machine-screen-asleep')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId('machine-screen-expand')).toHaveAttribute(
    'title',
    '已休眠，用到时会自己启动',
  );
  await expect(panel.getByTestId('machine-list-row')).toHaveText('omarchy');
});

test('the push link opens the machine with its screen enlarged', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [computer({ handoffReason: 'login' })],
    controlCalls: [],
  };
  await open(
    page,
    feed,
    [{ id: 'm1', name: 'omarchy', online: true, runningSteps: 0 }],
    '/app?pane=machines&machine=m1&screen=1',
  );
  const enlarged = page.getByTestId('machine-screen-enlarged');
  await expect(enlarged).toBeVisible();
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-fill', 'true');
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the enlarged screen and its bar stay inside the top and bottom safe areas', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
    });
    const feed: Feed = {
      computers: [computer({ handoffReason: 'login' })],
      controlCalls: [],
    };
    await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
    const enlarged = page.getByTestId('machine-screen-enlarged');
    await expect(enlarged).toBeVisible();
    const screen = await enlarged.getByTestId('machine-screen').boundingBox();
    const exit = await page.getByTestId('machine-screen-exit').boundingBox();
    expect(screen).not.toBeNull();
    expect(exit).not.toBeNull();
    if (!screen || !exit) return;
    expect(screen.y).toBeGreaterThanOrEqual(59);
    expect(screen.y + screen.height).toBeLessThanOrEqual(844 - 34);
    expect(screen.width).toBe(390);
    expect(exit.y).toBeGreaterThanOrEqual(59);
  });

  test('with no hover the bar stays shown and Shrink is a 44px touch target', async ({ page }) => {
    const feed: Feed = { computers: [computer()], controlCalls: [] };
    await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
    await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
    await page.mouse.move(195, 400);
    await page.waitForTimeout(400);
    expect(feed.controlCalls).toEqual([]);
    const bar = page.getByTestId('machine-screen-bar');
    await expect(bar).toBeVisible();
    await expect.poll(() => bar.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    await expect(bar).toContainText('点一下画面就能操作');
    const close = await bar.getByRole('button', { name: '缩小' }).boundingBox();
    expect(close).not.toBeNull();
    if (!close) return;
    expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
  });

  test('the login note on the card sits above the bottom navigation without scrolling', async ({
    page,
  }) => {
    const feed: Feed = {
      computers: [computer({ handoffReason: 'login' })],
      controlCalls: [],
    };
    const panel = await open(page, feed, [SCREEN_MACHINE]);
    const note = panel.getByTestId('machine-screen-note');
    await expect(note).toBeVisible();
    const tabs = await page.locator('[data-slot="phone-tabs"]').boundingBox();
    const box = await note.boundingBox();
    expect(tabs).not.toBeNull();
    expect(box).not.toBeNull();
    if (!tabs || !box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
  });

  test('a tap on the enlarged screen takes control and a tap on the bar gives it back', async ({
    page,
  }) => {
    const feed: Feed = { computers: [computer()], controlCalls: [] };
    await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
    const enlarged = page.getByTestId('machine-screen-enlarged');
    await expect(enlarged).toBeVisible();
    await enlarged.getByTestId('machine-screen').tap({ position: { x: 195, y: 500 } });
    await expect.poll(() => feed.controlCalls).toEqual(['POST']);
    await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'true', {
      timeout: 15_000,
    });
    await expect(enlarged.getByTestId('machine-screen-bar')).toContainText(
      '你在操作，Coordinator 先等着',
    );
    await enlarged.getByTestId('machine-screen-status').tap();
    await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE']);
    await expect(enlarged).toBeVisible();
    await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'false');
  });
});
