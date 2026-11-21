import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  AgentDesktopHostScreen,
  SCREEN_MAX_ACTIONS,
  type ScreenOutcome,
} from '../src/computer/host-screen.js';
import { fitPng, pngSize } from '../src/computer/host-screen-png.js';
import {
  call,
  type FakeRule,
  type FakeScreen,
  FIXTURES,
  fakeScreen,
  filteredPng,
  noisePng,
  solidPng,
} from './host-screen-fake.js';

const SNAPSHOT_ID = (
  JSON.parse(readFileSync(path.join(FIXTURES, 'snapshot-wayland-gtk4.json'), 'utf8')) as {
    data: { snapshot_id: string };
  }
).data.snapshot_id;

const created: FakeScreen[] = [];

afterEach(() => {
  for (const fake of created.splice(0)) fake.cleanup();
});

function setup(
  rules: FakeRule[],
  options: Partial<ConstructorParameters<typeof AgentDesktopHostScreen>[0]> = {},
) {
  const fake = fakeScreen(rules, options);
  created.push(fake);
  return fake;
}

const listWindows: FakeRule = { command: 'list-windows', fixture: 'list-windows-wayland-gtk4' };
const snapshot: FakeRule = { command: 'snapshot', fixture: 'snapshot-wayland-gtk4' };
const windowShotRefused: FakeRule = {
  command: 'screenshot',
  has: ['--window-id'],
  fixture: 'refusal-screenshot-window-wayland',
};

function fullShot(png: Buffer): FakeRule {
  return {
    command: 'screenshot',
    fixture: 'screenshot-full-wayland',
    replace: { __PNG_BASE64__: png.toString('base64') },
  };
}

function observing(png = solidPng(64, 36)): FakeRule[] {
  return [listWindows, snapshot, windowShotRefused, fullShot(png)];
}

function error(outcome: ScreenOutcome) {
  if (outcome.kind !== 'error') throw new Error(`expected an error, got ${outcome.text}`);
  return outcome;
}

function done(outcome: ScreenOutcome) {
  if (outcome.kind !== 'done') throw new Error(`expected done, got ${outcome.message}`);
  return outcome;
}

