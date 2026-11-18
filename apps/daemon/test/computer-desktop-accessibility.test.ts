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

function setup() {
  const ran: string[][] = [];
  const provider: ComputerProvider = {
    async execute(request: ComputerExecuteRequest) {
      ran.push([...request.argv]);
      const [, command] = request.argv;
      const stdout =
        command === 'list-windows'
          ? envelope([TERMINAL])
          : command === 'snapshot'
            ? envelope(TREE)
            : command === 'get'
              ? envelope({ value: 'ls -la' })
              : envelope({ action: command });
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
});
