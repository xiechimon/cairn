import { PassThrough } from 'node:stream';
import type { AgentBackend, SessionOpts } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { runOrbWorker } from '../src/orb/worker.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';

function workerRunner(backend: AgentBackend): OrbCommandRunner {
  return async (argv, options) => {
    if (argv[0] !== 'systemd-run') return { code: 0, stdout: '', stderr: '' };
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
      await waitFor(() => api.claimCalls >= 3 && started === 2);
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