describe('observe', () => {
  test('returns bounded accessibility rows with element numbers and a whole-screen screenshot', async () => {
    const fake = setup(observing());
    const result = done(await fake.screen.observe(call({ app: 'Nautilus' })));
    expect(result.text).toContain(`snapshot: ${SNAPSHOT_ID}`);
    expect(result.text).toContain('[17] switch "Search Everywhere"');
    expect(result.text).toContain('option "Open Personal Folder"');
    expect(result.text).toContain('the whole screen, other windows included');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.mimeType).toBe('image/png');
    expect(fake.commands()).toEqual(['list-windows', 'snapshot', 'screenshot', 'screenshot']);
  });

  test('stops asking for a window screenshot once Wayland refused it', async () => {
    const fake = setup(observing());
    await fake.screen.observe(call({ app: 'nautilus' }));
    const before = fake
      .calls()
      .filter(
        (entry) => entry.argv.includes('--window-id') && entry.argv[0] === 'screenshot',
      ).length;
    await fake.screen.observe(call({ app: 'nautilus' }));
    const after = fake
      .calls()
      .filter(
        (entry) => entry.argv.includes('--window-id') && entry.argv[0] === 'screenshot',
      ).length;
    expect(before).toBe(1);
    expect(after).toBe(1);
  });

  test('query searches by text instead of walking the whole tree', async () => {
    const fake = setup([
      listWindows,
      { command: 'find', fixture: 'find-wayland-gtk4' },
      windowShotRefused,
      fullShot(solidPng(8, 8)),
    ]);
    const result = done(await fake.screen.observe(call({ app: 'nautilus', query: 'Back' })));
    expect(result.text).toContain('button "Back"');
    expect(fake.commands()).toContain('find');
    expect(fake.commands()).not.toContain('snapshot');
    const find = fake.calls().find((entry) => entry.argv[0] === 'find');
    expect(find?.argv).toEqual(expect.arrayContaining(['--text', 'Back', '--limit', '50']));
  });

  test('a screenshot failure still returns the rows', async () => {
    const fake = setup([
      listWindows,
      snapshot,
      windowShotRefused,
      {
        command: 'screenshot',
        stdout: JSON.stringify({
          version: '2.6',
          ok: false,
          command: 'screenshot',
          error: {
            code: 'PERM_DENIED',
            message: 'denied',
            disposition: { delivery: 'not_delivered', retry: 'safe' },
          },
        }),
      },
    ]);
    const result = done(await fake.screen.observe(call({ app: 'nautilus' })));
    expect(result.images).toEqual([]);
    expect(result.text).toContain('screenshot: unavailable (PERM_DENIED)');
    expect(result.text).toContain('switch "Search Everywhere"');
  });

  test('a large screenshot is downscaled to 1568 pixels on its long edge', async () => {
    const fake = setup(observing(solidPng(3200, 1800)));
    const result = done(await fake.screen.observe(call({ app: 'nautilus' })));
    const image = Buffer.from(result.images[0]?.data ?? '', 'base64');
    expect(pngSize(image)).toEqual({ width: 1568, height: 882 });
    expect(result.text).toContain('1568x882');
  });

  test('a screenshot that cannot fit the base64 cap is omitted with a note', async () => {
    const fake = setup(observing(noisePng(900, 600)), { imageMaxBase64Chars: 100 });
    const result = done(await fake.screen.observe(call({ app: 'nautilus' })));
    expect(result.images).toEqual([]);
    expect(result.text).toContain('omitted because it could not be reduced under the size cap');
    expect(result.text).toContain('switch "Search Everywhere"');
  });

  test('rejects a missing app and an unknown app with the open app names', async () => {
    const fake = setup(observing());
    expect(error(await fake.screen.observe(call({}))).delivery).toBe('not_delivered');
    const missing = error(await fake.screen.observe(call({ app: 'ghost' })));
    expect(missing.delivery).toBe('not_delivered');
    expect(missing.message).toContain('Open apps with windows: nautilus');
  });

  test('creates its state directory private to the daemon user', async () => {
    const fake = setup(observing());
    await fake.screen.observe(call({ app: 'nautilus' }));
    const home = fake.calls()[0]?.home ?? '';
    expect(home).toBe(path.join(fake.dir, 'state'));
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  test('passes agent-desktop only the session environment', async () => {
    const fake = setup(observing());
    await fake.screen.observe(call({ app: 'nautilus' }));
    const names = fake.calls()[0]?.env ?? [];
    expect(names).toContain('AGENT_DESKTOP_HOME');
    expect(names).not.toContain('GITHUB_TOKEN');
  });
});

describe('act', () => {
  const observed = async (fake: FakeScreen) => {
    done(await fake.screen.observe(call({ app: 'nautilus' })));
  };

  test('a semantic click runs by ref and returns the new observation', async () => {
    const fake = setup([...observing(), { command: 'click', fixture: 'click-semantic-ok' }]);
    await observed(fake);
    const result = done(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 17 }] })),
    );
    expect(result.text).toContain('1. click: delivered');
    expect(result.text).toContain('switch "Search Everywhere"');
    expect(result.images).toHaveLength(1);
    const click = fake.calls().find((entry) => entry.argv[0] === 'click');
    expect(click?.argv).toEqual(['click', '--', `@${SNAPSHOT_ID}:e17`]);
  });

  test('a key on a Wayland window returns the refusal as is and delivered nothing', async () => {
    const fake = setup([
      ...observing(),
      { command: 'press', fixture: 'refusal-key-no-remote-desktop' },
    ]);
    const raw = readFileSync(
      path.join(FIXTURES, 'refusal-key-no-remote-desktop.json'),
      'utf8',
    ).trim();
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'key', key: 'Escape' }] })),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain(raw);
    expect(result.message).toContain('org.gnome.Mutter.RemoteDesktop');
    const press = fake.calls().find((entry) => entry.argv[0] === 'press');
    expect(press?.argv).toContain('--headed');
  });

  test('modifier keys become a linux chord', async () => {
    const fake = setup([
      ...observing(),
      { command: 'press', fixture: 'refusal-key-wayland-window' },
    ]);
    const result = error(
      await fake.screen.act(
        call({
          app: 'nautilus',
          actions: [{ kind: 'key', key: 'L', modifiers: ['cmd', 'option'] }],
        }),
      ),
    );
    expect(result.message).toContain('wayland_session');
    expect(
      fake
        .calls()
        .find((entry) => entry.argv[0] === 'press')
        ?.argv.at(-1),
    ).toBe('ctrl+alt+l');
  });

  test('a raw coordinate click is refused before any target lookup or input', async () => {
    const fake = setup([...observing(), { command: 'mouse-click', fixture: 'click-semantic-ok' }]);
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', x: 5, y: 7 }] })),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain('receiver');
    expect(fake.calls()).toEqual([]);
  });

  test('a raw coordinate click after an otherwise valid action rejects the entire batch', async () => {
    const fake = setup([...observing(), { command: 'press', fixture: 'click-semantic-ok' }]);
    const result = error(
      await fake.screen.act(
        call({
          app: 'nautilus',
          actions: [
            { kind: 'key', key: 'Escape' },
            { kind: 'click', x: 5, y: 7 },
          ],
        }),
      ),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(fake.calls()).toEqual([]);
  });

  test('a double click by element returns the Wayland pointer refusal', async () => {
    const fake = setup([
      ...observing(),
      { command: 'double-click', fixture: 'refusal-pointer-wayland' },
    ]);
    await observed(fake);
    const result = error(
      await fake.screen.act(
        call({ app: 'nautilus', actions: [{ kind: 'click', element: 8, double: true }] }),
      ),
    );
    expect(result.message).toContain(
      'physical pointer input is not available through the compositor on Wayland',
    );
    expect(result.delivery).toBe('not_delivered');
  });

  test('a stale ref surfaces the error with its retry disposition', async () => {
    const fake = setup([...observing(), { command: 'click', fixture: 'error-stale-ref' }]);
    await observed(fake);
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 99 }] })),
    );
    expect(result.message).toContain('STALE_REF');
    expect(result.message).toMatch(/"retry":\s*"safe"/);
    expect(result.message).toContain('refresh_snapshot_then_retry_original');
    expect(result.delivery).toBe('not_delivered');
  });

  test('a safe refusal after an earlier delivered action reports unknown delivery', async () => {
    const fake = setup([
      ...observing(),
      { command: 'click', has: [`@${SNAPSHOT_ID}:e17`], fixture: 'click-semantic-ok' },
      { command: 'click', fixture: 'error-stale-ref' },
    ]);
    await observed(fake);
    const result = error(
      await fake.screen.act(
        call({
          app: 'nautilus',
          actions: [
            { kind: 'click', element: 17 },
            { kind: 'click', element: 99 },
          ],
        }),
      ),
    );
    expect(result.delivery).toBe('unknown');
    expect(result.message).toContain('1 earlier action(s) already ran');
  });

  test('a failure whose retry is not safe reports unknown delivery', async () => {
    const fake = setup([...observing(), { command: 'click', fixture: 'error-timeout-unknown' }]);
    await observed(fake);
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 17 }] })),
    );
    expect(result.delivery).toBe('unknown');
    expect(result.message).toContain('TIMEOUT');
  });

  test('more than 24 actions are refused before anything runs', async () => {
    const fake = setup(observing());
    const actions = Array.from({ length: SCREEN_MAX_ACTIONS + 1 }, () => ({ kind: 'wait', ms: 1 }));
    const result = error(await fake.screen.act(call({ app: 'nautilus', actions })));
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain('At most 24 actions');
    expect(fake.calls()).toEqual([]);
  });

  test('exactly 24 actions are accepted', async () => {
    const fake = setup(observing());
    const actions = Array.from({ length: SCREEN_MAX_ACTIONS }, () => ({ kind: 'wait', ms: 1 }));
    done(await fake.screen.act(call({ app: 'nautilus', actions })));
  });

  test.each([
    [{ kind: 'drag' }],
    [{ kind: 'click', element: 0 }],
    [{ kind: 'click' }],
    [{ kind: 'click', x: 2 }],
    [{ kind: 'click', element: 3, x: 2, y: 4 }],
    [{ kind: 'wait', ms: 60_000 }],
    [{ kind: 'key' }],
    ['click'],
    [null],
  ])('an invalid action %j is refused before anything runs', async (action) => {
    const fake = setup(observing());
    const result = error(await fake.screen.act(call({ app: 'nautilus', actions: [action] })));
    expect(result.delivery).toBe('not_delivered');
    expect(fake.calls()).toEqual([]);
  });

  test('an unknown kind names the allowed kinds', async () => {
    const fake = setup(observing());
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'drag' }] })),
    );
    expect(result.message).toContain('unknown kind');
    expect(result.message).toContain('click, type, set, key, scroll, menu, wait');
  });

  test('an element number before any observation is refused without running', async () => {
    const fake = setup(observing());
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 3 }] })),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain('Observe nautilus before using element numbers');
    expect(fake.commands()).not.toContain('click');
  });

  test('a later malformed click cannot follow an earlier delivered action', async () => {
    const fake = setup([...observing(), { command: 'press', fixture: 'click-semantic-ok' }]);
    const result = error(
      await fake.screen.act(
        call({
          app: 'nautilus',
          actions: [
            { kind: 'key', key: 'Escape' },
            { kind: 'click', x: 1 },
          ],
        }),
      ),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(fake.calls()).toEqual([]);
  });

  test('a wait never outlives its call budget', async () => {
    const fake = setup(observing());
    const started = Date.now();
    const result = error(
      await fake.screen.act(
        call(
          { app: 'nautilus', actions: [{ kind: 'wait', ms: 10000 }] },
          { deadlineAt: started + 6200 },
        ),
      ),
    );
    expect(Date.now() - started).toBeLessThan(2500);
    expect(result.message).toContain('deadline');
  });

  test('shutdown interrupts a wait before later input', async () => {
    const fake = setup([...observing(), { command: 'press', fixture: 'click-semantic-ok' }]);
    const pending = fake.screen.act(
      call({
        app: 'nautilus',
        actions: [
          { kind: 'wait', ms: 5000 },
          { kind: 'key', key: 'Escape' },
        ],
      }),
    );
    setTimeout(() => void fake.screen.killAll(), 200);
    const result = error(await pending);
    expect(result.delivery).toBe('unknown');
    expect(fake.commands()).not.toContain('press');
  });

  test('refs from another window cannot drive the current target', async () => {
    const fake = setup([...observing(), { command: 'click', fixture: 'click-semantic-ok' }]);
    await observed(fake);
    const scenarioPath = path.join(fake.dir, 'scenario.json');
    const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
    const windows = JSON.parse(
      readFileSync(path.join(FIXTURES, 'list-windows-wayland-gtk4.json'), 'utf8'),
    );
    windows.data[0].id = 'another-window';
    scenario.rules[0] = { command: 'list-windows', stdout: JSON.stringify(windows) };
    writeFileSync(scenarioPath, JSON.stringify(scenario));
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 17 }] })),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(fake.commands()).not.toContain('click');
  });

  test('missing refs cannot fail after earlier input in a batch', async () => {
    const fake = setup([...observing(), { command: 'press', fixture: 'click-semantic-ok' }]);
    const result = error(
      await fake.screen.act(
        call({
          app: 'nautilus',
          actions: [
            { kind: 'key', key: 'Escape' },
            { kind: 'click', element: 17 },
          ],
        }),
      ),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(fake.commands()).not.toContain('press');
  });

  test('a wait action sleeps without calling agent-desktop', async () => {
    const fake = setup(observing());
    done(await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'wait', ms: 5 }] })));
    expect(fake.commands()).not.toContain('wait');
  });

  test('a menu path clicks each item and reports a missing item', async () => {
    const fake = setup([
      ...observing(),
      {
        command: 'find',
        stdout: JSON.stringify({
          version: '2.6',
          ok: true,
          command: 'find',
          data: { match: null },
        }),
      },
    ]);
    const result = error(
      await fake.screen.act(
        call({ app: 'nautilus', actions: [{ kind: 'menu', path: ['File', 'Quit'] }] }),
      ),
    );
    expect(result.message).toContain('has no menu item File > Quit');
    expect(result.delivery).toBe('not_delivered');
  });
});

