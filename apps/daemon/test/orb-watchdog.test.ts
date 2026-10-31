import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineDoneBody } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import { createDaemonLogger } from '../src/log.js';
import { OrbLifecycle } from '../src/orb/lifecycle.js';
import { NspawnOrbProvider, type OrbCommandRunner, runOrbCommand } from '../src/orb/provider.js';
import { RelayMachineApi } from '../src/orb/relay.js';
import { runOrbStep } from '../src/orb/step.js';
import { ensureStateDirs, statePaths } from '../src/state.js';
import { CLAIMED, defer, FakeMachineApi, fakeBackend } from './machine-loop-harness.js';

function fixture(runner: OrbCommandRunner, api = new FakeMachineApi(), timeoutMs = 1_000) {
  const paths = statePaths(mkdtempSync(join(tmpdir(), 'orb-watchdog-')));
  ensureStateDirs(paths);
  const provider = new NspawnOrbProvider({ runner });
  const stop = vi.spyOn(provider, 'stop');
  const journal = new StepJournal(paths.outboxDir);
  const deps = {
    paths,
    journal,
    client: api,
    logger: createDaemonLogger({}),
    backendFor: () => fakeBackend([]).backend,
    workspacesDir: paths.workspacesDir,
    mcpConfigPath: join(paths.home, 'mcp.json'),
    orbHeartbeatTimeoutMs: timeoutMs,
  };
  const running = runOrbStep(new OrbLifecycle(provider, { max: 1 }), deps, CLAIMED);
  return { api, stop, journal, running };
}

afterEach(() => vi.useRealTimers());

test.each([0, 1, 137])(
  'orb exits mid-step with code %i and reports exactly one failed done',
  async (code) => {
    const { api, running } = fixture(async (argv) => ({
      code: argv.includes('--uid=agent') ? code : 0,
      stdout: '',
      stderr: 'worker diagnostic',
    }));
    await running;
    expect(api.doneBodies).toEqual([
      { stepId: 's1', body: { status: 'failed', errorMessage: `orb exited with code ${code}` } },
    ]);
  },
);

