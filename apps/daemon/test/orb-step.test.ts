import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBackend, MachineDoneBody, SessionOpts } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
import { RelayMachineApi } from '../src/orb/relay.js';
import { runOrbWorker } from '../src/orb/worker.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';
import { FakeOrbProvider, type FakeOrbRunner, type FakeWorkerOptions } from './orb-fake.js';
import { orbTestEntry, orbTestRelease } from './orb-release-fixture.js';

function workerRunner(
  backend: AgentBackend,
  observe?: (options: FakeWorkerOptions, runtimeHome: string) => void,
): FakeOrbRunner {
  const root = mkdtempSync(join(tmpdir(), 'orb-worker-'));
  return async (argv, options) => {
    if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
    const runtimeHome = join(root, argv[2] ?? 'agent');
    if (options) observe?.(options, runtimeHome);
    const socketPath = options?.socketPath;
    if (!socketPath) throw new Error('Missing relay socket');
    await runOrbWorker({
      socketPath,
      entryPath: orbTestEntry(socketPath),
      backendFor: () => backend,
      home: runtimeHome,
      workspacesRoot: join(runtimeHome, 'work'),
    });
    return { code: 0, stdout: '', stderr: '' };
  };
}

describe('orb step dispatch', () => {
  test('default host step omits the orb marker', async () => {
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    const { handle } = await boot({ api, backend, capEnv: {} });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect((created[0]?.opts as SessionOpts | undefined)?.env?.CAIRN_ORB).toBeUndefined();
    } finally {
      await handle.stop();
      await handle.done;
    }
  });

  test('orb worker sends ordered lifecycle notes through the hook transcript and marks agent env', async () => {
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const provider = new FakeOrbProvider({ runner: workerRunner(backend) });
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    const { handle } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect((created[0]?.opts as SessionOpts | undefined)?.env?.CAIRN_ORB).toBe('1');
      const text = JSON.stringify(api.uploads[0]?.body.messages);
      expect(text).toContain('orb: creating');
      expect(text).toContain('orb: setup');
      expect(text).toContain('orb: started in');
      expect(text.indexOf('orb: creating')).toBeLessThan(text.indexOf('orb: started in'));
      expect(api.doneBodies[0]?.body.status).toBe('success');
    } finally {
      await handle.stop();
      await handle.done;
    }
  });

  test('three claimed steps start only two orbs, then hand off the slot without a failed row', async () => {
    const release = defer();
    let started = 0;
    const backend: AgentBackend = {
      ...fakeBackend([]).backend,
      async createSession(opts) {
        started += 1;
        const handle = await fakeBackend([]).backend.createSession(opts);
        return {
          ...handle,
          events: (async function* () {
            await release.promise;
            yield { type: 'done' as const, usage: [] };
          })(),
        };
      },
    };
    const provider = new FakeOrbProvider({ runner: workerRunner(backend) });
    const ensure = vi.spyOn(provider, 'ensure');
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 4 };
    for (const id of ['s1', 's2', 's3'])
      api.claimQueue.push({
        ...CLAIMED,
        step: { ...CLAIMED.step, id, buildId: id },
        conversationId: id,
      });
    const { handle } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_MAX: '2' },
    });
    try {
      await waitFor(() => started === 2);
      expect(api.claimCalls).toBe(2);
      expect(ensure).toHaveBeenCalledTimes(2);
      release.resolve();
      await waitFor(() => api.doneBodies.length === 3);
      expect(ensure).toHaveBeenCalledTimes(3);
      expect(api.doneBodies.every((row) => row.body.status === 'success')).toBe(true);
    } finally {
      release.resolve();
      await handle.stop();
      await handle.done;
    }
  });
});