describe('Cairn itself', () => {
  test('the Cairn app window is never driven', async () => {
    const fake = setup([
      {
        command: 'list-windows',
        fixture: 'list-windows-wayland-gtk4',
        override: (value) => {
          const listed = value as { data: Record<string, unknown>[] };
          return {
            ...listed,
            data: listed.data.map((window) => ({
              ...window,
              app_name: 'Cairn',
              title: 'Cairn',
              pid: process.pid,
            })),
          };
        },
      },
    ]);
    const observed = error(await fake.screen.observe(call({ app: 'Cairn' })));
    expect(observed.message).toBe('This window shows the cairn web app; it is never driven');
    const acted = error(
      await fake.screen.act(call({ app: 'Cairn', actions: [{ kind: 'key', key: 'j' }] })),
    );
    expect(acted.message).toBe('This window shows the cairn web app; it is never driven');
    expect(fake.commands()).not.toContain('snapshot');
  });

  test('a browser window showing the cairn web app is refused by its title', async () => {
    const fake = setup([
      {
        command: 'list-windows',
        fixture: 'list-windows-wayland-gtk4',
        override: (value) => {
          const listed = value as { data: Record<string, unknown>[] };
          return {
            ...listed,
            data: listed.data.map((window) => ({
              ...window,
              app_name: 'google-chrome',
              title: 'Cairn - Threads',
              pid: process.pid,
            })),
          };
        },
      },
    ]);
    const result = error(await fake.screen.observe(call({ app: 'google-chrome' })));
    expect(result.message).toBe('This window shows the cairn web app; it is never driven');
    expect(fake.commands()).not.toContain('snapshot');
  });

  test('a browser window whose page shows a cairn origin is refused by its contents', async () => {
    const fake = setup(
      [
        {
          command: 'list-windows',
          fixture: 'list-windows-wayland-gtk4',
          override: (value) => {
            const listed = value as { data: Record<string, unknown>[] };
            return {
              ...listed,
              data: listed.data.map((window) => ({
                ...window,
                app_name: 'google-chrome',
                title: 'Threads',
                pid: process.pid,
              })),
            };
          },
        },
        {
          command: 'snapshot',
          stdout: JSON.stringify({
            ok: true,
            command: 'snapshot',
            data: {
              complete: true,
              snapshot_id: 'snap-cairn-page',
              tree: {
                role: 'window',
                children: [{ role: 'address_bar', value: 'http://127.0.0.1:5273/app/tasks' }],
              },
            },
          }),
        },
        windowShotRefused,
        fullShot(solidPng(8, 8)),
      ],
      { cairnOrigins: ['http://127.0.0.1:5273'] },
    );
    const result = error(await fake.screen.observe(call({ app: 'google-chrome' })));
    expect(result.message).toBe('This window shows the cairn web app; it is never driven');
    expect(fake.commands()).not.toContain('screenshot');
  });
});

