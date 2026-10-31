import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { AgentBackend, MachineDoneBody, SessionOpts } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { StepJournal, TranscriptBuffer } from '../src/journal.js';
import { decodeOrbFrame, encodeOrbFrame } from '../src/orb/protocol.js';
import {
  NspawnOrbProvider,
  type OrbCommandRunner,
  type OrbExecOptions,
} from '../src/orb/provider.js';
import { runOrbWorker } from '../src/orb/worker.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';

function workerRunner(
  backend: AgentBackend,
  observe?: (options: OrbExecOptions) => void,
): OrbCommandRunner {
  return async (argv, options) => {
    if (argv[0] !== 'systemd-run' || !argv.includes('--uid=agent'))
      return { code: 0, stdout: '', stderr: '' };
    if (options) observe?.(options);
    const input = new PassThrough();
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => options?.onStdout?.(chunk.toString()));
    options?.onInput?.((data) => input.write(data));
    const worker = runOrbWorker({ input, output, backendFor: () => backend });
    input.write(options?.input ?? '');
    await worker;
    input.end();
    output.end();
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
    const provider = new NspawnOrbProvider({ runner: workerRunner(backend) });
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
    const provider = new NspawnOrbProvider({ runner: workerRunner(backend) });
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
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (argv[1] === 'bind') {
        binding = true;
        await bind.promise;
      }
      return runner(argv, options);
    },
  });
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
  const provider = new NspawnOrbProvider({
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

test.each(['clone', 'start', 'worker', 'worker-exit', 'worker-frame', 'eviction'] as const)(
  '%s failure reports a failed step with an error transcript and clears its host journal',
  async (source) => {
    const runner = workerRunner(fakeBackend([{ type: 'done', usage: [] }]).backend);
    const provider = new NspawnOrbProvider({
      runner: async (argv, options) => {
        if (argv.includes('--uid=agent') && source === 'worker-exit')
          return { code: 137, stdout: '', stderr: `${source} unavailable` };
        if (argv.includes('--uid=agent') && source === 'worker-frame') {
          options?.onStdout?.(encodeOrbFrame({ type: 'failed', error: `${source} unavailable` }));
          return { code: 0, stdout: '', stderr: '' };
        }
        if (
          argv[1] === source ||
          (source === 'worker' && argv.includes('--uid=agent')) ||
          (source === 'eviction' && argv[1] === 'poweroff')
        )
          throw new Error(`${source} unavailable`);
        return runner(argv, options);
      },
    });
    if (source === 'eviction') await provider.ensure({ conversationId: 'old', projectId: 'P' });
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    const { handle, paths } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_MAX: '1' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect(api.doneBodies[0]?.body).toMatchObject({
        status: 'failed',
        errorMessage:
          source === 'worker-exit'
            ? `Orb step exited (137): ${source} unavailable`
            : `${source} unavailable`,
      });
      expect(JSON.stringify(api.uploads)).toContain(`${source} unavailable`);
      expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);

test.each(['clone', 'bind', 'session'] as const)(
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
      orbProvider: new NspawnOrbProvider({
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

test('chief and worker claims share the two-orb cap even when the server gates workers', async () => {
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
    orbProvider: new NspawnOrbProvider({ runner: workerRunner(backend) }),
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

test('orb mounts conversation workspaces and artifacts without sharing host runtime credentials', async () => {
  const executions: OrbExecOptions[] = [];
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const provider = new NspawnOrbProvider({
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
    const sources = executions[0]?.binds?.map((bind) => bind.source) ?? [];
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
    expect(sources).toContain(join(paths.home, 'orb-outbox', CLAIMED.step.id));
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('an unreachable failure report keeps the failed result in the host journal for recovery', async () => {
  class Api extends FakeMachineApi {
    override async done() {
      throw new Error('report unreachable');
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = new NspawnOrbProvider({
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
    await waitFor(() => lines.some((line) => line.includes('done report failed')));
    expect(new StepJournal(paths.outboxDir).pending()[0]).toMatchObject({
      state: 'awaiting-upload',
      doneBody: { status: 'failed', errorMessage: 'clone unavailable' },
    });
    expect(api.uploads).toHaveLength(1);
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
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] === 'systemd-run') {
        options?.onStdout?.(
          encodeOrbFrame({
            type: 'call',
            id: 1,
            method: 'done',
            args: ['s1', { status: 'success' }],
          }),
        );
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

test('an orb cannot mount another step outbox or forge its host recovery journal', async () => {
  const executions: OrbExecOptions[] = [];
  const api = new FakeMachineApi();
  api.mePatch = { maxConcurrent: 2 };
  for (const id of ['s1', 's2'])
    api.claimQueue.push({
      ...CLAIMED,
      conversationId: id,
      step: { ...CLAIMED.step, id, buildId: id },
    });
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'systemd-run' || !options) return { code: 0, stdout: '', stderr: '' };
      executions.push(options);
      const init = decodeOrbFrame(options.input?.trim() ?? '');
      if (init?.type !== 'init') throw new Error('Missing init frame');
      const outbox = init.input.paths.outboxDir;
      const forged = new StepJournal(outbox);
      forged.claim({
        stepId: 'victim',
        buildId: 'victim-build',
        kind: 'plan',
        conversationId: 'victim-build',
        sessionAction: 'new',
        prompt: 'forged',
      });
      forged.update('victim', {
        state: 'awaiting-upload',
        doneBody: { status: 'success' },
        stopRequest: { discard: true },
      });
      options.onStdout?.(encodeOrbFrame({ type: 'finished' }));
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
    const outboxes = ['s1', 's2'].map((id) => join(paths.home, 'orb-outbox', id));
    for (const [index, execution] of executions.entries()) {
      const sources = execution.binds?.map((bind) => bind.source) ?? [];
      expect(sources).toContain(outboxes[index]);
      expect(sources).not.toContain(outboxes[1 - index]);
      expect(sources).not.toContain(paths.outboxDir);
      expect(sources).not.toContain(dirname(outboxes[index]!));
    }
    const journal = new StepJournal(paths.outboxDir);
    expect(journal.get('victim')).toBeNull();
    expect(
      journal
        .pending()
        .map((entry) => entry.stepId)
        .sort(),
    ).toEqual(['s1', 's2']);
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
  const provider = new NspawnOrbProvider({
    runner: workerRunner(backend, (options) => {
      const init = decodeOrbFrame(options.input?.trim() ?? '');
      if (init?.type === 'init') workerOutbox = init.input.paths.outboxDir;
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
  const provider = new NspawnOrbProvider({
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

test('host failure recovery never follows a symlink planted in an orb outbox', async () => {
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
      const init = decodeOrbFrame(options?.input?.trim() ?? '');
      if (init?.type !== 'init') throw new Error('Missing init frame');
      symlinkSync(
        join(init.input.paths.home, 'outbox', 'step-victim.transcript.json'),
        join(init.input.paths.outboxDir, 'step-s1.transcript.json'),
      );
      return { code: 1, stdout: '', stderr: 'worker exited' };
    },
  });
  const { handle } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
    seedJournal: (paths) => {
      new TranscriptBuffer(paths.outboxDir, 'victim').upsert({
        id: 'private',
        role: 'assistant',
        content: 'Other conversation private transcript',
        createdAt: 1,
      });
    },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    expect(JSON.stringify(api.uploads)).not.toContain('Other conversation private transcript');
  } finally {
    await handle.stop();
    await handle.done;
  }
});
