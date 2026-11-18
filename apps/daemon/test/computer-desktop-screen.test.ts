import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ComputerCall,
  ComputerFrame,
  ComputerTool,
  MachineComputerFramesBody,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { DESKTOP_PASTE_SCRIPT, DESKTOP_SCREENSHOT_SCRIPT } from '../src/computer/desktop-screen.js';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import { encodePng, pngSize } from '../src/computer/host-screen-png.js';
import type {
  ComputerExecuteRequest,
  ComputerProcessEvent,
  ComputerProvider,
} from '../src/computer/provider.js';

const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20, cairnOrigins: [] };

const SCREEN = encodePng(2000, 1000, 2, Buffer.alloc(2000 * 1000 * 3, 80)).toString('base64');

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

type Reply = { stdout?: string; stderr?: string; code: number };

function desktopProvider(reply: (argv: readonly string[]) => Reply = () => ({ code: 0 })) {
  const ran: string[][] = [];
  const stdins: Array<string | undefined> = [];
  const provider: ComputerProvider = {
    async execute(request: ComputerExecuteRequest) {
      ran.push([...request.argv]);
      stdins.push(request.stdin);
      const shot = request.argv.join(' ').includes(DESKTOP_SCREENSHOT_SCRIPT);
      const answer = shot ? { stdout: SCREEN, code: 0 } : reply(request.argv);
      return (async function* (): AsyncGenerator<ComputerProcessEvent> {
        if (answer.stdout) yield { kind: 'stdout', text: answer.stdout };
        if (answer.stderr) yield { kind: 'stderr', text: answer.stderr };
        yield { kind: 'exit', code: answer.code };
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
  return { provider, ran, stdins };
}

let counter = 0;
function call(tool: ComputerTool, params: Record<string, unknown>, scopeKey = 'chief:c1') {
  counter += 1;
  return {
    callId: counter.toString(16).padStart(64, 'd'),
    stepId: 'step-1',
    tool,
    params,
    scopeKey,
    deadlineAt: Date.now() + 60_000,
  } satisfies ComputerCall;
}

function setup(reply?: (argv: readonly string[]) => Reply) {
  const fake = fakeClient();
  const desktop = desktopProvider(reply);
  const dispatcher = createComputerDispatcher({
    client: fake.client,
    orb: { forScope: () => desktop.provider, async killAll() {} },
    ...FAST,
  });
  const run = async (tool: ComputerTool, params: Record<string, unknown>, scopeKey?: string) => {
    fake.frames.length = 0;
    await dispatcher.dispatch(call(tool, params, scopeKey));
    return fake.frames.find((frame) => frame.kind === 'done' || frame.kind === 'error');
  };
  const xdotool = () => desktop.ran.filter((argv) => argv[0] === 'xdotool');
  return { run, ran: desktop.ran, stdins: desktop.stdins, xdotool };
}

describe('computer_observe on a scope desktop', () => {
  test('returns the desktop screenshot downscaled to the long-edge cap as a PNG image', async () => {
    const { run, ran } = setup();
    const frame = await run('computer_observe', {});
    expect(frame?.kind).toBe('done');
    if (frame?.kind !== 'done') return;
    expect(frame.images).toHaveLength(1);
    const image = frame.images?.[0];
    expect(image?.mimeType).toBe('image/png');
    expect(pngSize(Buffer.from(image?.data ?? '', 'base64'))).toEqual({ width: 1568, height: 784 });
    expect(frame.text).toContain('screen 2000x1000');
    expect(frame.text).toContain('image 1568x784');
    expect(ran).toEqual([['bash', '-c', DESKTOP_SCREENSHOT_SCRIPT]]);
  });

  test('says which programs are missing when the screenshot tools are not installed', async () => {
    const fake = fakeClient();
    const provider: ComputerProvider = {
      ...desktopProvider().provider,
      async execute() {
        return (async function* (): AsyncGenerator<ComputerProcessEvent> {
          yield { kind: 'stderr', text: 'xwd: command not found\n' };
          yield { kind: 'exit', code: 127 };
        })();
      },
    };
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: { forScope: () => provider, async killAll() {} },
      ...FAST,
    });
    await dispatcher.dispatch(call('computer_observe', {}));
    expect(fake.frames.at(-1)).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: expect.stringContaining('xwd'),
    });
  });
});

