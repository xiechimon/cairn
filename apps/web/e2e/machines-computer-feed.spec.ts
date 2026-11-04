import { expect, type Page, test } from '@playwright/test';
import { HISTORY, mockLive } from './chief-home-mock';

const SHOTS = process.env.D75_SHOTS;
const FAKE_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(3)}`;

const T0 = Date.now() - 2 * 3_600_000;

const id = (n: number) => n.toString(16).padStart(64, '0');
const command = (n: number, patch: Record<string, unknown> = {}) => ({
  callId: id(n),
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
  machine: { id: 'm1', name: 'omarchy', online: true },
  ...patch,
});

interface Feed {
  computers: unknown[];
  commands: unknown[];
  holdCommands?: Promise<void>;
}

async function open(page: Page, feed: Feed, machines: unknown[] = []) {
  await mockLive(page, { threads: [], messages: HISTORY, machines }, (path, _route, json) => {
    if (path === '/api/computers') return json({ computers: feed.computers });
    if (path === '/api/computers/comp-1/commands') {
      return (feed.holdCommands ?? Promise.resolve()).then(() =>
        json({ commands: feed.commands }),
      );
    }
    return undefined;
  });
  await page.goto('/app?pane=machines');
  return page.getByRole('complementary', { name: '电脑' });
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
    [{ id: 'm1', name: 'omarchy', online: true, runningSteps: 0 }],
  );
  await expect(panel.locator('[data-slot="list-card"]')).toHaveCount(2);
  await expect(panel.getByTestId('machine-screen')).toContainText('屏幕随桌面控制一起上线');
  await expect(panel.getByRole('switch', { name: '桌面控制' })).toBeDisabled();
});

const LONG_OUTPUT = `${'x'.repeat(4000)}\n${'line of output\n'.repeat(300)}`.slice(-4096);

const MACHINE = { id: 'm1', name: 'omarchy', online: true, kind: 'remote', maxConcurrent: 4, runningSteps: 1 };

const SHOT_SCENES: Record<string, { feed: Feed; expand: number | null; machines?: unknown[] }> = {
  machines: { feed: HISTORY_FEED, expand: null, machines: [MACHINE] },
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
    for (const [scene, { feed, expand, machines }] of Object.entries(SHOT_SCENES)) {
      test(`screenshots ${scene} ${theme} ${width}`, async ({ page }) => {
        test.skip(!SHOTS, 'screenshots only on request');
        await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
        await page.setViewportSize({ width, height: 900 });
        const panel = await open(page, feed, machines);
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