describe('failures', () => {
  test('a missing binary is not_delivered with a clear message', async () => {
    const fake = setup([]);
    const missing = new AgentDesktopHostScreen({
      binary: path.join(fake.dir, 'nope', 'agent-desktop'),
      stateDir: path.join(fake.dir, 'state'),
      env: { PATH: process.env.PATH },
    });
    const result = error(await missing.observe(call({ app: 'nautilus' })));
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain('could not be started');
    expect(result.message).toContain('reinstall the Cairn app');
  });

  test('a command that outlives its timeout is killed and reports unknown', async () => {
    const fake = setup(
      [
        listWindows,
        snapshot,
        windowShotRefused,
        fullShot(solidPng(8, 8)),
        { command: 'click', fixture: 'click-semantic-ok', delayMs: 10_000 },
      ],
      { commandTimeoutMs: 2_000 },
    );
    done(await fake.screen.observe(call({ app: 'nautilus' })));
    const started = Date.now();
    const result = error(
      await fake.screen.act(call({ app: 'nautilus', actions: [{ kind: 'click', element: 17 }] })),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.delivery).toBe('unknown');
    expect(result.message).toContain('timed out');
  });

  test('output over the cap is bounded and fails the command', async () => {
    const fake = setup(
      [{ command: 'list-windows', fixture: 'list-windows-wayland-gtk4', floodBytes: 200_000 }],
      {
        outputCapBytes: 10_000,
      },
    );
    const result = error(await fake.screen.observe(call({ app: 'nautilus' })));
    expect(result.message).toContain('more output than the 10000 byte cap');
    expect(result.message.length).toBeLessThan(500);
  });

  test('output that is not an envelope is reported without echoing it', async () => {
    const fake = setup([{ command: 'list-windows', stdout: 'SECRET-LOOKING TEXT' }]);
    const result = error(await fake.screen.observe(call({ app: 'nautilus' })));
    expect(result.message).toContain('not an agent-desktop JSON envelope');
    expect(result.message).not.toContain('SECRET');
  });

  test('a cancelled call kills the running command and reports unknown', async () => {
    const controller = new AbortController();
    const fake = setup([
      ...observing(),
      { command: 'click', fixture: 'click-semantic-ok', delayMs: 10_000 },
    ]);
    done(await fake.screen.observe(call({ app: 'nautilus' })));
    const pending = fake.screen.act(
      call(
        { app: 'nautilus', actions: [{ kind: 'click', element: 17 }] },
        { signal: controller.signal },
      ),
    );
    setTimeout(() => controller.abort(), 200);
    const result = error(await pending);
    expect(result.delivery).toBe('unknown');
    expect(result.message).toContain('cancelled');
  });

  test('killAll stops a running command', async () => {
    const fake = setup([
      ...observing(),
      { command: 'click', fixture: 'click-semantic-ok', delayMs: 10_000 },
    ]);
    done(await fake.screen.observe(call({ app: 'nautilus' })));
    const pending = fake.screen.act(
      call({ app: 'nautilus', actions: [{ kind: 'click', element: 17 }] }),
    );
    setTimeout(() => void fake.screen.killAll(), 200);
    expect(error(await pending).delivery).toBe('unknown');
  });

  test('a call with no time left is refused before anything runs', async () => {
    const fake = setup(observing());
    const result = error(
      await fake.screen.observe(call({ app: 'nautilus' }, { deadlineAt: Date.now() + 2_000 })),
    );
    expect(result.delivery).toBe('not_delivered');
    expect(result.message).toContain('Too little time');
    expect(fake.calls()).toEqual([]);
  });
});

