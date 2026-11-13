import { spawn } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createComputerDispatcher } from '../src/computer/dispatch.js';
import type { ComputerFrameBody } from '../src/computer/frame-poster.js';
import { HostComputerProvider } from '../src/computer/host.js';
import type { ComputerProcessEvent } from '../src/computer/provider.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

test('shutdown after host start retains ambiguous delivery', async () => {
  const marker = path.join(root, 'started');
  const frames: ComputerFrameBody[] = [];
  let dispatcher: ReturnType<typeof createComputerDispatcher>;
  dispatcher = createComputerDispatcher({
    host: {
      async execute() {
        writeFileSync(marker, 'started');
        queueMicrotask(() => void dispatcher.close());
        return (async function* () {
          yield { kind: 'exit' as const, code: 130, reason: 'aborted' as const };
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
    },
    client: {
      async computerFrames(_callId, body) {
        frames.push(...body.frames);
        return { ok: true, cancelled: false };
      },
    },
  });
  try {
    await dispatcher.dispatch({
      callId: 'f'.repeat(64),
      stepId: 'step',
      tool: 'user_computer_shell',
      params: { command: 'true' },
      deadlineAt: Date.now() + 60000,
    });
    expect(existsSync(marker)).toBe(true);
    expect(frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'unknown' });
  } finally {
    await dispatcher.close();
  }
});

test('a completed command keeps its result while output drains past the execution budget', async () => {
  provider = new HostComputerProvider({ home: root, killGraceMs: 20, streamDrainMs: 3000 });
  const frames: ComputerFrameBody[] = [];
  const dispatcher = createComputerDispatcher({
    host: provider,
    commandTimeoutMs: 2000,
    client: {
      async computerFrames(_callId, body) {
        frames.push(...body.frames);
        return { ok: true, cancelled: false };
      },
    },
  });
  try {
    await dispatcher.dispatch({
      callId: '0'.repeat(64),
      stepId: 'step',
      tool: 'user_computer_shell',
      params: { command: 'true' },
      deadlineAt: Date.now() + 60000,
    });
    expect(frames.at(-1)).toMatchObject({ kind: 'done', exitCode: 0 });
  } finally {
    await dispatcher.close();
  }
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: vi.fn(actual.realpath), stat: vi.fn(actual.stat) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let allocatedRoot: string;
let root: string;
let provider: HostComputerProvider;

beforeEach(() => {
  allocatedRoot = makeTestTempDir('co');
  root = realpathSync(allocatedRoot);
  provider = new HostComputerProvider({ home: root, killGraceMs: 20, streamDrainMs: 10 });
  vi.mocked(realpath).mockImplementation(actualFs.realpath);
  vi.mocked(stat).mockImplementation(actualFs.stat);
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await provider.killAll();
  expect(releaseTestTempDir(allocatedRoot)).toBe(true);
});

function holdPreflight(stage: 'realpath' | 'stat') {
  let entered: () => void = () => {};
  let release: () => void = () => {};
  let completed: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  if (stage === 'realpath') {
    vi.mocked(realpath).mockImplementationOnce(async () => {
      entered();
      await gate;
      completed();
      return root;
    });
  } else {
    vi.mocked(stat).mockImplementationOnce(async () => {
      entered();
      await gate;
      const info = await actualFs.stat(root);
      completed();
      return info;
    });
  }
  return { started, release, finished };
}

async function bounded<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('host preflight did not settle')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function collect(events: AsyncIterable<ComputerProcessEvent>) {
  const result: ComputerProcessEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe.each(['realpath', 'stat'] as const)('host preflight delayed at %s', (stage) => {
  test.each(['timeout', 'shutdown'] as const)(
    'the direct provider settles %s while lookup stays unresolved',
    async (stop) => {
      const marker = path.join(root, 'started');
      const gate = holdPreflight(stage);
      const controller = new AbortController();
      const pending = provider.execute({
        argv: [
          process.execPath,
          '-e',
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late')`,
        ],
        timeoutMs: stop === 'timeout' ? 50 : 1000,
        signal: controller.signal,
      });
      await gate.started;
      if (stop === 'shutdown') await provider.killAll();
      try {
        const events = await bounded(pending, 500);
        const result = await collect(events);
        expect(result.at(-1)).toMatchObject({
          kind: 'exit',
          code: stop === 'timeout' ? 124 : 130,
          delivery: 'not_delivered',
        });
        expect(
          result.flatMap((event) => (event.kind === 'stderr' ? [event.text] : [])).join(''),
        ).not.toContain('killed');
      } finally {
        gate.release();
        await gate.finished;
        await pending;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(vi.mocked(spawn).mock.calls.length).toBe(0);
      expect(existsSync(marker)).toBe(false);
      if (stage === 'realpath') {
        expect(vi.mocked(realpath).mock.calls.length).toBe(1);
        expect(vi.mocked(stat).mock.calls.length).toBe(0);
      }
    },
  );

  test.each(['timeout', 'shutdown'] as const)(
    'the dispatcher sends a terminal refusal on %s without awaiting lookup',
    async (stop) => {
      const marker = path.join(root, 'started');
      const gate = holdPreflight(stage);
      const frames: ComputerFrameBody[] = [];
      const dispatcher = createComputerDispatcher({
        host: provider,
        client: {
          async computerFrames(_callId, body) {
            frames.push(...body.frames);
            return { ok: true, cancelled: false };
          },
        },
      });
      const running = dispatcher.dispatch({
        callId: 'e'.repeat(64),
        stepId: 'step',
        tool: 'user_computer_shell',
        params: { command: `printf late > '${marker.replaceAll("'", "'\\''")}'` },
        deadlineAt: Date.now() + 6100,
      });
      await gate.started;
      const closing = stop === 'shutdown' ? dispatcher.close() : undefined;
      try {
        await bounded(running, stop === 'timeout' ? 2000 : 500);
        if (closing) await bounded(closing, 500);
        expect(frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
      } finally {
        gate.release();
        await gate.finished;
        await running;
        await closing;
        await dispatcher.close();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(vi.mocked(spawn).mock.calls.length).toBe(0);
      expect(existsSync(marker)).toBe(false);
      if (stage === 'realpath') {
        expect(vi.mocked(realpath).mock.calls.length).toBe(1);
        expect(vi.mocked(stat).mock.calls.length).toBe(0);
      }
    },
  );

  test('the direct provider counts preflight time against its timeout', async () => {
    const marker = path.join(root, 'started');
    const gate = holdPreflight(stage);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    const pending = provider.execute({
      argv: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late')`,
      ],
      timeoutMs: 1000,
      signal: new AbortController().signal,
    });
    await gate.started;
    clock.mockReturnValue(11001);
    gate.release();
    const events = await pending;
    clock.mockRestore();
    const result = await collect(events);
    expect(vi.mocked(spawn).mock.calls.length).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(result.at(-1)).toMatchObject({ kind: 'exit', code: 124, reason: 'timeout' });
  });

  test.each(['timeout', 'shutdown'] as const)(
    'dispatcher %s during preflight never starts a child or writes input',
    async (stop) => {
      const marker = path.join(root, 'started');
      const gate = holdPreflight(stage);
      const execute = vi.spyOn(provider, 'execute');
      const frames: ComputerFrameBody[] = [];
      const dispatcher = createComputerDispatcher({
        host: provider,
        client: {
          async computerFrames(_callId, body) {
            frames.push(...body.frames);
            return { ok: true, cancelled: false };
          },
        },
      });
      const running = dispatcher.dispatch({
        callId: 'd'.repeat(64),
        stepId: 'step',
        tool: 'user_computer_shell',
        params: { command: `printf late > '${marker.replaceAll("'", "'\\''")}'` },
        deadlineAt: Date.now() + 6100,
      });
      await gate.started;
      const closing = stop === 'shutdown' ? dispatcher.close() : undefined;
      if (stop === 'timeout') await new Promise((resolve) => setTimeout(resolve, 1200));
      const aborted = execute.mock.calls[0]?.[0].signal.aborted;
      gate.release();
      await running;
      await closing;
      await dispatcher.close();
      expect(aborted).toBe(true);
      expect(vi.mocked(spawn).mock.calls.length).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(frames.at(-1)).toMatchObject({ kind: 'error' });
      if (stop === 'timeout')
        expect(frames.at(-1)).toHaveProperty('message', expect.stringContaining('timed out'));
    },
  );
});
