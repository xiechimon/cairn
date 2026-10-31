import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineDoneBody } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import { createDaemonLogger } from '../src/log.js';
import { MachineApiError } from '../src/machine-client.js';
import { OrbLifecycle } from '../src/orb/lifecycle.js';
import { runOrbCommand } from '../src/orb/provider.js';
import { RelayMachineApi } from '../src/orb/relay.js';
import { runOrbStep } from '../src/orb/step.js';
import { ensureStateDirs, statePaths } from '../src/state.js';
import { StepStops } from '../src/step-stops.js';
import { boot, CLAIMED, defer, FakeMachineApi, fakeBackend } from './machine-loop-harness.js';
import { FakeOrbProvider, type FakeOrbRunner } from './orb-fake.js';

function fixture(runner: FakeOrbRunner, api = new FakeMachineApi(), timeoutMs = 1_000) {
  const paths = statePaths(mkdtempSync(join(tmpdir(), 'orb-watchdog-')));
  ensureStateDirs(paths);
  const provider = new FakeOrbProvider({ runner });
  const stop = vi.spyOn(provider, 'stop');
  const journal = new StepJournal(paths.outboxDir);
  const stops = new StepStops();
  const deps = {
    paths,
    journal,
    client: api,
    logger: createDaemonLogger({}),
    backendFor: () => fakeBackend([]).backend,
    workspacesDir: paths.workspacesDir,
    mcpConfigPath: join(paths.home, 'mcp.json'),
    orbHeartbeatTimeoutMs: timeoutMs,
    stops,
  };
  const running = runOrbStep(new OrbLifecycle(provider, { max: 1 }), deps, CLAIMED);
  return { api, stop, journal, running, stops };
}

afterEach(() => vi.useRealTimers());

test.each([0, 1, 137])(
  'worker disconnect after simulated exit %i reports exactly one failed done',
  async (code) => {
    const { api, running } = fixture(async (argv) => ({
      code: argv[0] === 'orb-worker' ? code : 0,
      stdout: '',
      stderr: 'worker diagnostic',
    }));
    await running;
    expect(api.doneBodies).toEqual([
      {
        stepId: 's1',
        body: { status: 'failed', errorMessage: 'Orb worker disconnected without done' },
      },
    ]);
  },
);

test('signal termination reports one disconnect failure without a fabricated exit code', async () => {
  const { api, running } = fixture(async (argv) =>
    argv[0] === 'orb-worker'
      ? runOrbCommand([process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'])
      : { code: 0, stdout: '', stderr: '' },
  );
  await running;
  expect(api.doneBodies).toEqual([
    {
      stepId: 's1',
      body: { status: 'failed', errorMessage: 'Orb worker disconnected without done' },
    },
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
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      signal = options?.signal;
      deadline = Date.now() + 1_000;
      signal?.addEventListener('abort', () => release.resolve(), { once: true });
      const socketPath = options?.socketPath;
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
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    signal = options?.signal;
    signal?.addEventListener('abort', () => release.resolve(), { once: true });
    relay = await RelayMachineApi.connect(options!.socketPath);
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

test('uploads without heartbeats keep the orb alive beyond the watchdog timeout', async () => {
  vi.useFakeTimers();
  const release = defer();
  const api = new FakeMachineApi();
  const uploads = vi.spyOn(api, 'uploadUrls');
  let relay: RelayMachineApi | undefined;
  let signal: AbortSignal | undefined;
  const { running, stop } = fixture(async (argv, options) => {
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    signal = options?.signal;
    signal?.addEventListener('abort', () => release.resolve(), { once: true });
    relay = await RelayMachineApi.connect(options!.socketPath);
    await release.promise;
    relay.close();
    return { code: 0, stdout: '', stderr: '' };
  }, api);
  try {
    await vi.waitFor(() => expect(relay).toBeDefined(), { interval: 1 });
    for (let count = 1; count <= 4; count++) {
      await vi.advanceTimersByTimeAsync(600);
      await relay!.api.uploadUrls('s1', []);
      await relay!.api.putUpload('http://server/up/1', {}, { stepId: 's1', messages: [] });
      expect(signal?.aborted).toBe(false);
      expect(stop).not.toHaveBeenCalled();
    }
    expect(uploads).toHaveBeenCalledTimes(4);
    expect(api.calls).not.toContain('heartbeat:s1');
    await relay!.api.done('s1', { status: 'success' });
  } finally {
    release.resolve();
    await running;
  }
  expect(api.doneBodies).toEqual([{ stepId: 's1', body: { status: 'success' } }]);
  expect(vi.getTimerCount()).toBe(0);
});

test('stop timeout stops the container and awaits provider shutdown', async () => {
  vi.useFakeTimers();
  const release = defer();
  const shutdown = defer();
  let signal: AbortSignal | undefined;
  let started = false;
  let settled = false;
  const { running, stop, stops, api } = fixture(
    async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      signal = options?.signal;
      signal?.addEventListener('abort', () => release.resolve(), { once: true });
      started = true;
      await release.promise;
      return { code: 137, stdout: '', stderr: '' };
    },
    new FakeMachineApi(),
    20_000,
  );
  stop.mockImplementation(async () => shutdown.promise);
  void running.then(() => {
    settled = true;
  });
  try {
    await vi.waitFor(() => expect(started).toBe(true), { interval: 1 });
    await stops.get('s1')!.deliver({ discard: false });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    expect(stop).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lastStepId: 's1' }));
    expect(settled).toBe(false);
  } finally {
    shutdown.resolve();
    release.resolve();
    await running;
  }
  expect(api.doneBodies).toHaveLength(1);
  expect(api.doneBodies[0]?.body.status).toBe('failed');
  expect(vi.getTimerCount()).toBe(0);
});

test('invalid worker done is rejected and the host reports failure', async () => {
  let rejection: unknown;
  const api = new FakeMachineApi();
  const done = vi.spyOn(api, 'done');
  const { running, journal } = fixture(async (argv, options) => {
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.socketPath);
    try {
      await relay.call('done', ['s1', { status: 'forged' }]);
    } catch (error) {
      rejection = error;
    } finally {
      relay.close();
    }
    return { code: 0, stdout: '', stderr: '' };
  }, api);
  await running;
  expect(rejection).toMatchObject({ message: expect.stringContaining('Invalid relay done body') });
  expect(done).toHaveBeenCalledTimes(1);
  expect(api.doneBodies).toEqual([
    {
      stepId: 's1',
      body: { status: 'failed', errorMessage: 'Orb worker disconnected without done' },
    },
  ]);
  expect(journal.pending()).toEqual([]);
});

test.each([400, 403, 409, 422, 499])(
  'host replay rejected with HTTP %i falls back to failed completion',
  async (status) => {
    const api = new FakeMachineApi();
    const done = vi.spyOn(api, 'done');
    done.mockRejectedValueOnce(new MachineApiError(503, 'retry completion'));
    done.mockRejectedValueOnce(new MachineApiError(status, 'completion rejected'));
    const { running, journal } = fixture(async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const relay = await RelayMachineApi.connect(options!.socketPath);
      await expect(relay.api.done('s1', { status: 'success' })).rejects.toThrow('retry completion');
      relay.close();
      return { code: 137, stdout: '', stderr: '' };
    }, api);
    await running;
    expect(done).toHaveBeenCalledTimes(3);
    expect(api.doneBodies).toEqual([
      {
        stepId: 's1',
        body: {
          status: 'failed',
          errorMessage: `Orb completion rejected with HTTP ${status}: completion rejected`,
        },
      },
    ]);
    expect(journal.pending()).toEqual([]);
  },
);