test('stop received during orb preparation reaches the worker before opening an agent session', async () => {
  const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
  const bind = defer();
  const runner = workerRunner(backend);
  let binding = false;
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[1] === 'start') {
        binding = true;
        await bind.promise;
      }
      return runner(argv, options);
    },
  });
  const poweroff = vi.spyOn(provider, 'stop');
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  api.stopResponse = true;
  const { handle } = await boot({ api, orbProvider: provider, capEnv: { CAIRN_EXECUTOR: 'orb' } });
  try {
    await waitFor(() => binding);
    api.onStreamEvent?.({ type: 'stop', stepId: CLAIMED.step.id });
    await waitFor(() => api.calls.includes('stop:s1'));
    bind.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    await waitFor(() => poweroff.mock.calls.length === 1);
    expect(poweroff).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
    expect(api.doneBodies[0]?.body.status).toBe('stopped');
  } finally {
    bind.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('idle stop notes reach the completed step transcript', async () => {
  const rows: string[] = [];
  class Api extends FakeMachineApi {
    async transcriptRow(_stepId: string, row: { content: unknown }) {
      rows.push(JSON.stringify(row.content));
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: workerRunner(fakeBackend([{ type: 'done', usage: [] }]).backend),
  });
  const { handle } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_IDLE_STOP_MS: '10' },
  });
  try {
    await waitFor(() => rows.some((row) => row.includes('orb: stopped')));
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(rows.some((row) => row.includes('.agents/setup hook ok'))).toBe(true);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test.each(['clone', 'start', 'worker', 'worker-exit', 'eviction'] as const)(
  '%s failure receives a host failure report',
  async (source) => {
    const runner = workerRunner(fakeBackend([{ type: 'done', usage: [] }]).backend);
    const provider = new FakeOrbProvider({
      runner: async (argv, options) => {
        if (argv[0] === 'orb-worker' && source === 'worker-exit')
          return { code: 137, stdout: '', stderr: `${source} unavailable` };
        if (
          argv[1] === source ||
          (source === 'worker' && argv[0] === 'orb-worker') ||
          (source === 'eviction' && argv[1] === 'poweroff')
        )
          throw new Error(`${source} unavailable`);
        return runner(argv, options);
      },
    });
    if (source === 'eviction')
      await provider.start(await provider.ensure({ conversationId: 'old', projectId: 'P' }));
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    const { handle, paths, lines } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_MAX: '1' },
    });
    try {
      await waitFor(() => lines.some((line) => line.includes('Orb step exited')));
      await waitFor(() => api.doneBodies.length === 1);
      expect(api.doneBodies[0]?.body).toMatchObject({
        status: 'failed',
        errorMessage: source.startsWith('worker')
          ? 'Orb worker disconnected without done'
          : expect.stringContaining(source),
      });
      expect(new StepJournal(paths.outboxDir).get('s1')).toBeNull();
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);