describe('computer_act on a scope desktop', () => {
  test('a coordinate action before any observation is refused and nothing runs', async () => {
    const { run, ran } = setup();
    const frame = await run('computer_act', { actions: [{ kind: 'click', x: 10, y: 10 }] });
    expect(frame).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: expect.stringContaining('computer_observe'),
    });
    expect(ran).toEqual([]);
  });

  test('maps screenshot pixels back to screen pixels and runs each action through xdotool', async () => {
    const { run, xdotool } = setup();
    await run('computer_observe', {});
    const frame = await run('computer_act', {
      actions: [
        { kind: 'click', x: 784, y: 392 },
        { kind: 'double_click', x: 0, y: 0 },
        { kind: 'click', x: 100, y: 50, button: 'right' },
        { kind: 'move', x: 1567, y: 783 },
        { kind: 'drag', x: 10, y: 10, to_x: 20, to_y: 30 },
        { kind: 'scroll', direction: 'down', amount: 2, x: 784, y: 392 },
        { kind: 'scroll', direction: 'left' },
        { kind: 'type', text: 'echo hi' },
        { kind: 'key', key: 'Return' },
        { kind: 'key', key: 'ctrl+shift+t' },
      ],
    });
    expect(frame?.kind).toBe('done');
    if (frame?.kind !== 'done') return;
    expect(xdotool()).toEqual([
      ['xdotool', 'mousemove', '1000', '500', 'click', '1'],
      ['xdotool', 'mousemove', '0', '0', 'click', '--repeat', '2', '--delay', '80', '1'],
      ['xdotool', 'mousemove', '128', '64', 'click', '3'],
      ['xdotool', 'mousemove', '1999', '999'],
      [
        'xdotool',
        'mousemove',
        '13',
        '13',
        'mousedown',
        '1',
        'mousemove',
        '26',
        '38',
        'mouseup',
        '1',
      ],
      ['xdotool', 'mousemove', '1000', '500', 'click', '--repeat', '2', '5'],
      ['xdotool', 'click', '--repeat', '3', '6'],
      ['xdotool', 'type', '--delay', '12', '--', 'echo hi'],
      ['xdotool', 'key', '--clearmodifiers', '--', 'Return'],
      ['xdotool', 'key', '--clearmodifiers', '--', 'ctrl+shift+t'],
    ]);
    expect(frame.text).toContain('10. key: delivered');
    expect(frame.images).toHaveLength(1);
  });

  test('types non-ASCII text by pasting it through the clipboard instead of per-character keysyms', async () => {
    const { run, ran, stdins } = setup();
    const frame = await run('computer_act', {
      actions: [
        { kind: 'type', text: '前端工程师' },
        { kind: 'type', text: 'plain' },
      ],
    });
    expect(frame?.kind).toBe('done');
    expect(ran.slice(0, 2)).toEqual([
      ['sh', '-c', DESKTOP_PASTE_SCRIPT],
      ['xdotool', 'type', '--delay', '12', '--', 'plain'],
    ]);
    expect(stdins.slice(0, 2)).toEqual(['前端工程师', undefined]);
  });

  test('reports a missing xclip when pasting non-ASCII text', async () => {
    const { run } = setup((argv) => (argv[0] === 'sh' ? { code: 127 } : { code: 0 }));
    const frame = await run('computer_act', { actions: [{ kind: 'type', text: '你好' }] });
    expect(frame).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('needs xclip'),
    });
  });

  test('typing and keys need no observation first', async () => {
    const { run, xdotool } = setup();
    const frame = await run('computer_act', {
      actions: [
        { kind: 'type', text: 'ls' },
        { kind: 'key', key: 'Return' },
      ],
    });
    expect(frame?.kind).toBe('done');
    expect(xdotool()).toHaveLength(2);
  });

  test('observations are remembered per scope', async () => {
    const { run, ran } = setup();
    await run('computer_observe', {}, 'chief:other');
    const frame = await run('computer_act', { actions: [{ kind: 'click', x: 1, y: 1 }] });
    expect(frame).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect(ran.filter((argv) => argv[0] === 'xdotool')).toEqual([]);
  });

  test.each([
    [{ actions: [] }, 'at least one action'],
    [{ actions: [{ kind: 'teleport' }] }, 'unknown kind'],
    [{ actions: [{ kind: 'click', x: 5000, y: 1 }] }, 'outside the last screenshot'],
    [{ actions: [{ kind: 'key', key: 'ctrl+l; rm -rf' }] }, 'invalid arguments'],
    [{ actions: Array.from({ length: 25 }, () => ({ kind: 'key', key: 'a' })) }, 'At most 24'],
  ])('refuses %j before anything runs', async (params, message) => {
    const { run, xdotool } = setup();
    await run('computer_observe', {});
    const frame = await run('computer_act', params);
    expect(frame).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: expect.stringContaining(message),
    });
    expect(xdotool()).toEqual([]);
  });

  test('a failure after an earlier action ran is reported with unknown delivery', async () => {
    let calls = 0;
    const { run } = setup((argv) => {
      if (argv[0] !== 'xdotool') return { code: 0 };
      calls += 1;
      return calls === 2 ? { stderr: 'Error: no display', code: 1 } : { code: 0 };
    });
    const frame = await run('computer_act', {
      actions: [
        { kind: 'type', text: 'a' },
        { kind: 'type', text: 'b' },
        { kind: 'type', text: 'c' },
      ],
    });
    expect(frame).toMatchObject({
      kind: 'error',
      delivery: 'unknown',
      message: expect.stringContaining('Action 2 (type)'),
    });
    expect(calls).toBe(2);
  });

  test('a missing xdotool on the first action is not delivered', async () => {
    const { run } = setup((argv) => (argv[0] === 'xdotool' ? { code: 127 } : { code: 0 }));
    const frame = await run('computer_act', { actions: [{ kind: 'key', key: 'Return' }] });
    expect(frame).toMatchObject({
      kind: 'error',
      delivery: 'not_delivered',
      message: expect.stringContaining('xdotool'),
    });
  });

  test('a first action that xdotool rejects may have partly run', async () => {
    const { run } = setup((argv) => (argv[0] === 'xdotool' ? { code: 1 } : { code: 0 }));
    const frame = await run('computer_act', { actions: [{ kind: 'key', key: 'Return' }] });
    expect(frame).toMatchObject({ kind: 'error', delivery: 'unknown' });
  });
});

describe('DESKTOP_PASTE_SCRIPT paste chord', () => {
  function chordFor(wmClass: string) {
    const bin = makeTestTempDir('paste-bin-');
    const log = join(bin, 'chord.log');
    const stub = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    stub('xclip', 'cat >/dev/null');
    stub('xprop', `echo 'WM_CLASS(STRING) = ${wmClass}'`);
    stub('xdotool', `if [ "$1" = key ]; then echo "$3" >>${log}; else echo 1; fi`);
    execFileSync('sh', ['-c', DESKTOP_PASTE_SCRIPT], {
      env: { PATH: `${bin}:/usr/bin:/bin` },
      input: '前端工程师',
    });
    const chord = readFileSync(log, 'utf8').trim();
    releaseTestTempDir(bin);
    return chord;
  }

  test('pastes with ctrl+shift+v in a terminal and ctrl+v elsewhere', () => {
    expect(chordFor('"lxterminal", "Lxterminal"')).toBe('ctrl+shift+v');
    expect(chordFor('"chromium", "Chromium"')).toBe('ctrl+v');
  }, 30_000);
});
