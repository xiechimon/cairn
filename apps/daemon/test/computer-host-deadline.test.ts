import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
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
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (stage === 'realpath') {
    vi.mocked(realpath).mockImplementationOnce(async () => {
      entered();
      await gate;
      return root;
    });
  } else {
    vi.mocked(stat).mockImplementationOnce(async () => {
      entered();
      await gate;
      return actualFs.stat(root);
    });
  }
  return { started, release };
}

async function collect(events: AsyncIterable<ComputerProcessEvent>) {
  const result: ComputerProcessEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe.each(['realpath', 'stat'] as const)('host preflight delayed at %s', (stage) => {
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