test('signal termination reports 128 plus the signal number exactly once', async () => {
  const { api, running } = fixture(async (argv) =>
    argv.includes('--uid=agent')
      ? runOrbCommand([process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'])
      : { code: 0, stdout: '', stderr: '' },
  );
  await running;
  expect(api.doneBodies).toEqual([
    { stepId: 's1', body: { status: 'failed', errorMessage: 'orb exited with code 143' } },
  ]);
});

test.each([false, true])(
  'silent orb is killed and reports exactly one heartbeat timeout, connected=%s',
  async (connect) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let started = false;
    let deadline = 0;
    const release = defer();
    const upstream = new FakeMachineApi();
    vi.spyOn(upstream, 'heartbeat').mockImplementation(async () => {
      deadline = Date.now() + 1_000;
    });
    const { api, stop, running, journal } = fixture(async (argv, options) => {
      if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
      signal = options?.signal;
      deadline = Date.now() + 1_000;
      signal?.addEventListener('abort', () => release.resolve(), { once: true });
      const socketPath = options?.binds?.[0]?.source;
      const relay = connect && socketPath ? await RelayMachineApi.connect(socketPath) : undefined;
      if (relay) await relay.api.heartbeat('s1');
      started = true;
      await release.promise;
      relay?.close();
      throw new Error('exec aborted');
    }, upstream);
    try {
      await vi.waitFor(() => expect(started).toBe(true), { interval: 1 });
      await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
    } finally {
      release.resolve();
      await running;
    }
    expect(stop).toHaveBeenCalledTimes(1);
    expect(api.doneBodies).toEqual([
      { stepId: 's1', body: { status: 'failed', errorMessage: 'orb heartbeat timeout' } },
    ]);
    expect(journal.pending()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test('every received heartbeat refreshes the watchdog before upstream responds', async () => {
  vi.useFakeTimers();
  const upstream = defer();
  const release = defer();
  const api = new FakeMachineApi();
  const heartbeat = vi.spyOn(api, 'heartbeat').mockImplementation(async () => upstream.promise);
  let relay: RelayMachineApi | undefined;
  let signal: AbortSignal | undefined;
  const { running, stop } = fixture(async (argv, options) => {
    if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
    signal = options?.signal;
    signal?.addEventListener('abort', () => release.resolve(), { once: true });
    relay = await RelayMachineApi.connect(options!.binds![0]!.source);
    await release.promise;
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  }, api);
  try {
    await vi.waitFor(() => expect(relay).toBeDefined(), { interval: 1 });
    for (let count = 1; count <= 3; count++) {
      await vi.advanceTimersByTimeAsync(600);
      void relay!.api.heartbeat('s1').catch(() => {});
      await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(count), { interval: 1 });
      expect(signal?.aborted).toBe(false);
      expect(api.doneBodies).toEqual([]);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(true);
  } finally {
    upstream.resolve();
    release.resolve();
    await running;
  }
  expect(stop).toHaveBeenCalledTimes(1);
  expect(api.doneBodies).toEqual([
    { stepId: 's1', body: { status: 'failed', errorMessage: 'orb heartbeat timeout' } },
  ]);
});

test('normal orb done suppresses the host fallback and clears the watchdog', async () => {
  vi.useFakeTimers();
  const release = defer();
  const completed = defer();
  const { api, running, stop } = fixture(async (argv, options) => {
    if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.binds![0]!.source);
    await relay.api.done('s1', { status: 'success' });
    completed.resolve();
    await release.promise;
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  });
  try {
    await completed.promise;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stop).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await running;
  }
  await vi.advanceTimersByTimeAsync(2_000);
  expect(stop).not.toHaveBeenCalled();
  expect(api.doneBodies).toEqual([{ stepId: 's1', body: { status: 'success' } }]);
  expect(vi.getTimerCount()).toBe(0);
});

test('orb done racing the watchdog is awaited without a second report', async () => {
  vi.useFakeTimers();
  const finish = defer();
  const release = defer();
  class Api extends FakeMachineApi {
    override async done(stepId: string, body: MachineDoneBody) {
      await finish.promise;
      await super.done(stepId, body);
    }
  }
  const api = new Api();
  const done = vi.spyOn(api, 'done');
  const { running } = fixture(async (argv, options) => {
    if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.binds![0]!.source);
    options?.signal?.addEventListener('abort', () => release.resolve(), { once: true });
    void relay.api.done('s1', { status: 'success' }).catch(() => {});
    await release.promise;
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  }, api);
  try {
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1), { interval: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
  } finally {
    finish.resolve();
    release.resolve();
    await running;
  }
  expect(done).toHaveBeenCalledTimes(1);
  expect(api.doneBodies).toEqual([{ stepId: 's1', body: { status: 'success' } }]);
});

test('a done sent after the watchdog cannot replace its failure report', async () => {
  vi.useFakeTimers();
  const release = defer();
  let relay: RelayMachineApi | undefined;
  let lateDone: Promise<void> | undefined;
  const { api, running } = fixture(async (argv, options) => {
    if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
    relay = await RelayMachineApi.connect(options!.binds![0]!.source);
    options?.signal?.addEventListener(
      'abort',
      () => {
        lateDone = expect(relay!.api.done('s1', { status: 'success' })).rejects.toThrow();
        release.resolve();
      },
      { once: true },
    );
    await release.promise;
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  });
  try {
    await vi.waitFor(() => expect(relay).toBeDefined(), { interval: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await lateDone;
  } finally {
    release.resolve();
    await running;
  }
  expect(api.doneBodies).toEqual([
    { stepId: 's1', body: { status: 'failed', errorMessage: 'orb heartbeat timeout' } },
  ]);
});

test.each(['exit', 'timeout'] as const)(
  'an awaiting-upload checkpoint without done still fails on %s',
  async (cause) => {
    vi.useFakeTimers();
    const release = defer();
    let checkpointed = false;
    const { api, running } = fixture(async (argv, options) => {
      if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
      const relay = await RelayMachineApi.connect(options!.binds![0]!.source);
      options?.signal?.addEventListener('abort', () => release.resolve(), { once: true });
      relay.send({
        type: 'checkpoint',
        checkpoint: {
          state: 'awaiting-upload',
          sessionId: null,
          sessionAction: 'new',
          prompt: null,
          doneBody: { status: 'success' },
        },
      });
      await relay.api.heartbeat('s1');
      checkpointed = true;
      if (cause === 'timeout') await release.promise;
      relay.close();
      return { code: 137, stdout: '', stderr: '' };
    });
    try {
      await vi.waitFor(() => expect(checkpointed).toBe(true), { interval: 1 });
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      release.resolve();
      await running;
    }
    expect(api.doneBodies).toEqual([
      {
        stepId: 's1',
        body: {
          status: 'failed',
          errorMessage: cause === 'timeout' ? 'orb heartbeat timeout' : 'orb exited with code 137',
        },
      },
    ]);
  },
);
