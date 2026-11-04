import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentBackend } from '@cairn/shared';
import { expect, test, vi } from 'vitest';
import { createPiBackend } from '../src/backend/pi.js';
import type { MachineApi } from '../src/machine-client.js';
import { ORB_STEP_METHODS } from '../src/orb/protocol.js';
import { RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import { runOrbWorker } from '../src/orb/worker.js';
import {
  boot,
  CLAIMED,
  defer,
  FakeMachineApi,
  fakeBackend,
  waitFor,
} from './machine-loop-harness.js';
import { FakeOrbProvider } from './orb-fake.js';
import { orbTestEntry, orbTestRelease } from './orb-release-fixture.js';

vi.mock('../src/backend/pi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/backend/pi.js')>();
  return { ...original, createPiBackend: vi.fn(original.createPiBackend) };
});

function socketWorker(backend: AgentBackend) {
  const scratch = mkdtempSync(join(tmpdir(), 'orb-runtime-'));
  return new FakeOrbProvider({
    runner: async (argv, options) => {
      if (argv[0] !== 'orb-worker') return { code: 0, stdout: '', stderr: '' };
      const socketPath = options?.socketPath;
      if (!socketPath) throw new Error('Missing relay socket mount');
      await runOrbWorker({
        socketPath,
        entryPath: orbTestEntry(socketPath),
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
  const exec = vi.spyOn(provider, 'launchWorker');
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle } = await boot({
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
    const socketPath = exec.mock.calls[0]![1].socketPath;
    expect(socketPath).toBe(join(provider.runtimeRoot, 'cairn-orb-conv-1', 'relay.sock'));
    await waitFor(() => !existsSync(socketPath));
    expect(existsSync(socketPath)).toBe(false);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('fixed roots expose the socket, complete build and seed, and a per-step delivery outbox', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'orb-exec-seed-'));
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'Seed',
  ]);
  const sentinel = 'deadbeef'.repeat(8);
  class Api extends FakeMachineApi {
    override async enroll(body: Parameters<FakeMachineApi['enroll']>[0]) {
      return { ...(await super.enroll(body)), token: sentinel };
    }
  }
  const api = new Api();
  api.claimQueue.push({
    ...CLAIMED,
    project: { ...CLAIMED.project!, id: 'project', repo: { kind: 'local', cloneUrl: repo } },
  });
  const provider = socketWorker(fakeBackend([{ type: 'done', usage: [] }]).backend);
  const exec = vi.spyOn(provider, 'launchWorker');
  const { handle, paths } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb', CAIRN_ORB_PROXY_URL: 'http://egress.test:3128' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    const call = exec.mock.calls[0]!;
    const options = call[1];
    expect(JSON.stringify(call)).not.toContain(sentinel);
    expect(JSON.stringify(options)).not.toContain(paths.home);
    expect(options.socketPath).toBe(join(provider.runtimeRoot, 'cairn-orb-conv-1', 'relay.sock'));
    expect(options.outboxRoot).toBe(join(provider.runtimeRoot, 'cairn-orb-conv-1', 'outbox'));
    expect(readFileSync(join(options.distRoot, 'current', 'dist', 'cli.mjs'), 'utf8')).toBe(
      'first',
    );
    expect(existsSync(join(options.seedRoot, 'project', 'repo', 'HEAD'))).toBe(true);
    expect(readFileSync(paths.machineJson, 'utf8')).toContain(sentinel);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('Coordinator steps stay on the host when orb mode is enabled', async () => {
  const host = fakeBackend([{ type: 'done', usage: [] }]);
  const provider = socketWorker(fakeBackend([]).backend);
  const exec = vi.spyOn(provider, 'launchWorker');
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

test('a dead container receives a host failure report', async () => {
  const provider = new FakeOrbProvider({
    runner: async (argv) => ({
      code: argv[0] === 'orb-worker' ? 137 : 0,
      stdout: '',
      stderr: '',
    }),
  });
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle, lines } = await boot({
    api,
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(lines.some((line) => line.includes('Orb step exited'))).toBe(true);
    expect(api.doneBodies).toEqual([
      {
        stepId: 's1',
        body: { status: 'failed', errorMessage: 'Orb worker disconnected without done' },
      },
    ]);
    expect(api.uploads).toEqual([]);
    expect(readdirSync(join(provider.runtimeRoot, 'cairn-orb-conv-1'))).toEqual([]);
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
    release: orbTestRelease(socketPath),
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
      entryPath: orbTestEntry(socketPath),
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
    release: orbTestRelease(socketPath),
    stepId: 's1',
    upstream: api,
    input: { claimed: CLAIMED, options: {}, methods: [...ORB_STEP_METHODS] },
  });
  await server.listen();
  const running = runOrbWorker({
    socketPath,
    entryPath: orbTestEntry(socketPath),
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

test.each(['success', 'failed'] as const)(
  'orb worker heartbeats through finish-up until %s done settles',
  async (status) => {
    vi.useFakeTimers();
    const root = mkdtempSync(join(tmpdir(), 'orb-finish-heartbeat-'));
    const socketPath = join(root, 'step.sock');
    const api = new FakeMachineApi();
    const upload = defer();
    const finish = defer();
    const heartbeat = vi.spyOn(api, 'heartbeat');
    const putUpload = vi.spyOn(api, 'putUpload').mockImplementation(async () => upload.promise);
    const done = vi.spyOn(api, 'done').mockImplementation(async (stepId, body) => {
      await finish.promise;
      api.doneBodies.push({ stepId, body });
    });
    const server = new RelayMachineServer({
      socketPath,
      release: orbTestRelease(socketPath),
      stepId: 's1',
      upstream: api,
      input: {
        claimed: {
          ...CLAIMED,
          agent: { ...CLAIMED.agent!, modelId: status === 'success' ? 'stub-model' : null },
        },
        options: {},
        methods: [...ORB_STEP_METHODS],
      },
    });
    await server.listen();
    const running = runOrbWorker({
      socketPath,
      entryPath: orbTestEntry(socketPath),
      backendFor: () => fakeBackend([{ type: 'done', usage: [] }]).backend,
      home: join(root, 'state'),
      workspacesRoot: join(root, 'work'),
    });
    try {
      if (status === 'success') {
        await vi.waitFor(() => expect(putUpload).toHaveBeenCalledTimes(1), { interval: 1 });
        heartbeat.mockClear();
        await vi.advanceTimersByTimeAsync(150_000);
        await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(5), { interval: 1 });
        upload.resolve();
      }
      await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1), { interval: 1 });
      heartbeat.mockClear();
      await vi.advanceTimersByTimeAsync(150_000);
      await vi.waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(5), { interval: 1 });
      expect(server.isComplete).toBe(false);
    } finally {
      upload.resolve();
      finish.resolve();
      await running;
      await server.close();
      vi.useRealTimers();
    }
    expect(api.doneBodies[0]?.body.status).toBe(status);
  },
);

test('machine start precedes the relay socket and token publication', async () => {
  const starts: boolean[] = [];
  const provider = new FakeOrbProvider({
    runner: async (argv) => {
      if (argv[1] === 'start') {
        const directory = join(provider.runtimeRoot, argv[2]!);
        starts.push(
          existsSync(join(directory, 'relay.sock')) ||
            existsSync(join(directory, 'relay.sock.token')),
        );
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle } = await boot({ api, orbProvider: provider, capEnv: { CAIRN_EXECUTOR: 'orb' } });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(starts).toEqual([false]);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('a previous fake worker cannot disconnect the next step listener', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orb-worker-reuse-'));
  const socketPath = join(root, 'relay.sock');
  const exit = defer();
  const provider = new FakeOrbProvider({
    runner: async (argv) => {
      if (argv[0] === 'orb-worker') await exit.promise;
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  const api = new FakeMachineApi();
  const first = new RelayMachineServer({
    socketPath,
    release: orbTestRelease(socketPath),
    stepId: 's1',
    upstream: api,
  });
  const second = new RelayMachineServer({
    socketPath,
    release: orbTestRelease(socketPath),
    stepId: 's2',
    upstream: api,
  });
  await first.listen();
  const previous = provider.launchWorker(handle, {
    socketPath,
    distRoot: provider.distRoot,
    seedRoot: provider.seedRoot,
    outboxRoot: join(root, 'outbox'),
  });
  try {
    await first.close();
    await second.listen();
    exit.resolve();
    await previous;
    const worker = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
    try {
      await worker.api.heartbeat('s2');
      expect(api.calls).toContain('heartbeat:s2');
    } finally {
      worker.close();
    }
  } finally {
    exit.resolve();
    await previous;
    await first.close();
    await second.close();
  }
});
