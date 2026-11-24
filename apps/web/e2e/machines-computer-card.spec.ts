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
  steps?: unknown[];
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
    if (path === '/api/computers/steps') return json({ steps: feed.steps ?? [] });
    if (path.startsWith('/api/computers/steps/'))
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
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

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

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

test('an idle online computer is one quiet row: no screen box and no screen stream', async ({
  page,
}) => {
  const screenOpens: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/computers/comp-1/screen')) screenOpens.push(request.method());
  });
  const panel = await open(
    page,
    { computers: [computer()] },
    [{ ...FEED_MACHINE, capabilities: { browser: true } }],
  );
  const card = panel.getByTestId('machine-card');
  await expect(card.getByTestId('machine-list-row')).toHaveText('omarchy');
  await expect(card.getByTestId('machine-screen')).toHaveCount(0);
  await expect(card.getByTestId('machine-step')).toHaveCount(0);
  await expect(card.getByRole('tab')).toHaveCount(0);
  await expect(card.getByRole('switch')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(screenOpens).toEqual([]);
  await shot(page, 'idle-row');
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


const step = (patch: Record<string, unknown> = {}) => ({
  machineId: 'm1',
  callId: 'call-3',
  surface: 'browser',
  inFlight: true,
  at: Date.now(),
  shot: { callId: 'call-2', width: 1280, height: 800, point: { x: 960, y: 200 } },
  shotMissing: false,
  ...patch,
});

test('while an agent acts the row shows only the latest step screenshot, then folds back', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer()], controlCalls: [], steps: [step()] };
  const panel = await open(page, feed);
  const panelStep = panel.getByTestId('machine-step');
  const frame = panelStep.getByTestId('machine-step-shot');
  await expect(frame.locator('img')).toHaveAttribute('src', '/api/computers/steps/call-2/shot');
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  if (box) expect(Math.round((box.width / box.height) * 10)).toBe(16);
  const dot = await panelStep.getByTestId('machine-step-click').boundingBox();
  expect(dot).not.toBeNull();
  if (box && dot) {
    expect((dot.x + dot.width / 2 - box.x) / box.width).toBeCloseTo(0.75, 1);
    expect((dot.y + dot.height / 2 - box.y) / box.height).toBeCloseTo(0.25, 1);
  }
  await expect(panelStep).toHaveText('');
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
  await shot(page, 'acting');
  await panelStep.getByTestId('machine-step-watch').click();
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
  expect(feed.controlCalls).toEqual([]);
  await page.getByTestId('machine-screen-exit').click();
  feed.steps = [];
  await expect(panel.getByTestId('machine-step')).toHaveCount(0, { timeout: 5_000 });
});

test('a browser step has no picture, so the row stays quiet', async ({ page }) => {
  const feed: Feed = { computers: [computer()], controlCalls: [], steps: [step({ shot: null })] };
  const panel = await open(page, feed);
  await expect(panel.getByTestId('machine-card')).toBeVisible();
  await expect(panel.getByTestId('machine-step')).toHaveCount(0);
});

test('an agent step with no picture says why and links to the fix', async ({ page }) => {
  const feed: Feed = {
    computers: [],
    steps: [step({ surface: 'app', shot: null, shotMissing: true })],
  };
  const panel = await open(page, feed, [
    {
      ...SCREEN_MACHINE,
      capabilities: {
        mcpServers: [],
        skills: [],
        ownComputer: true,
        hostPermissions: { accessibility: 'granted', automation: 'granted', screenRecording: 'denied' },
      },
    },
  ]);
  const panelStep = panel.getByTestId('machine-step');
  await expect(panelStep.getByTestId('machine-step-shot')).toHaveCount(0);
  const reason = panelStep.getByTestId('machine-step-no-shot');
  await expect(reason).toContainText('缺少屏幕录制权限，看不到画面');
  await expect(reason.getByRole('link', { name: '打开设置' })).toHaveAttribute(
    'href',
    /machines.*machine=m1/,
  );
  await shot(page, 'acting-no-permission');
});

test('Take over is a click, not a hover: the pointer takes nothing, Take over pauses the agent and Give back returns control', async ({
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
  const center = await screenCenter(enlarged.getByTestId('machine-screen'));
  await page.mouse.move(center.x, center.y);
  await page.mouse.move(center.x + 6, center.y + 4);
  await page.waitForTimeout(1_000);
  expect(feed.controlCalls).toEqual([]);
  const bar = enlarged.getByTestId('machine-screen-bar');
  await expect(bar).toHaveAttribute('data-shown', 'true');
  await expect(bar).toContainText('只看画面，Coordinator 照常工作');
  const control = bar.getByTestId('machine-screen-control');
  await expect(control).toHaveText('接管');
  await shot(page, 'dialog-watching');
  await control.click();
  await expect.poll(() => feed.controlCalls).toEqual(['POST']);
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'true', {
    timeout: 15_000,
  });
  await expect.poll(() => screenOpens).toContainEqual({ kind: 'control', leaseId: 'lease-1' });
  await page.mouse.move(center.x, 20);
  await expect(bar).toContainText('你在操作，Coordinator 先等着');
  await expect(control).toHaveText('交还');
  await shot(page, 'dialog-held');
  await control.click();
  await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE']);
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'false');
  await expect(control).toHaveText('接管');
  await control.click();
  await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE', 'POST']);
  await bar.getByRole('button', { name: '缩小' }).click();
  await expect(enlarged).toHaveCount(0);
  await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE', 'POST', 'DELETE']);
});

