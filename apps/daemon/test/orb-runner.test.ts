import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBackend } from '@cairn/shared';
import { expect, test, vi } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import type { MachineApi } from '../src/machine-client.js';
import { ORB_STEP_METHODS } from '../src/orb/protocol.js';
import { NspawnOrbProvider } from '../src/orb/provider.js';
import { RelayMachineServer } from '../src/orb/relay.js';
import { runOrbWorker } from '../src/orb/worker.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';

vi.mock('../src/backend/pi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/backend/pi.js')>();
  return { ...original, createPiBackend: vi.fn(original.createPiBackend) };
});

function socketWorker(backend: AgentBackend) {
  const scratch = mkdtempSync(join(tmpdir(), 'orb-runtime-'));
  return new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (!argv.includes('--uid=agent')) return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.binds?.find(
        (bind) => bind.target === '/run/cairn/relay.sock',
      )?.source;
      if (!socketPath) throw new Error('Missing relay socket mount');
      await runOrbWorker({
        socketPath,
        backendFor: () => backend,
        home: join(scratch, 'state'),
        workspacesRoot: join(scratch, 'work'),
      });
      return { code: 0, stdout: '', stderr: '' };
    },
  });
}

test('orb workers use a socket and never construct or run a host backend', async () => {
  vi.mocked(createPiBackend).mockClear();
  const host = fakeBackend([]);
  const hostCreate = vi.spyOn(host.backend, 'createSession');
  const hostContinue = vi.spyOn(host.backend, 'continueSession');
  const worker = fakeBackend([{ type: 'done', usage: [] }]);
  const provider = socketWorker(worker.backend);
  const exec = vi.spyOn(provider, 'exec');
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle, paths } = await boot({
    api,
    backend: host.backend,
    useDefaultBackend: true,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(hostCreate).not.toHaveBeenCalled();
    expect(hostContinue).not.toHaveBeenCalled();
    expect(createPiBackend).not.toHaveBeenCalled();
    expect(worker.created).toHaveLength(1);
    expect(api.doneBodies).toHaveLength(1);
    expect(exec.mock.calls[0]?.[1]).toEqual([
      'node',
      '/opt/cairn/daemon/cli.mjs',
      'orb-step',
      '--socket',
      '/run/cairn/relay.sock',
    ]);
    await waitFor(() => !existsSync(join(paths.home, 'orb', 's1.sock')));
    expect(existsSync(join(paths.home, 'orb', 's1.sock'))).toBe(false);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('exec exposes only the socket, read-only build and read-only project seed', async () => {
  const sentinel = 'deadbeef'.repeat(8);
  class Api extends FakeMachineApi {
    override async enroll(body: Parameters<FakeMachineApi['enroll']>[0]) {
      return { ...(await super.enroll(body)), token: sentinel };
    }
  }
  const api = new Api();
  api.claimQueue.push(CLAIMED);
  const provider = socketWorker(fakeBackend([{ type: 'done', usage: [] }]).backend);
  const exec = vi.spyOn(provider, 'exec');
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_PROXY_URL: 'http://egress.test:3128' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    const call = exec.mock.calls[0]!;
    const options = call[2];
    expect(JSON.stringify(call)).not.toContain(sentinel);
    expect(JSON.stringify([call[1], options.env])).not.toContain(paths.home);
    expect(options.env).toMatchObject({
      HTTP_PROXY: 'http://egress.test:3128',
      HTTPS_PROXY: 'http://egress.test:3128',
    });
    expect(options.binds).toEqual([
      {
        source: join(paths.home, 'orb', 's1.sock'),
        target: '/run/cairn/relay.sock',
        releaseAfterExec: true,
      },
      {
        source: expect.stringMatching(/\/daemon\/dist$/),
        target: '/opt/cairn/daemon',
        readonly: true,
      },
    ]);
    expect(readFileSync(paths.machineJson, 'utf8')).toContain(sentinel);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('Coordinator steps stay on the host when orb mode is enabled', async () => {
  const host = fakeBackend([{ type: 'done', usage: [] }]);
  const provider = socketWorker(fakeBackend([]).backend);
  const exec = vi.spyOn(provider, 'exec');
  const ensure = vi.spyOn(provider, 'ensure');
  const api = new FakeMachineApi();
  api.claimQueue.push({ ...CLAIMED, step: { ...CLAIMED.step, kind: 'chief' } });
  const { handle } = await boot({
    api,
    backend: host.backend,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(host.created).toHaveLength(1);
    expect(exec).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('a dead container leaves completion and uploads to the worker', async () => {
  const provider = new NspawnOrbProvider({
    runner: async (argv) => ({
      code: argv.includes('--uid=agent') ? 137 : 0,
      stdout: '',
      stderr: '',
    }),
  });
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle, paths, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => lines.some((line) => line.includes('Orb step exited')));
    expect(api.doneBodies).toEqual([]);
    expect(api.uploads).toEqual([]);
    expect(readdirSync(join(paths.home, 'orb'))).toEqual([]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('a scripted relay completes one fake-backend step and keeps credentials out of runtime files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-scripted-'));
  const socketPath = join(root, 'step.sock');
  const api = new FakeMachineApi();
  const credential = 'credential-sentinel';
  const token = await api.token('s1');
  const upstream: MachineApi = api;
  upstream.token = vi.fn(async () => ({
    ...token,
    provider: { ...token.provider, apiKey: credential },
    secrets: { SECRET: credential },
    git: { username: 'git', password: credential },
    claudeSubscriptionToken: credential,
  }));
  const done = vi.spyOn(api, 'done');
  const worker = fakeBackend([{ type: 'done', usage: [] }]);
  const server = new RelayMachineServer({
    socketPath,
    stepId: 's1',
    upstream: api,
    input: {
      claimed: CLAIMED,
      options: {},
      methods: ORB_STEP_METHODS.filter((method) => method in api),
    },
  });
  await server.listen();
  try {
    await runOrbWorker({
      socketPath,
      backendFor: () => worker.backend,
      home: join(root, 'state'),
      workspacesRoot: join(root, 'work'),
    });
    expect(api.token).toHaveBeenCalledExactlyOnceWith('s1');
    expect(done).toHaveBeenCalledTimes(1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (file.isFile())
        expect(readFileSync(join(file.parentPath, file.name), 'utf8')).not.toContain(credential);
    }
  } finally {
    await server.close();
  }
});

test('a lost host relay interrupts the container session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-disconnect-'));
  const socketPath = join(root, 'step.sock');
  const api = new FakeMachineApi();
  const release = defer();
  const stop = vi.fn(async () => release.resolve());
  let started = false;
  const backend: AgentBackend = {
    ...fakeBackend([]).backend,
    async createSession(opts) {
      const session = await fakeBackend([]).backend.createSession(opts);
      started = true;
      return {
        ...session,
        stop,
        events: (async function* () {
          await release.promise;
          yield { type: 'done' as const, usage: [] };
        })(),
      };
    },
  };
  const server = new RelayMachineServer({
    socketPath,
    stepId: 's1',
    upstream: api,
    input: { claimed: CLAIMED, options: {}, methods: [...ORB_STEP_METHODS] },
  });
  await server.listen();
  const running = runOrbWorker({
    socketPath,
    backendFor: () => backend,
    home: join(root, 'state'),
    workspacesRoot: join(root, 'work'),
  });
  try {
    await waitFor(() => started);
    await server.close();
    await waitFor(() => stop.mock.calls.length === 1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(api.doneBodies).toEqual([]);
  } finally {
    release.resolve();
    await running;
    await server.close();
  }
});