describe('png fitting', () => {
  test('keeps an image already within the edge', () => {
    const png = solidPng(40, 20);
    expect(fitPng(png, 100)?.png).toBe(png);
  });

  test('averages blocks and decodes every scanline filter', () => {
    const pixels = Buffer.alloc(4 * 4 * 3);
    for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37 + 11) & 0xff;
    const png = filteredPng(4, 4, pixels, [1, 2, 3, 4]);
    const fitted = fitPng(png, 2);
    expect(fitted).toMatchObject({ width: 2, height: 2 });
    const reference = fitPng(filteredPng(4, 4, pixels, [0]), 2);
    expect(fitted?.png.equals(reference?.png ?? Buffer.alloc(0))).toBe(true);
    const expectedFirst = [0, 1, 2].map((channel) =>
      Math.round(
        ([0, 1, 4, 5] as const).reduce<number>(
          (sum, offset) => sum + (pixels[offset * 3 + channel] ?? 0),
          0,
        ) / 4,
      ),
    );
    const again = fitPng(fitted?.png ?? Buffer.alloc(0), 2);
    expect(again?.width).toBe(2);
    expect(expectedFirst).toHaveLength(3);
  });

  test('returns undefined for data that is not a supported png', () => {
    expect(fitPng(Buffer.from('not a png'), 10)).toBeUndefined();
  });
});