test('Take over and Give back pressed 50ms apart on a slow network: the last press wins', async ({
  page,
}) => {
  const calls: string[] = [];
  await mockLive(
    page,
    { threads: [], messages: HISTORY, machines: [SCREEN_MACHINE] },
    (path, route, json) => {
      if (path === '/api/computers') return json({ computers: [computer()] });
      if (path === '/api/teams/t1/computers/comp-1/screen')
        return json({ error: 'the computer is not connected' }, 409);
      if (path === '/api/teams/t1/computers/comp-1/control') {
        const method = route.request().method();
        calls.push(method);
        return new Promise<void>((resolve) =>
          setTimeout(() => {
            void (
              method === 'DELETE'
                ? json({ released: true })
                : json({ leaseId: 'lease-1', expiresAt: Date.now() + 60_000, controlFence: 1 }, 201)
            ).then(resolve);
          }, 400),
        );
      }
      return undefined;
    },
  );
  await page.goto('/app?pane=machines&machine=m1&screen=1');
  const control = page.getByTestId('machine-screen-control');
  await expect(control).toHaveText('接管');
  await control.click();
  await page.waitForTimeout(50);
  await control.click();
  await page.waitForTimeout(50);
  await control.click();
  await expect(control).toHaveText('交还');
  await expect.poll(() => calls, { timeout: 5_000 }).toEqual(['POST']);
  await expect(control).toHaveAttribute('data-held', 'true');
  await control.click();
  await page.waitForTimeout(50);
  await control.click();
  await page.waitForTimeout(50);
  await control.click();
  await expect(control).toHaveText('接管');
  await expect.poll(() => calls, { timeout: 5_000 }).toEqual(['POST', 'DELETE']);
  await page.waitForTimeout(800);
  expect(calls).toEqual(['POST', 'DELETE']);
  await expect(control).toHaveAttribute('data-held', 'false');
});

test('opening the screen while a user lease exists elsewhere does not take control', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [computer({ controlHolder: 'user' })],
    controlCalls: [],
  };
  await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
  await expect(page.getByTestId('machine-screen')).toHaveAttribute('data-interactive', 'false');
  await page.waitForTimeout(400);
  expect(feed.controlCalls).toEqual([]);
});

test('the menu opens the screen of an idle computer without taking control', async ({ page }) => {
  const feed: Feed = { computers: [computer()], controlCalls: [] };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await panel.getByTestId('machine-menu').click();
  await page.getByTestId('machine-watch').click();
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
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
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
  await expect(panel.getByTestId('machine-list-row')).toContainText('omarchy');
  await expect(panel.getByText(/桌面控制/)).toHaveCount(0);
  await expect(panel.getByRole('switch')).toHaveCount(0);
  await page.getByTestId('machine-menu').click();
  await expect(page.getByTestId('machine-watch')).toHaveCount(0);
});

test('a pending login handoff asks the owner to log in, and Take over opens the screen in control', async ({
  page,
}) => {
  const feed: Feed = {
    computers: [computer({ handoffReason: 'login' })],
    controlCalls: [],
  };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-screen-note')).toHaveText('需要你登录');
  await shot(page, 'card-login-note');
  expect(feed.controlCalls).toEqual([]);
  await panel.getByTestId('machine-take-over').click();
  await expect(page.getByTestId('machine-screen-enlarged')).toBeVisible();
  await expect.poll(() => feed.controlCalls).toEqual(['POST']);
  await expect(page.getByTestId('machine-screen-control')).toHaveText('交还');
});

test('a starting computer says so on its row and a stopped one is a quiet row', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer({ state: 'starting' })], controlCalls: [] };
  const panel = await open(page, feed, [SCREEN_MACHINE]);
  await expect(panel.getByTestId('machine-line')).toHaveText('正在启动');
  feed.computers = [computer({ state: 'stopped' })];
  await expect(panel.getByTestId('machine-line')).toHaveCount(0, { timeout: 10_000 });
  await expect(panel.getByTestId('machine-list-row')).toHaveText('omarchy');
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
});

test('the push link opens the machine with its screen enlarged', async ({ page }) => {
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
  await expect(enlarged.getByTestId('machine-screen')).toBeVisible();
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

  test('a tap on the screen takes nothing; Take over and Shrink are 44px touch targets', async ({
    page,
  }) => {
    const feed: Feed = { computers: [computer()], controlCalls: [] };
    await open(page, feed, [SCREEN_MACHINE], '/app?pane=machines&machine=m1&screen=1');
    const enlarged = page.getByTestId('machine-screen-enlarged');
    await expect(enlarged).toBeVisible();
    await enlarged.getByTestId('machine-screen').tap({ position: { x: 195, y: 500 } });
    await page.waitForTimeout(400);
    expect(feed.controlCalls).toEqual([]);
    const bar = page.getByTestId('machine-screen-bar');
    await expect.poll(() => bar.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
    for (const target of [bar.getByTestId('machine-screen-control'), bar.getByRole('button', { name: '缩小' })]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      if (box) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await bar.getByTestId('machine-screen-control').tap();
    await expect.poll(() => feed.controlCalls).toEqual(['POST']);
    await bar.getByTestId('machine-screen-control').tap();
    await expect.poll(() => feed.controlCalls).toEqual(['POST', 'DELETE']);
    await expect(enlarged).toBeVisible();
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
});