test.each([new MachineApiError(503, 'server unavailable'), new Error('network unavailable')])(
  'host replay preserves the original completion on transient error %s',
  async (error) => {
    const api = new FakeMachineApi();
    const done = vi.spyOn(api, 'done').mockRejectedValue(error);
    const { running, journal } = fixture(async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const relay = await RelayMachineApi.connect(options!.socketPath);
      await expect(relay.api.done('s1', { status: 'success' })).rejects.toThrow(error.message);
      relay.close();
      return { code: 137, stdout: '', stderr: '' };
    }, api);
    await running;
    expect(done).toHaveBeenCalledTimes(2);
    expect(api.doneBodies).toEqual([]);
    expect(journal.get('s1')?.doneBody).toEqual({ status: 'success' });
  },
);

test('a rejected replay preserves the failed fallback when reporting is unreachable', async () => {
  const api = new FakeMachineApi();
  const done = vi.spyOn(api, 'done');
  done.mockRejectedValueOnce(new MachineApiError(503, 'retry completion'));
  done.mockRejectedValueOnce(new MachineApiError(422, 'completion rejected'));
  done.mockRejectedValueOnce(new MachineApiError(503, 'server unavailable'));
  const { running, journal } = fixture(async (argv, options) => {
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.socketPath);
    await expect(relay.api.done('s1', { status: 'success' })).rejects.toThrow('retry completion');
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  }, api);
  await running;
  expect(done).toHaveBeenCalledTimes(3);
  expect(api.doneBodies).toEqual([]);
  expect(journal.get('s1')?.doneBody).toEqual({
    status: 'failed',
    errorMessage: 'Orb completion rejected with HTTP 422: completion rejected',
  });
});

test('orb recovery after daemon restart falls back when done replay is rejected', async () => {
  const api = new FakeMachineApi();
  api.recoverSteps = [{ ...CLAIMED.step, kind: 'plan' }];
  const done = vi.spyOn(api, 'done');
  done.mockRejectedValueOnce(new MachineApiError(422, 'completion rejected'));
  const { handle, paths } = await boot({
    api,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
    orbProvider: new FakeOrbProvider({
      runner: async () => ({ code: 0, stdout: '', stderr: '' }),
    }),
    seedJournal(paths) {
      const journal = new StepJournal(paths.outboxDir);
      journal.claim({
        stepId: 's1',
        buildId: CLAIMED.step.buildId,
        kind: CLAIMED.step.kind,
        conversationId: CLAIMED.conversationId,
        sessionAction: 'new',
        prompt: null,
        claimed: CLAIMED,
      });
      journal.update('s1', { state: 'awaiting-upload', doneBody: { status: 'success' } });
    },
  });
  try {
    expect(done).toHaveBeenCalledTimes(2);
    expect(api.doneBodies).toEqual([
      {
        stepId: 's1',
        body: {
          status: 'failed',
          errorMessage: 'Orb completion rejected with HTTP 422: completion rejected',
        },
      },
    ]);
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('normal orb done suppresses the host fallback and clears the watchdog', async () => {
  vi.useFakeTimers();
  const release = defer();
  const completed = defer();
  const { api, running, stop } = fixture(async (argv, options) => {
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.socketPath);
    await relay.api.done('s1', { status: 'success' });
    completed.resolve();
    await release.promise;
    relay.close();
    return { code: 137, stdout: '', stderr: '' };
  });
  try {
    await completed.promise;
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(settled).toBe(true), { interval: 1 });
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
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    const relay = await RelayMachineApi.connect(options!.socketPath);
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
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    relay = await RelayMachineApi.connect(options!.socketPath);
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
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const relay = await RelayMachineApi.connect(options!.socketPath);
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
          errorMessage:
            cause === 'timeout' ? 'orb heartbeat timeout' : 'Orb worker disconnected without done',
        },
      },
    ]);
  },
);
