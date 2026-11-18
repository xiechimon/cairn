import type {
  ComputerCall,
  ComputerFrame,
  ComputerTool,
  MachineComputerFramesBody,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import type {
  ComputerExecuteRequest,
  ComputerProcessEvent,
  ComputerProvider,
} from '../src/computer/provider.js';

const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20, cairnOrigins: [] };

const TERMINAL = {
  id: 'w-1',
  app_name: 'lxterminal',
  title: 'agent@computer: ~',
  accessible: true,
  visible: true,
  minimized: false,
  is_focused: true,
};

const TREE = {
  snapshot_id: 'snap1',
  complete: true,
  tree: {
    role: 'window',
    name: 'agent@computer: ~',
    children: [
      { ref_id: '@snap1:e2', role: 'menu', name: 'File', available_actions: ['Click'] },
      {
        ref_id: '@snap1:e3',
        role: 'textfield',
        name: 'Command',
        value: 'ls -la',
        available_actions: ['SetFocus'],
      },
    ],
  },
};

function envelope(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fakeClient() {
  const frames: ComputerFrame[] = [];
  return {
    frames,
    client: {
      async computerFrames(_callId: string, body: MachineComputerFramesBody) {
        frames.push(...body.frames);
        return { ok: true as const, cancelled: false };
      },
    },
  };
}

type Script = (argv: readonly string[]) => string | undefined;

function failure(code: string) {
  return JSON.stringify({ ok: false, error: { code, disposition: { retry: 'safe' } } });
}

function setup(script: Script = () => undefined) {
  const ran: string[][] = [];
  const provider: ComputerProvider = {
    async execute(request: ComputerExecuteRequest) {
      ran.push([...request.argv]);
      const [, command] = request.argv;
      const stdout =
        script(request.argv) ??
        (command === 'list-windows'
          ? envelope([TERMINAL])
          : command === 'snapshot'
            ? envelope(TREE)
            : command === 'get'
              ? envelope({ value: 'ls -la' })
              : envelope({ action: command }));
      return (async function* (): AsyncGenerator<ComputerProcessEvent> {
        yield { kind: 'stdout', text: stdout };
        yield { kind: 'exit', code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
  const fake = fakeClient();
  const dispatcher = createComputerDispatcher({
    client: fake.client,
    orb: { forScope: () => provider, async killAll() {} },
    ...FAST,
  });
  let counter = 0;
  const run = async (tool: ComputerTool, params: Record<string, unknown>) => {
    counter += 1;
    fake.frames.length = 0;
    await dispatcher.dispatch({
      callId: counter.toString(16).padStart(64, 'e'),
      stepId: 'step-1',
      tool,
      params,
      scopeKey: 'chief:c1',
      deadlineAt: Date.now() + 60_000,
    } satisfies ComputerCall);
    return fake.frames.find((frame) => frame.kind === 'done' || frame.kind === 'error');
  };
  return { run, ran };
}

describe('desktop_snapshot and desktop_act on a scope desktop', () => {
  test('a snapshot returns numbered elements with their text, and a click by number reaches that element', async () => {
    const { run, ran } = setup();
    const snapshot = await run('desktop_snapshot', { app: 'lxterminal' });
    expect(snapshot?.kind).toBe('done');
    if (snapshot?.kind !== 'done') return;
    expect(snapshot.text).toContain('[3] textfield "Command" = "ls -la"');
    expect(snapshot.text).toContain('[2] menu "File"');
    expect(snapshot.images ?? []).toEqual([]);

    const act = await run('desktop_act', {
      app: 'lxterminal',
      actions: [{ kind: 'click', element: 2 }],
    });
    expect(act?.kind).toBe('done');
    expect(ran).toContainEqual(['agent-desktop', 'click', '--', '@snap1:e2']);
  });

  test('type goes through physical input and read returns the value of an element', async () => {
    const { run, ran } = setup();
    await run('desktop_snapshot', { app: 'lxterminal' });
    const act = await run('desktop_act', {
      app: 'lxterminal',
      actions: [
        { kind: 'type', element: 3, text: 'echo hi' },
        { kind: 'key', key: 'Return' },
        { kind: 'read', element: 3 },
      ],
    });
    expect(act?.kind).toBe('done');
    if (act?.kind !== 'done') return;
    expect(act.text).toContain('3. read: "ls -la"');
    expect(ran).toContainEqual(['agent-desktop', 'type', '--headed', '--', '@snap1:e3', 'echo hi']);
    expect(ran).toContainEqual([
      'agent-desktop',
      'press',
      '--headed',
      '--window-id',
      'w-1',
      '--',
      'Return',
    ]);
  });

  test('without a snapshot of the app, element numbers are refused and nothing runs', async () => {
    const { run, ran } = setup();
    const act = await run('desktop_act', {
      app: 'lxterminal',
      actions: [{ kind: 'click', element: 2 }],
    });
    expect(act?.kind).toBe('error');
    expect(ran.filter((argv) => argv[1] === 'click')).toEqual([]);
  });

  test('without an app, the open apps are listed', async () => {
    const { run } = setup();
    const listed = await run('desktop_snapshot', {});
    expect(listed?.kind === 'done' && listed.text).toContain('lxterminal');
  });

  test('with no window in the accessibility tree, the reply says how to open an app', async () => {
    const { run } = setup((argv) => (argv[1] === 'list-windows' ? envelope([]) : undefined));
    const listed = await run('desktop_snapshot', {});
    expect(listed?.kind === 'done' && listed.text).toContain('Start one from the shell tool');
  });

  const CHROMIUM = {
    id: 'w-chromium-1',
    app_name: 'chromium',
    title: 'New Tab',
    accessible: true,
    visible: true,
    minimized: false,
    is_focused: false,
  };
  const CHROMIUM_TREE = {
    snapshot_id: 'chr1',
    complete: true,
    tree: {
      role: 'window',
      name: 'New Tab',
      children: [
        { ref_id: '@chr1:e2', role: 'textfield', name: 'Address', available_actions: ['SetFocus'] },
      ],
    },
  };

  function chromium(overrides: { windows?: () => unknown[]; extra?: Script } = {}): Script {
    return (argv) => {
      const extra = overrides.extra?.(argv);
      if (extra !== undefined) return extra;
      const command = argv[1];
      if (command === 'list-windows') {
        return envelope(overrides.windows ? overrides.windows() : [CHROMIUM, TERMINAL]);
      }
      if (command === 'snapshot') return envelope(CHROMIUM_TREE);
      return undefined;
    };
  }

  test('a window id that stops existing between commands is resolved again by app and title and the command retried once', async () => {
    let generation = 1;
    const { run, ran } = setup(
      chromium({
        windows: () => [{ ...CHROMIUM, id: `w-chromium-${generation}`, is_focused: true }],
        extra: (argv) => {
          if (argv[1] === 'snapshot' && argv.includes('w-chromium-1') && generation === 1) {
            generation = 2;
            return failure('WINDOW_NOT_FOUND');
          }
          return undefined;
        },
      }),
    );
    const snapshot = await run('desktop_snapshot', { app: 'chromium' });
    expect(snapshot?.kind).toBe('done');
    expect(
      ran
        .filter((argv) => argv[1] === 'snapshot')
        .map((argv) => argv[argv.indexOf('--window-id') + 1]),
    ).toEqual(['w-chromium-1', 'w-chromium-2']);
  });

  test('a window that is still not found after one re-list is reported and not retried again', async () => {
    const { run, ran } = setup(
      chromium({
        extra: (argv) => (argv[1] === 'snapshot' ? failure('WINDOW_NOT_FOUND') : undefined),
      }),
    );
    const snapshot = await run('desktop_snapshot', { app: 'chromium' });
    expect(snapshot?.kind).toBe('error');
    expect(ran.filter((argv) => argv[1] === 'snapshot')).toHaveLength(2);
  });

  test('element numbers keep working when the window id changed after the snapshot', async () => {
    let id = 'w-chromium-1';
    const { run, ran } = setup(
      chromium({ windows: () => [{ ...CHROMIUM, id, is_focused: true }] }),
    );
    await run('desktop_snapshot', { app: 'chromium' });
    id = 'w-chromium-9';
    const act = await run('desktop_act', {
      app: 'chromium',
      actions: [{ kind: 'click', element: 2 }],
    });
    expect(act?.kind).toBe('done');
    expect(ran).toContainEqual(['agent-desktop', 'click', '--', '@chr1:e2']);
  });

  test('set on a field without set-value clears it and types the value', async () => {
    const { run, ran } = setup(
      chromium({
        windows: () => [{ ...CHROMIUM, is_focused: true }],
        extra: (argv) => (argv[1] === 'set-value' ? failure('ACTION_NOT_SUPPORTED') : undefined),
      }),
    );
    await run('desktop_snapshot', { app: 'chromium' });
    const act = await run('desktop_act', {
      app: 'chromium',
      actions: [{ kind: 'set', element: 2, value: 'https://www.baidu.com' }],
    });
    expect(act?.kind).toBe('done');
    const sent = ran
      .filter((argv) => argv[1] !== 'list-windows')
      .map((argv) => argv.slice(1).join(' '));
    const from = sent.findIndex((line) => line.startsWith('set-value'));
    expect(sent.slice(from, from + 4)).toEqual([
      'set-value -- @chr1:e2 https://www.baidu.com',
      'focus --headed -- @chr1:e2',
      'press --headed --window-id w-chromium-1 -- ctrl+a',
      'type --headed -- @chr1:e2 https://www.baidu.com',
    ]);
  });

  test('type focuses the target window first and sends nothing when it cannot be focused', async () => {
    const { run, ran } = setup(
      chromium({ extra: (argv) => (argv[1] === 'focus-window' ? envelope({}) : undefined) }),
    );
    await run('desktop_snapshot', { app: 'chromium' });
    const act = await run('desktop_act', {
      app: 'chromium',
      actions: [{ kind: 'type', element: 2, text: 'https://www.baidu.com' }],
    });
    expect(act?.kind).toBe('error');
    expect(ran.some((argv) => argv[1] === 'focus-window' && argv.includes('w-chromium-1'))).toBe(
      true,
    );
    expect(ran.some((argv) => argv[1] === 'type')).toBe(false);
  });

  test('type is sent after the window reports focus, and key focuses too', async () => {
    let focused = false;
    const { run, ran } = setup(
      chromium({
        windows: () => [{ ...CHROMIUM, is_focused: focused }],
        extra: (argv) => {
          if (argv[1] === 'focus-window') {
            focused = true;
            return envelope({});
          }
          return undefined;
        },
      }),
    );
    await run('desktop_snapshot', { app: 'chromium' });
    const act = await run('desktop_act', {
      app: 'chromium',
      actions: [
        { kind: 'type', element: 2, text: 'hello' },
        { kind: 'key', key: 'Return' },
      ],
    });
    expect(act?.kind).toBe('done');
    const sent = ran.map((argv) => argv[1]);
    expect(sent.indexOf('focus-window')).toBeGreaterThanOrEqual(0);
    expect(sent.indexOf('focus-window')).toBeLessThan(sent.indexOf('type'));
    expect(sent.indexOf('type')).toBeLessThan(sent.indexOf('press'));
  });
});