test.each(['clone', 'start', 'session'] as const)(
  'a steer during %s preparation is delivered before it is acknowledged',
  async (phase) => {
    const opening = defer();
    const finish = defer();
    const steered: string[] = [];
    let creating = false;
    const backend: AgentBackend = {
      ...fakeBackend([]).backend,
      async createSession(opts) {
        if (phase === 'session') {
          creating = true;
          await opening.promise;
        }
        return {
          ...(await fakeBackend([]).backend.createSession(opts)),
          async steer(text) {
            steered.push(text);
          },
          events: (async function* () {
            await finish.promise;
            yield { type: 'done' as const, usage: [] };
          })(),
        };
      },
    };
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    api.steerResponse = 'keep this steer';
    const { handle } = await boot({
      api,
      orbProvider: new FakeOrbProvider({
        runner: async (argv, options) => {
          if (argv[1] === phase) {
            creating = true;
            await opening.promise;
          }
          return workerRunner(backend)(argv, options);
        },
      }),
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => creating);
      api.onStreamEvent?.({ type: 'steer', stepId: 's1' });
      await waitFor(() => api.calls.includes('steer:s1'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(api.calls).not.toContain('steer-ack:s1');
      opening.resolve();
      await waitFor(() => api.calls.includes('steer-ack:s1'));
      expect(steered).toEqual(['keep this steer']);
    } finally {
      opening.resolve();
      finish.resolve();
      await handle.stop();
      await handle.done;
    }
  },
);

test('Coordinator and worker claims share the executor cap even when the server gates workers', async () => {
  const release = defer();
  let started = 0;
  const backend: AgentBackend = {
    ...fakeBackend([]).backend,
    async createSession(opts) {
      started += 1;
      return {
        ...(await fakeBackend([]).backend.createSession(opts)),
        events: (async function* () {
          await release.promise;
          yield { type: 'done' as const, usage: [] };
        })(),
      };
    },
  };
  const api = new FakeMachineApi();
  api.mePatch = { maxConcurrent: 4 };
  for (const [index, kind] of (['chief', 'plan', 'plan'] as const).entries())
    api.claimQueue.push({
      ...CLAIMED,
      conversationId: `c${index}`,
      step: { ...CLAIMED.step, id: `s${index}`, kind },
    });
  const { handle } = await boot({
    api,
    backend,
    orbProvider: new FakeOrbProvider({ runner: workerRunner(backend) }),
    capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_MAX: '2' },
  });
  try {
    await waitFor(() => started === 2);
    expect(api.claimCalls).toBe(2);
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('orb fixed roots exclude host runtime credentials and workspace directories', async () => {
  const executions: FakeWorkerOptions[] = [];
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: workerRunner(fakeBackend([{ type: 'done', usage: [] }]).backend, (options) =>
      executions.push(options),
    ),
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    const sources = [executions[0]?.socketPath, executions[0]?.distRoot, executions[0]?.seedRoot];
    for (const root of [
      paths.chatSessionsDir,
      paths.agentRuntimeDir,
      paths.workspacesDir,
      paths.plansDir,
      paths.reportsDir,
      paths.stepAttachmentsDir,
      paths.teamSkillsCacheDir,
    ])
      expect(sources).not.toContain(root);
    expect(sources).not.toContain(paths.outboxDir);
    expect(sources).toEqual([
      join(provider.runtimeRoot, 'cairn-orb-conv-1', 'relay.sock'),
      provider.distRoot,
      provider.seedRoot,
    ]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('an unreachable host failure report remains journaled for replay', async () => {
  class Api extends FakeMachineApi {
    override async done() {
      throw new Error('report unreachable');
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: async () => {
      throw new Error('clone unavailable');
    },
  });
  const { handle, paths, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => lines.some((line) => line.includes('Orb step exited')));
    expect(new StepJournal(paths.outboxDir).pending()[0]).toMatchObject({
      state: 'awaiting-upload',
      doneBody: { status: 'failed', errorMessage: expect.stringContaining('clone unavailable') },
    });
    expect(api.uploads).toHaveLength(0);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('worker exit waits for an in-flight finish report without replacing or duplicating it', async () => {
  const release = defer();
  let reporting = false;
  class Api extends FakeMachineApi {
    override async done(stepId: string, body: MachineDoneBody) {
      reporting = true;
      await release.promise;
      await super.done(stepId, body);
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] === 'orb-worker') {
        const socketPath = options?.socketPath;
        if (!socketPath) throw new Error('Missing relay socket');
        const relay = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
        void relay.api.done('s1', { status: 'success' }).catch(() => {});
        await waitFor(() => reporting);
        relay.close();
        return { code: 1, stdout: '', stderr: 'worker crashed after finish' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => reporting);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(new StepJournal(paths.outboxDir).get('s1')?.doneBody?.status).toBe('success');
    release.resolve();
    await waitFor(() => api.doneBodies.length > 0);
    await handle.stop();
    await handle.done;
    expect(api.doneBodies.map((row) => row.body.status)).toEqual(['success']);
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('an orb cannot complete another step or mount its host recovery journal', async () => {
  const executions: FakeWorkerOptions[] = [];
  const api = new FakeMachineApi();
  api.mePatch = { maxConcurrent: 2 };
  for (const id of ['s1', 's2'])
    api.claimQueue.push({
      ...CLAIMED,
      conversationId: id,
      step: { ...CLAIMED.step, id, buildId: id },
    });
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker' || !options) return { code: 0, stdout: '', stderr: '' };
      executions.push(options);
      const socketPath = options.socketPath;
      if (!socketPath) throw new Error('Missing relay socket');
      const relay = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
      try {
        await expect(relay.api.done('victim', { status: 'success' })).rejects.toThrow(
          'Relay step does not match claim',
        );
      } finally {
        relay.close();
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => executions.length === 2);
    for (const execution of executions) {
      expect(execution.socketPath).toMatch(/run\/cairn-orb-s[12]\/relay.sock$/);
      expect(JSON.stringify(execution)).not.toContain(paths.outboxDir);
    }
    expect(new StepJournal(paths.outboxDir).get('victim')).toBeNull();
    await waitFor(() => api.doneBodies.length === 2);
    expect(api.doneBodies.every((row) => row.body.status === 'failed')).toBe(true);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('worker checkpoints preserve only the bound step recovery state in the private host journal', async () => {
  const release = defer();
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  let workerOutbox = '';
  const backend: AgentBackend = {
    ...fakeBackend([]).backend,
    async createSession(opts) {
      return {
        ...(await fakeBackend([]).backend.createSession(opts)),
        events: (async function* () {
          await release.promise;
          yield { type: 'done' as const, usage: [] };
        })(),
      };
    },
  };
  const provider = new FakeOrbProvider({
    runner: workerRunner(backend, (_options, runtimeHome) => {
      workerOutbox = join(runtimeHome, 'outbox');
    }),
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    const journal = new StepJournal(paths.outboxDir);
    await waitFor(() => journal.get('s1')?.sessionId === 'pi-sess-1');
    mkdirSync(workerOutbox, { recursive: true });
    writeFileSync(
      join(workerOutbox, 'step-s1.json'),
      JSON.stringify({
        stepId: 'victim',
        claimed: CLAIMED,
        state: 'awaiting-upload',
        doneBody: { status: 'success' },
        stopRequest: { discard: true },
      }),
    );
    expect(journal.get('s1')).toMatchObject({ stepId: 's1', sessionId: 'pi-sess-1' });
    expect(journal.get('s1')?.stopRequest).toBeUndefined();
    expect(journal.get('victim')).toBeNull();
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('orb recovery uploads its step artifacts and ignores forged worker journals for other steps', async () => {
  const api = new FakeMachineApi();
  api.recoverSteps = [
    { ...CLAIMED.step, kind: 'plan', machineId: 'm1' },
    { ...CLAIMED.step, kind: 'plan', id: 'victim', machineId: 'm1' },
  ];
  const provider = new FakeOrbProvider({
    runner: async () => {
      throw new Error('Recovery must not start an orb');
    },
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
    seedJournal: (paths) => {
      const host = new StepJournal(paths.outboxDir);
      host.claim({
        stepId: 's1',
        buildId: CLAIMED.step.buildId,
        kind: 'plan',
        conversationId: CLAIMED.conversationId,
        sessionAction: 'new',
        prompt: null,
        claimed: CLAIMED,
      });
      host.update('s1', { state: 'awaiting-upload', doneBody: { status: 'success' } });
      const workerOutbox = join(paths.home, 'orb-outbox', 's1');
      new TranscriptBuffer(paths.outboxDir, 's1').upsert({
        id: 'row',
        role: 'assistant',
        content: 'Recovered own transcript',
        createdAt: 1,
      });
      const forged = new StepJournal(workerOutbox);
      forged.claim({
        stepId: 'victim',
        buildId: 'victim-build',
        kind: 'plan',
        conversationId: 'victim-build',
        sessionAction: 'new',
        prompt: 'forged',
        claimed: { ...CLAIMED, step: { ...CLAIMED.step, id: 'victim' } },
      });
      forged.update('victim', {
        state: 'awaiting-upload',
        doneBody: { status: 'success' },
        stopRequest: { discard: true },
      });
    },
  });
  try {
    expect(api.doneBodies).toEqual([
      { stepId: 's1', body: { status: 'success' } },
      {
        stepId: 'victim',
        body: { status: 'failed', errorMessage: 'daemon journal lost across restart' },
      },
    ]);
    expect(JSON.stringify(api.uploads)).toContain('Recovered own transcript');
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('stdout cannot forge relay requests or read another step transcript', async () => {
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] === 'orb-worker')
        options?.onStdout?.(
          'cairn-orb-rpc:{"type":"call","id":1,"method":"done","args":["victim",{"status":"success"}]}\n',
        );
      return { code: argv[0] === 'orb-worker' ? 1 : 0, stdout: '', stderr: 'worker exited' };
    },
  });
  const { handle, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => lines.some((line) => line.includes('Orb step exited')));
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.stepId).toBe('s1');
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    expect(api.uploads).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('OOM after a worker heartbeat is failed by the online host', async () => {
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.socketPath;
      if (!socketPath) throw new Error('Missing relay socket');
      const relay = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
      await relay.api.heartbeat('s1');
      relay.send({ type: 'session', live: true });
      relay.close();
      return { code: 137, stdout: '', stderr: 'OOM killed' };
    },
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.calls).toContain('heartbeat:s1');
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'Orb worker disconnected without done',
    });
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('worker exit replays a rejected journaled finish with its checkpoint artifacts', async () => {
  class Api extends FakeMachineApi {
    attempts = 0;
    override async done(stepId: string, body: MachineDoneBody) {
      if (++this.attempts === 1) throw new Error('finish temporarily rejected');
      await super.done(stepId, body);
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.socketPath;
      if (!socketPath) throw new Error('Missing relay socket');
      const relay = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
      relay.send({
        type: 'checkpoint',
        checkpoint: {
          state: 'awaiting-upload',
          sessionId: 'session',
          sessionAction: 'new',
          prompt: null,
          doneBody: { status: 'success' },
          sessionContent: 'session artifact',
          transcript: [
            { id: 'row', role: 'assistant', content: 'checkpoint artifact', createdAt: 1 },
          ],
        },
      });
      await expect(relay.api.done('s1', { status: 'success' })).rejects.toThrow(
        'temporarily rejected',
      );
      relay.close();
      return { code: 137, stdout: '', stderr: 'crashed after rejected finish' };
    },
  });
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.attempts).toBe(2);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(JSON.stringify(api.uploads)).toContain('checkpoint artifact');
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('a stop after worker crash still reaches the run while host completion is pending', async () => {
  const finish = defer();
  let reporting = false;
  class Api extends FakeMachineApi {
    override async done(stepId: string, body: MachineDoneBody) {
      reporting = true;
      await finish.promise;
      await super.done(stepId, body);
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  api.stopResponse = true;
  const { handle, lines, paths } = await boot({
    api,
    orbProvider: new FakeOrbProvider({
      runner: async (argv) => ({
        code: argv[0] === 'orb-worker' ? 137 : 0,
        stdout: '',
        stderr: 'crash',
      }),
    }),
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => reporting);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.calls.includes('stop:s1'));
    await waitFor(() => new StepJournal(paths.outboxDir).get('s1')?.stopRequest != null);
    expect(lines.some((line) => line.includes('stop dropped'))).toBe(false);
    finish.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
  } finally {
    finish.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('a worker ignoring stop is aborted after the grace period', async () => {
  let signal: AbortSignal | undefined;
  let started = false;
  let receivedStop = false;
  const release = defer();
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  api.stopResponse = true;
  const provider = new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.socketPath;
      if (!socketPath) throw new Error('Missing relay socket');
      const relay = await RelayMachineApi.connect(
        socketPath,
        orbTestRelease(socketPath),
        (frame) => {
          if (frame.type === 'stop') receivedStop = true;
        },
      );
      await relay.api.heartbeat('s1');
      relay.send({ type: 'session', live: true });
      signal = options?.signal;
      signal?.addEventListener('abort', () => release.resolve(), { once: true });
      started = true;
      await release.promise;
      relay.close();
      return { code: 137, stdout: '', stderr: 'aborted unresponsive worker' };
    },
  });
  const { handle } = await boot({ api, orbProvider: provider, capEnv: { CAIRN_EXECUTOR: 'orb' } });
  try {
    await waitFor(() => started);
    expect(signal).toBeDefined();
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => receivedStop);
    expect(signal?.aborted).toBe(false);
    await waitFor(() => signal?.aborted === true, 8000);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
}, 15000);

test.each(['transcript', 'sessionContent'] as const)(
  'rejects oversized checkpoint %s before writing host files',
  async (field) => {
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    let rejected = false;
    const provider = new FakeOrbProvider({
      runner: async (argv, options) => {
        if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
        const socketPath = options?.socketPath;
        if (!socketPath) throw new Error('Missing relay socket');
        const relay = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
        const content = 'é'.repeat(3 * 1024 * 1024);
        relay.send({
          type: 'checkpoint',
          checkpoint: {
            state: 'running',
            sessionId: 'oversized',
            sessionAction: 'new',
            prompt: null,
            ...(field === 'transcript'
              ? { transcript: [{ id: 'row', role: 'assistant' as const, content, createdAt: 1 }] }
              : { sessionContent: content }),
          },
        });
        try {
          await relay.api.heartbeat('s1');
        } catch {
          rejected = true;
        }
        relay.close();
        return { code: 1, stdout: '', stderr: 'worker rejected' };
      },
    });
    const { handle, paths } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => rejected);
      expect(rejected).toBe(true);
      expect(new StepJournal(paths.outboxDir).get('s1')?.sessionId).not.toBe('oversized');
      expect(
        existsSync(
          join(
            paths.outboxDir,
            `step-s1.${field === 'transcript' ? 'transcript.json' : 'session.jsonl'}`,
          ),
        ),
      ).toBe(false);
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);
