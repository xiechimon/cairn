import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive, TEAM } from './chief-home-mock';

const SHOTS = process.env.D75_SHOTS;
const FAKE_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}`;

const T0 = Date.now() - 2 * 3_600_000;

const id = (n: number) => n.toString(16).padStart(64, '0');
const command = (n: number, patch: Record<string, unknown> = {}) => ({
  callId: id(n),
  computerId: 'comp-1',
  stepId: 'step-1',
  tool: 'shell',
  command: `echo ${n}`,
  cwd: '.',
  status: 'done',
  exitCode: 0,
  output: `out ${n}`,
  at: T0 + n * 1000,
  ...patch,
});

const computer = (patch: Record<string, unknown> = {}) => ({
  id: 'comp-1',
  scopeKey: 'private:u1',
  state: 'running',
  controlHolder: 'none',
  browserEnabled: false,
  machine: { id: 'm1', name: 'omarchy', online: true },
  ...patch,
});

interface Feed {
  computers: unknown[];
  commands: unknown[];
  holdCommands?: Promise<void>;
}

const FEED_MACHINE = { id: 'm1', name: 'omarchy', online: true, kind: 'remote', runningSteps: 0 };

async function open(page: Page, feed: Feed, machines: unknown[] = [FEED_MACHINE], detail = true) {
  await mockLive(page, { threads: [], messages: HISTORY, machines }, (path, route, json) => {
    if (path === '/api/computers' && route.request().method() === 'GET') {
      return json({ computers: feed.computers });
    }
    if (path === '/api/computers/comp-1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { browserEnabled?: boolean };
      const current = (feed.computers[0] ?? computer()) as Record<string, unknown>;
      const updated = { ...current, browserEnabled: body.browserEnabled === true };
      feed.computers = [updated];
      return json({ computer: updated });
    }
    if (path === '/api/computers/comp-1/commands') {
      return (feed.holdCommands ?? Promise.resolve()).then(() =>
        json({ commands: feed.commands }),
      );
    }
    if (path === '/api/teams/t1/computers/comp-1/screen') {
      return json({ error: 'the computer is not connected' }, 409);
    }
    if (path === '/api/teams/t1/computers/comp-1/control') {
      return json({ leaseId: 'lease-1', expiresAt: Date.now() + 60_000, controlFence: 1 }, 201);
    }
    return undefined;
  });
  await page.goto('/app?pane=machines');
  const panel = page.getByRole('complementary', { name: '电脑' });
  if (detail && machines.length > 0) {
    await panel.locator('[data-slot="list-card"]').first().getByRole('button').click();
    await panel.getByRole('tab', { name: '在这台工作' }).click();
  }
  return panel;
}

async function emit(page: Page, event: unknown) {
  await page.evaluate((ev) => {
    const stream = window.__es.find((es) => es.url.includes('/stream'));
    stream?.emit(ev);
  }, event);
}

const entries = (panel: ReturnType<Page['getByRole']>) => panel.getByTestId('computer-command');

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const HISTORY_FEED: Feed = {
  computers: [computer()],
  commands: [
    command(1, { command: 'git status --short', output: ' M a.ts\n?? b.ts' }),
    command(2, { command: 'pnpm test', status: 'error', exitCode: 1, output: 'FAIL a.test.ts' }),
    command(3, { command: 'sleep 60', status: 'running', exitCode: null, output: '' }),
  ],
};

test('opening the panel shows the computer state and the command history, newest last', async ({
  page,
}) => {
  const panel = await open(page, HISTORY_FEED);
  await expect(panel.getByTestId('computer-state')).toHaveText('开着');
  await expect(panel).toContainText('omarchy');
  await expect(entries(panel)).toHaveCount(3);
  await expect(entries(panel).nth(0)).toContainText('git status --short');
  await expect(entries(panel).nth(0)).toHaveAttribute('data-status', 'done');
  await expect(entries(panel).nth(0).getByTestId('computer-command-exit')).toHaveText('退出码 0');
  await expect(entries(panel).nth(1)).toHaveAttribute('data-status', 'error');
  await expect(entries(panel).nth(1).getByTestId('computer-command-exit')).toHaveText('退出码 1');
  await expect(entries(panel).nth(2)).toHaveAttribute('data-status', 'running');
  await expect(entries(panel).nth(2).getByTestId('computer-command-exit')).toHaveCount(0);
  await expect(entries(panel).nth(2).getByTestId('computer-command-output')).toHaveCount(0);

  await entries(panel).nth(1).getByRole('button', { name: '输出' }).click();
  await expect(entries(panel).nth(1).getByTestId('computer-command-output')).toHaveText(
    'FAIL a.test.ts',
  );

  const running = entries(panel).nth(2);
  await expect(running.locator('[data-glyph="working"]')).toHaveCount(1);
  await expect(running.getByTestId('computer-command-time')).toHaveText(/前|刚刚|昨天/);
  await expect(running.getByTestId('computer-command-time')).toHaveAttribute('title', /\d/);
});

test('a new command appears live as running and the same entry settles to done', async ({
  page,
}) => {
  const panel = await open(page, HISTORY_FEED);
  await expect(entries(panel)).toHaveCount(3);

  await emit(page, {
    type: 'computer.command',
    command: command(4, { command: 'ls', status: 'running', exitCode: null, output: '', at: T0 + 4000 }),
  });
  await expect(entries(panel)).toHaveCount(4);
  await expect(entries(panel).nth(3)).toHaveAttribute('data-status', 'running');

  await emit(page, {
    type: 'computer.command',
    command: command(4, { command: 'ls', output: 'a\nb', at: T0 + 4500 }),
  });
  await expect(entries(panel)).toHaveCount(4);
  await expect(entries(panel).nth(3)).toHaveAttribute('data-status', 'done');
  await expect(entries(panel).nth(3).getByTestId('computer-command-exit')).toHaveText('退出码 0');

  await emit(page, {
    type: 'computer.command',
    command: command(3, { command: 'sleep 60', status: 'cancelled', exitCode: null, at: T0 + 5000 }),
  });
  await expect(entries(panel).nth(2)).toHaveAttribute('data-status', 'cancelled');
  await expect(entries(panel)).toHaveCount(4);
});

test('the computer feed excludes live commands from other computers and the host', async ({ page }) => {
  const panel = await open(page, {
    computers: [computer(), computer({ id: 'comp-2' })],
    commands: [command(1)],
  });
  await expect(entries(panel)).toHaveCount(1);
  await emit(page, {
    type: 'computer.command',
    command: command(2, { computerId: 'comp-2', command: 'other-computer-only' }),
  });
  await emit(page, {
    type: 'computer.command',
    command: command(3, { computerId: null, tool: 'user_computer_shell', command: 'host-only' }),
  });
  await emit(page, { type: 'computer.command', command: command(4) });
  await expect(entries(panel)).toHaveCount(2);
  await expect(panel).not.toContainText('other-computer-only');
  await expect(panel).not.toContainText('host-only');
  await expect(entries(panel).nth(1)).toHaveAttribute('data-call-id', id(4));
});

test('the feed follows new commands at the bottom and stays put once scrolled up', async ({
  page,
}) => {
  const many = Array.from({ length: 30 }, (_, i) => command(i + 1, { output: '' }));
  const panel = await open(page, { computers: [computer()], commands: many });
  const feed = panel.getByTestId('computer-feed');
  await expect(entries(panel)).toHaveCount(30);
  const atBottom = () =>
    feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  expect(await atBottom()).toBe(true);

  await emit(page, { type: 'computer.command', command: command(31, { output: '' }) });
  await expect(entries(panel)).toHaveCount(31);
  expect(await atBottom()).toBe(true);

  await feed.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        el.scrollTop = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await emit(page, { type: 'computer.command', command: command(32, { output: '' }) });
  await expect(entries(panel)).toHaveCount(32);
  expect(await feed.evaluate((el) => el.scrollTop)).toBe(0);
});

test('expanded output follows new tail lines and preserves a deliberate scroll upward', async ({
  page,
}) => {
  const lines = (count: number) => Array.from({ length: count }, (_, n) => `line ${n}`).join('\n');
  const running = { status: 'running', exitCode: null };
  const panel = await open(page, {
    computers: [computer()],
    commands: [command(1, { ...running, output: lines(100) })],
  });
  await entries(panel).nth(0).getByRole('button', { name: '输出' }).click();
  const output = panel.getByTestId('computer-command-output');
  const atBottom = () => output.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2);
  await expect.poll(atBottom).toBe(true);
  await emit(page, {
    type: 'computer.command',
    command: command(1, { ...running, output: lines(130) }),
  });
  await expect(output).toContainText('line 129');
  await expect.poll(atBottom).toBe(true);
  await output.evaluate((el) => new Promise<void>((resolve) => {
    el.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await emit(page, {
    type: 'computer.command',
    command: command(1, { ...running, output: lines(160) }),
  });
  await expect(output).toContainText('line 159');
  expect(await output.evaluate((el) => el.scrollTop)).toBe(0);
});

test('an event that beats the history load does not duplicate and keeps call order', async ({
  page,
}) => {
  let release: () => void = () => {};
  const holdCommands = new Promise<void>((resolve) => {
    release = resolve;
  });
  const panel = await open(page, {
    computers: [computer()],
    commands: [command(1), command(2, { status: 'running', exitCode: null, output: '' })],
    holdCommands,
  });
  await expect(panel.getByTestId('computer-state')).toBeVisible();
  await emit(page, { type: 'computer.command', command: command(2, { at: T0 + 2500 }) });
  await emit(page, { type: 'computer.command', command: command(3, { at: T0 + 3000 }) });
  release();
  await expect(entries(panel)).toHaveCount(3);
  await expect(entries(panel).nth(0)).toHaveAttribute('data-call-id', id(1));
  await expect(entries(panel).nth(1)).toHaveAttribute('data-call-id', id(2));
  await expect(entries(panel).nth(1)).toHaveAttribute('data-status', 'done');
  await expect(entries(panel).nth(2)).toHaveAttribute('data-call-id', id(3));
});

test('a secret the server redacted never shows up on the page', async ({ page }) => {
  const panel = await open(page, {
    computers: [computer()],
    commands: [
      command(1, {
        command: 'curl -H "Authorization: Bearer [REDACTED]" x',
        output: 'token [REDACTED]',
      }),
    ],
  });
  await entries(panel).nth(0).getByRole('button', { name: '输出' }).click();
  await expect(entries(panel).nth(0).getByTestId('computer-command-output')).toHaveText(
    'token [REDACTED]',
  );
  expect(await page.locator('body').innerText()).not.toContain(FAKE_TOKEN);
  expect(await page.content()).not.toContain(FAKE_TOKEN);
});

test('with no computer yet the panel says so, and a first event brings the feed in', async ({
  page,
}) => {
  const feed: Feed = { computers: [], commands: [] };
  const panel = await open(page, feed);
  await expect(panel.getByTestId('computer-none')).toContainText('Coordinator 还没有自己的电脑');

  await emit(page, { type: 'computer.command', command: command(1) });
  await expect(panel.getByTestId('computer-none')).toBeVisible();
  await expect(entries(panel)).toHaveCount(0);

  feed.computers = [computer()];
  feed.commands = [command(1)];
  await emit(page, {
    type: 'computer.command',
    command: command(2, { status: 'running', exitCode: null, output: '', at: T0 + 2000 }),
  });
  await expect(entries(panel)).toHaveCount(2);
});

test('computer state words differ from command status words', async ({ page }) => {
  for (const [state, word] of [
    ['running', '开着'],
    ['starting', '正在开机'],
    ['stopped', '关着'],
    ['failed', '出错'],
  ] as const) {
    const panel = await open(page, { computers: [computer({ state })], commands: [] });
    await expect(panel.getByTestId('computer-state')).toHaveText(word);
  }
});

test('a computer with no commands shows an empty feed, not an error', async ({ page }) => {
  const panel = await open(page, { computers: [computer({ state: 'stopped' })], commands: [] });
  await expect(panel.getByTestId('computer-state')).toHaveText('关着');
  await expect(panel.getByTestId('computer-feed-empty')).toBeVisible();
});

test('an offline machine shows the computer state with an offline note and keeps the history', async ({
  page,
}) => {
  const panel = await open(page, {
    computers: [computer({ machine: { id: 'm1', name: 'omarchy', online: false } })],
    commands: [command(1)],
  });
  await expect(panel).toContainText('omarchy');
  await expect(panel.getByTestId('computer-state')).toHaveText('离线');
  await expect(panel.getByTestId('computer-state')).toHaveAttribute('data-state', 'offline');
  await expect(entries(panel)).toHaveCount(1);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('machine presence updates the computer badge without reloading or losing history', async ({
  page,
}) => {
  const feed: Feed = { computers: [computer()], commands: [command(1)] };
  const panel = await open(page, feed);
  await expect(panel.getByTestId('computer-state')).toHaveText('开着');
  feed.computers = [computer({ machine: { id: 'm1', name: 'omarchy', online: false } })];
  await emit(page, { type: 'machine_presence', machineId: 'm1', online: false });
  await expect(panel.getByTestId('computer-state')).toHaveText('离线');
  await expect(entries(panel)).toHaveCount(1);
  feed.computers = [computer()];
  await emit(page, { type: 'machine_presence', machineId: 'm1', online: true });
  await expect(panel.getByTestId('computer-state')).toHaveText('开着');
  await expect(entries(panel)).toHaveCount(1);
});

test('reconnect replaces an old live result with the current persisted history', async ({ page }) => {
  const feed: Feed = { computers: [computer()], commands: [command(1)] };
  const panel = await open(page, feed);
  await expect(entries(panel)).toHaveCount(1);
  await emit(page, {
    type: 'computer.command',
    command: command(1, { output: 'old live output' }),
  });
  await entries(panel).nth(0).getByRole('button', { name: '输出' }).click();
  const output = panel.getByTestId('computer-command-output');
  await expect(output).toHaveText('old live output');
  feed.commands = [command(1, { output: 'current persisted output' })];
  await page.evaluate(() => {
    const source = window.__es.find((stream) => stream.url.includes('/stream')) as unknown as {
      onopen: (() => void) | null;
    };
    source.onopen?.();
  });
  await expect(output).toHaveText('current persisted output');
  await expect(entries(panel)).toHaveCount(1);
});

test('private REST history disappears at the auth gate and a late old response cannot replace the next scope', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let rejectFirst = false;
  let holdFirstHistory = false;
  let historyStarted = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scopeOf = (route: {
    request: () => { headers: () => { cookie?: string } };
  }): 'first' | 'second' | 'none' => {
    const cookie = route.request().headers().cookie ?? '';
    if (cookie.includes('cairn_auth=scope-second')) return 'second';
    if (cookie.includes('cairn_auth=scope-first')) return 'first';
    return 'none';
  };
  await mockLive(page, { threads: [], messages: HISTORY, machines: [FEED_MACHINE] }, (path, route, json) => {
    const request = route.request();
    if (path === '/api/auth/bootstrap' && request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
        headers: { 'set-cookie': 'cairn_auth=scope-first; Path=/' },
      });
    }
    if (path === '/api/remote/descriptor') return json({ environmentId: 'env-1', version: 1 });
    if (path === '/api/remote/pair' && request.method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'device', deviceId: 'd1', environmentId: 'env-1' }),
        headers: { 'set-cookie': 'cairn_auth=scope-second; Path=/' },
      });
    }
    if (path === '/api/auth/stream-ticket' && request.method() === 'POST') {
      return json({ ticket: 'ticket-1', expiresAt: Date.now() + 60_000 });
    }
    const scope = scopeOf(route);
    const first = scope === 'first';
    if (path === '/api/teams') {
      return scope === 'none' ? json({ error: 'Unauthorized' }, 401) : json([TEAM]);
    }
    if (path === '/api/computers') {
      return first && rejectFirst
        ? json({ error: 'Unauthorized' }, 401)
        : json({ computers: [computer()] });
    }
    if (path === '/api/computers/comp-1/commands') {
      if (first && holdFirstHistory) {
        historyStarted = true;
        return held.then(() => json({ commands: [command(1, { command: 'first-owner-only' })] }));
      }
      return json({
        commands: [
          command(first ? 1 : 2, {
            command: first ? 'first-owner-only' : 'second-owner-only',
          }),
        ],
      });
    }
    return undefined;
  });
  await page.route('**/src/**', (route) => route.continue());
  try {
    await page.goto('/app?pane=machines');
    const panel = page.getByRole('complementary', { name: '电脑' });
    await panel.locator('[data-slot="list-card"]').first().getByRole('button').click();
    await panel.getByRole('tab', { name: '在这台工作' }).click();
    await expect(entries(panel)).toContainText(['first-owner-only']);
    holdFirstHistory = true;
    await emit(page, { type: 'ping', seq: 1 });
    await emit(page, { type: 'ping', seq: 3 });
    await expect.poll(() => historyStarted).toBe(true);
    rejectFirst = true;
    await emit(page, { type: 'machine_presence', machineId: 'm1', online: true });
    await expect(page.locator('.token-gate')).toBeVisible();
    await expect(page.getByTestId('computer-command')).toHaveCount(0);
    await expect(page.getByTestId('computer-state')).toHaveCount(0);
    await shot(page, 'auth-gate-private-cleared');
    await page.locator('.token-gate-input').fill('scope-second');
    await page.locator('.token-gate-submit').click();
    await expect(page.locator('.token-gate')).toHaveCount(0);
    await expect(entries(panel)).toContainText(['second-owner-only']);
    const late = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/computers/comp-1/commands' &&
        (response.request().headers().cookie ?? '').includes('cairn_auth=scope-first'),
    );
    release();
    await late;
    await expect(entries(panel)).toContainText(['second-owner-only']);
    await expect(page.locator('body')).not.toContainText('first-owner-only');
    await shot(page, 'auth-next-scope-after-late');
  } catch (error) {
    await testInfo.attach('browser-errors', { body: JSON.stringify(errors), contentType: 'application/json' });
    throw error;
  } finally {
    release();
  }
});

test('very long output is a scrollable tail inside the panel and never widens it', async ({
  page,
}) => {
  const long = `${'x'.repeat(4000)}\n${'line of output\n'.repeat(300)}`;
  const panel = await open(page, {
    computers: [computer()],
    commands: [
      command(1, { command: `echo ${'y'.repeat(400)}`, output: long.slice(-4096) }),
    ],
  });
  await entries(panel).nth(0).getByRole('button', { name: '输出' }).click();
  const output = entries(panel).nth(0).getByTestId('computer-command-output');
  await expect(output).toBeVisible();
  const [panelBox, outBox, entryBox] = await Promise.all([
    panel.boundingBox(),
    output.boundingBox(),
    entries(panel).nth(0).boundingBox(),
  ]);
  expect(outBox!.x + outBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
  expect(entryBox!.x + entryBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
  expect(outBox!.height).toBeLessThanOrEqual(192 + 1);
  expect(await output.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const commandLine = entries(panel).nth(0).getByTestId('computer-command-text');
  const lineBox = await commandLine.boundingBox();
  expect(lineBox!.x + lineBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
  expect(lineBox!.height).toBeLessThanOrEqual(3 * 20 + 1);
  expect(await commandLine.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await commandLine.click();
  const openBox = await commandLine.boundingBox();
  expect(openBox!.height).toBeGreaterThan(lineBox!.height);
  expect(openBox!.x + openBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 0.5);
  await commandLine.click();
  expect((await commandLine.boundingBox())!.height).toBe(lineBox!.height);
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});

test('at phone width a long command wraps inside the card and opens in full on click', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await open(page, {
    computers: [computer()],
    commands: [command(1, { command: `curl ${'https://example.com/a'.repeat(30)}`, output: '' })],
  });
  const card = entries(panel).nth(0);
  const text = card.getByTestId('computer-command-text');
  await expect(text).toBeVisible();
  const [cardBox, closed] = await Promise.all([card.boundingBox(), text.boundingBox()]);
  expect(closed!.x + closed!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
  expect(closed!.height).toBeLessThanOrEqual(3 * 20 + 1);
  await text.click();
  const full = await text.boundingBox();
  expect(full!.height).toBeGreaterThan(closed!.height);
  expect(full!.x + full!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('with a machine listed the panel still shows its card and the screen placeholder', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [computer()], commands: [command(1)] },
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
  await card.getByRole('tab', { name: 'Agent 的权限' }).click();
  await expect(card.getByText('已安装')).toHaveCount(0);
  await expect(card.getByText('未安装')).toHaveCount(0);
  await expect(card.getByRole('switch')).toHaveCount(0);
  await expect(card.getByRole('heading', { name: '能力' })).toHaveCount(0);
});

test('with no machines the list is only the add row and the hint', async ({ page }) => {
  const panel = await open(page, { computers: [], commands: [] }, [], false);
  await expect(panel.getByRole('heading', { name: '你的电脑' })).toBeVisible();
  await expect(panel.locator('[data-slot="list-card"]')).toHaveCount(1);
  await expect(panel.getByTestId('machine-list-row')).toHaveCount(0);
  await expect(panel.getByTestId('machines-add').getByRole('link', { name: '添加电脑' })).toBeVisible();
  await expect(panel).toContainText('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。');
});

test('an offline Coordinator machine reads offline in the chip and the card, with no running count', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [], commands: [] },
    [{ id: 'm1', name: 'omarchy', online: false, runningSteps: 3 }],
    false,
  );
  const chip = page.getByTestId('machines-button');
  await expect(chip).toHaveAccessibleName(/omarchy/);
  await expect(chip).toHaveAccessibleName(/离线/);
  await expect(chip).not.toHaveAccessibleName(/在跑/);
  await expect(chip.locator('span')).toHaveCount(0);
  const row = panel.locator('[data-slot="list-card"]').first();
  await expect(row).toContainText('离线');
  await expect(row).not.toContainText('在跑');
  await row.getByRole('button').click();
  await expect(panel.getByTestId('machine-screen')).toHaveCount(0);
  await expect(panel.getByTestId('machine-screen-hint')).toHaveCount(0);
});

test('the live screen enlarges and becomes interactive once control is taken', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [computer()], commands: [command(1)] },
    [{ id: 'm1', name: 'omarchy', online: true, runningSteps: 0 }],
  );
  const card = panel;
  await expect(card.getByTestId('machine-screen-expand')).toBeVisible();
  await card.getByTestId('machine-screen-expand').click();
  const enlarged = page.getByTestId('machine-screen-enlarged');
  await expect(enlarged).toBeVisible();
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute(
    'data-interactive',
    'true',
    { timeout: 15_000 },
  );
  await expect(enlarged.getByTestId('machine-screen')).toHaveAttribute('data-fill', 'true');
  await expect(page.getByText('在大屏里点击和键入')).toBeVisible();
  await page.getByRole('dialog', { name: 'omarchy' }).getByRole('button', { name: '关闭' }).click();
  await expect(enlarged).toHaveCount(0);
  await expect(card.getByTestId('machine-screen-expand')).toBeVisible();
});

test('without a computer row the machine keeps the waiting placeholder and an empty access tab', async ({
  page,
}) => {
  const panel = await open(
    page,
    { computers: [], commands: [] },
    [{ id: 'm1', name: 'omarchy', online: true, runningSteps: 0 }],
  );
  const card = panel;
  await expect(card.getByTestId('machine-screen')).toHaveCount(0);
  await expect(card.getByTestId('machine-screen-hint')).toBeVisible();
  await card.getByRole('tab', { name: 'Agent 的权限' }).click();
  await expect(card.getByRole('switch')).toHaveCount(0);
  await expect(card.getByTestId('machine-folders-empty')).toBeVisible();
});

const LONG_OUTPUT = `${'x'.repeat(4000)}\n${'line of output\n'.repeat(300)}`.slice(-4096);

const MACHINE = { id: 'm1', name: 'omarchy', online: true, kind: 'remote', maxConcurrent: 4, runningSteps: 1 };

const SHOT_SCENES: Record<string, { feed: Feed; expand: number | null; machines?: unknown[]; detail?: boolean }> = {
  machines: { feed: HISTORY_FEED, expand: null, machines: [MACHINE] },
  list: { feed: HISTORY_FEED, expand: null, machines: [MACHINE], detail: false },
  empty: { feed: { computers: [], commands: [] }, expand: null },
  history: { feed: HISTORY_FEED, expand: 1 },
  offline: {
    feed: {
      computers: [computer({ machine: { id: 'm1', name: 'omarchy', online: false } })],
      commands: [command(1)],
    },
    expand: null,
  },
  long: {
    feed: {
      computers: [computer()],
      commands: [command(1, { command: `echo ${'y'.repeat(400)}`, output: LONG_OUTPUT })],
    },
    expand: 0,
  },
};

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 390]) {
    for (const [scene, { feed, expand, machines, detail }] of Object.entries(SHOT_SCENES)) {
      test(`screenshots ${scene} ${theme} ${width}`, async ({ page }) => {
        test.skip(!SHOTS, 'screenshots only on request');
        await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
        await page.setViewportSize({ width, height: 900 });
        const panel = await open(page, feed, machines, detail);
        if (expand !== null) {
          await entries(panel).nth(expand).getByRole('button', { name: '输出' }).click();
        }
        await expect(panel).toBeVisible();
        await page.waitForTimeout(300);
        await shot(page, `${scene}-${width}-${theme}`);
      });
    }
  }
}
