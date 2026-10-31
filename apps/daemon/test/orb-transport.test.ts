import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { runGitOk } from '../src/git.js';
import { encodeOrbFrame, ORB_STEP_METHODS } from '../src/orb/protocol.js';
import { NspawnOrbProvider } from '../src/orb/provider.js';
import { RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import { runOrbWorker } from '../src/orb/worker.js';
import { CLAIMED, defer, FakeMachineApi, fakeBackend } from './machine-loop-harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orb-transport-'));
  const distSource = join(root, 'build');
  mkdirSync(distSource);
  writeFileSync(join(distSource, 'cli.mjs'), 'first');
  const commands: string[][] = [];
  const running = new Set<string>();
  const provider = new NspawnOrbProvider({
    runtimeRoot: join(root, 'run'),
    distRoot: join(root, 'dist'),
    seedRoot: join(root, 'seed'),
    distSource,
    runner: async (argv) => {
      commands.push([...argv]);
      if (argv[1] === 'start') running.add(argv[2]!);
      return { code: 0, stdout: argv[1] === 'list' ? [...running].join('\n') : '', stderr: '' };
    },
  });
  return { root, provider, commands, distSource };
}

test('prepares private fixed bind roots and publishes complete daemon releases before starting', async () => {
  const { provider, commands, distSource, root } = fixture();
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  expect(commands.map((argv) => argv[1])).toEqual(['clone']);
  const directory = await provider.prepare(handle);
  expect(directory).toBe(join(root, 'run', handle.id));
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  expect(readFileSync(join(root, 'dist', 'current', 'cli.mjs'), 'utf8')).toBe('first');
  const published = readdirSync(join(root, 'dist'));
  await provider.prepare(handle);
  expect(readdirSync(join(root, 'dist'))).toEqual(published);
  writeFileSync(join(distSource, 'cli.mjs'), 'second');
  await provider.prepare(handle);
  expect(readFileSync(join(root, 'dist', 'current', 'cli.mjs'), 'utf8')).toBe('second');
  await provider.start(handle);
  await provider.start(handle);
  expect(commands.map((argv) => argv[1])).toEqual(['clone', 'start', 'list']);
  expect(commands.every((argv) => argv[0] === 'machinectl')).toBe(true);
});

test.each(['missing', 'foreign'] as const)(
  'refuses %s authentication without reserving the worker connection',
  async (kind) => {
    const { root } = fixture();
    const socketPath = join(root, 'relay.sock');
    const api = new FakeMachineApi();
    const token = vi.spyOn(api, 'token');
    const server = new RelayMachineServer({ socketPath, stepId: 's1', upstream: api });
    await server.listen();
    const attacker = createConnection(socketPath);
    attacker.on('error', () => {});
    let received = '';
    attacker.on('data', (chunk) => {
      received += chunk.toString();
    });
    try {
      await new Promise<void>((resolve) => attacker.once('connect', resolve));
      attacker.write(
        kind === 'missing'
          ? encodeOrbFrame({ type: 'call', id: 0, method: 'token', args: ['s1'] })
          : `${'cairn-orb-rpc:'}${JSON.stringify({ type: 'auth', token: 'f'.repeat(64) })}\n`,
      );
      await vi.waitFor(() => expect(attacker.destroyed).toBe(true));
      expect(received).toBe('');
      expect(token).not.toHaveBeenCalled();
      expect(statSync(`${socketPath}.token`).mode & 0o777).toBe(0o600);
      const worker = await RelayMachineApi.connect(socketPath);
      await worker.api.token('s1');
      worker.close();
      expect(token).toHaveBeenCalledTimes(1);
    } finally {
      attacker.destroy();
      await server.close();
    }
    expect(existsSync(`${socketPath}.token`)).toBe(false);
  },
);

test('failed daemon publication retains the previous complete release', async () => {
  const { root, provider, distSource } = fixture();
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  await provider.prepare(handle);
  rmSync(distSource, { recursive: true });
  await expect(provider.prepare(handle)).rejects.toThrow();
  expect(readFileSync(join(root, 'dist', 'cli.mjs'), 'utf8')).toBe('first');
  mkdirSync(distSource);
  await expect(provider.prepare(handle)).rejects.toThrow('Orb daemon build is missing cli.mjs');
  expect(readFileSync(join(root, 'dist', 'cli.mjs'), 'utf8')).toBe('first');
});

test('seed publication replaces a complete snapshot atomically and preserves it after failure', async () => {
  const { root, provider } = fixture();
  const repo = join(root, 'repo');
  await runGitOk(['init', '-b', 'main', repo]);
  await runGitOk(
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'Seed',
    ],
    { cwd: repo },
  );
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  await provider.prepare(handle, repo);
  const seed = join(root, 'seed', 'project', 'repo');
  const first = await runGitOk(['rev-parse', 'HEAD'], { cwd: seed });
  await runGitOk(
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'Update',
    ],
    { cwd: repo },
  );
  await provider.prepare(handle, repo);
  const second = await runGitOk(['rev-parse', 'HEAD'], { cwd: seed });
  expect(second).not.toBe(first);
  await expect(provider.prepare(handle, join(root, 'build'))).rejects.toThrow();
  expect(await runGitOk(['rev-parse', 'HEAD'], { cwd: seed })).toBe(second);
});

test('cancellation during machine start powers off the machine after it starts', async () => {
  const start = defer();
  const controller = new AbortController();
  const commands: string[][] = [];
  const provider = new NspawnOrbProvider({
    runner: async (argv) => {
      commands.push([...argv]);
      if (argv[1] === 'start') await start.promise;
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  const starting = provider.start(handle, { signal: controller.signal });
  controller.abort();
  start.resolve();
  await expect(starting).rejects.toThrow();
  expect(handle.running).toBe(false);
  expect(commands.map((argv) => argv[1])).toEqual(['clone', 'start', 'poweroff', 'list']);
});

test('worker waits for the bound socket, runs one step and can restart for the next connection', async () => {
  const { root } = fixture();
  const socketPath = join(root, 'delayed', 'relay.sock');
  const api = new FakeMachineApi();
  const backend = fakeBackend([{ type: 'done', usage: [] }]);
  const options = {
    socketPath,
    home: join(root, 'worker'),
    workspacesRoot: join(root, 'work'),
    backendFor: () => backend.backend,
  };
  const worker = runOrbWorker(options);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  expect(backend.created).toHaveLength(0);
  const first = new RelayMachineServer({
    socketPath,
    stepId: 's1',
    upstream: api,
    input: { claimed: CLAIMED, options: {}, methods: [...ORB_STEP_METHODS] },
  });
  await first.listen();
  const oldToken = readFileSync(`${socketPath}.token`, 'utf8');
  await worker;
  await first.close();
  const second = new RelayMachineServer({
    socketPath,
    stepId: 's2',
    upstream: api,
    input: {
      claimed: { ...CLAIMED, step: { ...CLAIMED.step, id: 's2' } },
      options: {},
      methods: [...ORB_STEP_METHODS],
    },
  });
  await second.listen();
  expect(readFileSync(`${socketPath}.token`, 'utf8')).not.toBe(oldToken);
  await runOrbWorker(options);
  await second.close();
  expect(api.doneBodies.map((row) => [row.stepId, row.body.status])).toEqual([
    ['s1', 'success'],
    ['s2', 'success'],
  ]);
});
