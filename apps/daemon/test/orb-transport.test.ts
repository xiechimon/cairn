import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test, vi } from 'vitest';
import { runGitOk } from '../src/git.js';
import { encodeOrbFrame, ORB_STEP_METHODS } from '../src/orb/protocol.js';
import { NspawnOrbProvider } from '../src/orb/provider.js';
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
import { createOrbCheckout } from './orb-dist-fixture.js';
import { orbTestEntry, orbTestRelease } from './orb-release-fixture.js';

test.each(['symlink', 'directory', 'file'] as const)(
  'refuses a pre-planted outbox %s without replacing it or touching its target',
  async (kind) => {
    let outbox = '';
    const { provider, root } = fixture({
      onStart: (directory) => {
        mkdirSync(directory, { mode: 0o700 });
        outbox = join(directory, 'outbox');
        if (kind === 'symlink') symlinkSync(join(root, 'outside'), outbox, 'dir');
        else if (kind === 'directory') mkdirSync(outbox);
        else writeFileSync(outbox, 'pre-planted');
      },
    });
    const outside = join(root, 'outside');
    mkdirSync(outside, { mode: 0o750 });
    writeFileSync(join(outside, 'sentinel'), 'unchanged');
    const metadata = lstatSync(outside);
    await runGitOk(['init', '-b', 'main', root]);
    await runGitOk(
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'Initial',
      ],
      { cwd: root },
    );
    const listen = vi
      .spyOn(RelayMachineServer.prototype, 'listen')
      .mockRejectedValue(new Error('Unexpected relay publication'));
    const api = new FakeMachineApi();
    api.claimQueue.push({
      ...CLAIMED,
      project: { ...CLAIMED.project!, repo: { kind: 'local', cloneUrl: root } },
    });
    const { handle } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect(api.doneBodies[0]?.body).toMatchObject({
        status: 'failed',
        errorMessage: expect.stringContaining('EEXIST'),
      });
      expect(listen).not.toHaveBeenCalled();
      expect(lstatSync(outbox).ino).toBeGreaterThan(0);
      if (kind === 'symlink') expect(readlinkSync(outbox)).toBe(outside);
      else if (kind === 'directory') expect(lstatSync(outbox).isDirectory()).toBe(true);
      else expect(readFileSync(outbox, 'utf8')).toBe('pre-planted');
      expect(lstatSync(outside).mode).toBe(metadata.mode);
      expect(lstatSync(outside).mtimeMs).toBe(metadata.mtimeMs);
      expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('unchanged');
    } finally {
      await handle.stop();
      await handle.done;
      listen.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(['relay.sock', 'relay.sock.token'] as const)(
  'refuses existing and dangling symlinks at %s without touching their targets',
  async (name) => {
    for (const present of [true, false]) {
      const { root } = fixture();
      const target = join(root, 'outside');
      if (present) writeFileSync(target, 'unchanged', { mode: 0o640 });
      const planted = join(root, name);
      symlinkSync(target, planted);
      const metadata = present ? lstatSync(target) : undefined;
      const relay = new RelayMachineServer({
        socketPath: join(root, 'relay.sock'),
        release: orbTestRelease(join(root, 'relay.sock')),
        stepId: 's1',
        upstream: new FakeMachineApi(),
      });
      try {
        await expect(relay.listen()).rejects.toThrow();
        await relay.close();
        expect(readlinkSync(planted)).toBe(target);
        if (metadata) {
          expect(lstatSync(target).mode).toBe(metadata.mode);
          expect(lstatSync(target).mtimeMs).toBe(metadata.mtimeMs);
          expect(readFileSync(target, 'utf8')).toBe('unchanged');
        } else expect(existsSync(target)).toBe(false);
      } finally {
        await relay.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
);

test.each(['symlink', 'hardlink', 'oversized'] as const)(
  'refuses a %s relay token before connecting',
  async (kind) => {
    const { root } = fixture();
    const socketPath = join(root, 'relay.sock');
    const relay = new RelayMachineServer({
      socketPath,
      release: orbTestRelease(socketPath),
      stepId: 's1',
      upstream: new FakeMachineApi(),
    });
    await relay.listen();
    const tokenPath = `${socketPath}.token`;
    const target = join(root, 'outside');
    writeFileSync(target, readFileSync(tokenPath));
    rmSync(tokenPath);
    if (kind === 'symlink') symlinkSync(target, tokenPath);
    else if (kind === 'hardlink') linkSync(target, tokenPath);
    else writeFileSync(tokenPath, 'f'.repeat(65));
    const metadata = lstatSync(target);
    try {
      const connection = RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
      void connection.then(
        (client) => client.close(),
        () => {},
      );
      await expect(connection).rejects.toThrow(/regular file|size cap/);
      expect(lstatSync(target).atimeMs).toBe(metadata.atimeMs);
    } finally {
      await relay.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('refuses a FIFO relay token without blocking', async () => {
  const { root } = fixture();
  const socketPath = join(root, 'relay.sock');
  execFileSync('mkfifo', [`${socketPath}.token`]);
  try {
    const entry = join(root, 'fifo-probe.mjs');
    await build({
      stdin: {
        contents: `import { RelayMachineApi } from ${JSON.stringify(resolve('apps/daemon/src/orb/relay.ts'))}; try { await RelayMachineApi.connect(${JSON.stringify(socketPath)}, ${JSON.stringify(orbTestRelease(socketPath))}); process.exitCode = 1; } catch {}`,
        resolveDir: resolve('.'),
      },
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    const result = execFileSync(process.execPath, [entry], { timeout: 3_000 });
    expect(result.length).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exclusive token publication refuses a symlink planted after relay preflight', async () => {
  const { root } = fixture();
  const socketPath = join(root, 'relay.sock');
  const tokenPath = `${socketPath}.token`;
  const target = join(root, 'outside');
  writeFileSync(target, 'unchanged', { mode: 0o640 });
  const metadata = lstatSync(target);
  const relay = new RelayMachineServer({
    socketPath,
    release: orbTestRelease(socketPath),
    stepId: 's1',
    upstream: new FakeMachineApi(),
  });
  const listening = relay.listen();
  symlinkSync(target, tokenPath);
  try {
    await expect(listening).rejects.toThrow('EEXIST');
    await relay.close();
    expect(readlinkSync(tokenPath)).toBe(target);
    expect(lstatSync(target).mode).toBe(metadata.mode);
    expect(lstatSync(target).mtimeMs).toBe(metadata.mtimeMs);
    expect(readFileSync(target, 'utf8')).toBe('unchanged');
  } finally {
    await relay.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay publishes mode 0600 paths and restores a restrictive process umask', async () => {
  const { root } = fixture();
  const socketPath = join(root, 'relay.sock');
  const relay = new RelayMachineServer({
    socketPath,
    release: orbTestRelease(socketPath),
    stepId: 's1',
    upstream: new FakeMachineApi(),
  });
  const mask = process.umask(0o777);
  try {
    await relay.listen();
    expect(process.umask()).toBe(0o777);
    expect(lstatSync(socketPath).mode & 0o777).toBe(0o600);
    expect(lstatSync(`${socketPath}.token`).mode & 0o777).toBe(0o600);
  } finally {
    process.umask(mask);
    await relay.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(
  options: {
    onStart?: (directory: string) => void | Promise<void>;
    runtimeDirectoryTimeoutMs?: number;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'orb-transport-'));
  const { checkout, distSource, runner: distRunner } = createOrbCheckout(root);
  for (const name of ['run', 'dist', 'seed']) mkdirSync(join(root, name));
  const commands: string[][] = [];
  const running = new Set<string>();
  const provider = new NspawnOrbProvider({
    runtimeRoot: join(root, 'run'),
    distRoot: join(root, 'dist'),
    seedRoot: join(root, 'seed'),
    distSource,
    runtimeDirectoryTimeoutMs: options.runtimeDirectoryTimeoutMs,
    runner: async (argv, execOptions) => {
      if (argv[0] !== 'machinectl') return distRunner(argv, execOptions);
      commands.push([...argv]);
      if (argv[1] === 'start') {
        const directory = join(root, 'run', argv[2]!);
        if (options.onStart) await options.onStart(directory);
        else mkdirSync(directory, { recursive: true, mode: 0o700 });
        running.add(argv[2]!);
      }
      if (argv[1] === 'poweroff' || argv[1] === 'terminate') running.delete(argv[2]!);
      return { code: 0, stdout: argv[1] === 'list' ? [...running].join('\n') : '', stderr: '' };
    },
  });
  return { root, provider, commands, distSource, checkout, running };
}

test('publishes releases without creating the runtime directory and reuses a running machine', async () => {
  const { provider, commands, distSource, checkout, root } = fixture();
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  expect(commands.map((argv) => argv[1])).toEqual(['clone']);
  const directory = await provider.prepare(handle);
  expect(directory).toBe(join(root, 'run', handle.id));
  expect(existsSync(directory)).toBe(false);
  expect(readFileSync(join(root, 'dist', 'current', 'dist', 'cli.mjs'), 'utf8')).toBe('first');
  const published = readdirSync(join(root, 'dist'));
  await provider.prepare(handle);
  expect(readdirSync(join(root, 'dist'))).toEqual(published);
  writeFileSync(join(checkout, 'source.txt'), 'second');
  writeFileSync(join(distSource, 'cli.mjs'), 'second');
  await provider.prepare(handle);
  expect(readFileSync(join(root, 'dist', 'current', 'dist', 'cli.mjs'), 'utf8')).toBe('second');
  await provider.start(handle);
  expect(statSync(directory).mode & 0o777).toBe(0o700);
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
    const server = new RelayMachineServer({
      socketPath,
      release: orbTestRelease(socketPath),
      stepId: 's1',
      upstream: api,
    });
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
          : `${'cairn-orb-rpc:'}${JSON.stringify({ type: 'auth', token: 'f'.repeat(64), release: orbTestRelease(socketPath) })}\n`,
      );
      await vi.waitFor(() => expect(attacker.destroyed).toBe(true));
      expect(received).toBe('');
      expect(token).not.toHaveBeenCalled();
      expect(statSync(`${socketPath}.token`).mode & 0o777).toBe(0o600);
      const worker = await RelayMachineApi.connect(socketPath, orbTestRelease(socketPath));
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
  const { root, provider, distSource, checkout } = fixture();
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  await provider.prepare(handle);
  writeFileSync(join(checkout, 'source.txt'), 'new build');
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
  await vi.waitFor(() => expect(commands.some((argv) => argv[1] === 'start')).toBe(true));
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
    entryPath: orbTestEntry(socketPath),
    socketPath,
    home: join(root, 'worker'),
    workspacesRoot: join(root, 'work'),
    backendFor: () => backend.backend,
  };
  const worker = runOrbWorker(options);
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  expect(backend.created).toHaveLength(0);
  mkdirSync(join(root, 'delayed'), { mode: 0o700 });
  const first = new RelayMachineServer({
    socketPath,
    release: orbTestRelease(socketPath),
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
    release: orbTestRelease(socketPath),
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

test('waits for the root start hook before accepting the runtime directory', async () => {
  const { provider, root } = fixture({ onStart: () => {} });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  let settled = false;
  const starting = provider.start(handle).then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  expect(settled).toBe(false);
  const directory = join(root, 'run', handle.id);
  mkdirSync(directory, { mode: 0o700 });
  await starting;
  expect(settled).toBe(true);
});

test.each(['symlink', 'file', 'owner', 'mode'] as const)(
  'refuses a runtime directory with invalid %s and powers off its machine',
  async (kind) => {
    const { provider, commands, root } = fixture({
      onStart: (directory) => {
        if (kind === 'symlink') symlinkSync(root, directory, 'dir');
        else if (kind === 'file') writeFileSync(directory, '');
        else mkdirSync(directory, { mode: kind === 'mode' ? 0o755 : 0o700 });
      },
    });
    const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
    const uid =
      kind === 'owner'
        ? vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1)
        : undefined;
    try {
      await expect(provider.start(handle)).rejects.toThrow(
        kind === 'owner' ? 'owned by daemon uid' : kind === 'mode' ? 'mode 0700' : 'real directory',
      );
      expect(handle.running).toBe(false);
      expect(commands.map((argv) => argv[1])).toEqual(['clone', 'start', 'poweroff', 'list']);
      expect(existsSync(join(root, 'run', handle.id, 'relay.sock.token'))).toBe(false);
    } finally {
      uid?.mockRestore();
    }
  },
);

test('a missing runtime directory times out cleanly and powers off the machine', async () => {
  const { provider, commands, root } = fixture({
    onStart: () => {},
    runtimeDirectoryTimeoutMs: 20,
  });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  await expect(provider.start(handle)).rejects.toThrow(
    'Timed out waiting for orb runtime directory',
  );
  expect(handle.running).toBe(false);
  expect(commands.map((argv) => argv[1])).toEqual(['clone', 'start', 'poweroff', 'list']);
  expect(existsSync(join(root, 'run', handle.id))).toBe(false);
});

test('cancelling the runtime directory wait powers off the machine', async () => {
  const { provider, commands } = fixture({ onStart: () => {} });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  const controller = new AbortController();
  const starting = provider.start(handle, { signal: controller.signal });
  const rejected = expect(starting).rejects.toThrow('cancel directory wait');
  void rejected.catch(() => {});
  await vi.waitFor(() => expect(handle.running).toBe(true));
  controller.abort(new Error('cancel directory wait'));
  await rejected;
  expect(handle.running).toBe(false);
  expect(commands.map((argv) => argv[1])).toEqual(['clone', 'start', 'poweroff', 'list']);
});

test('revalidates the runtime directory of an already running machine', async () => {
  const { provider, commands, root } = fixture();
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  await provider.start(handle);
  chmodSync(join(root, 'run', handle.id), 0o755);
  await expect(provider.start(handle)).rejects.toThrow('mode 0700');
  expect(handle.running).toBe(false);
  expect(commands.filter((argv) => argv[1] === 'start')).toHaveLength(1);
  expect(commands.some((argv) => argv[1] === 'poweroff')).toBe(true);
});

test.each(['dist', 'seed'] as const)(
  'requires the installer %s root without creating or repairing it',
  async (name) => {
    const { provider, root } = fixture();
    const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
    const directory = join(root, name);
    rmSync(directory, { recursive: true });
    await expect(provider.prepare(handle)).rejects.toThrow(`Orb ${name} root`);
    expect(existsSync(directory)).toBe(false);
    writeFileSync(directory, '');
    await expect(provider.prepare(handle)).rejects.toThrow('real directory');
    rmSync(directory);
    symlinkSync(root, directory, 'dir');
    await expect(provider.prepare(handle)).rejects.toThrow('real directory');
    rmSync(directory);
    mkdirSync(directory, { mode: 0o750 });
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1);
    try {
      await expect(provider.prepare(handle)).rejects.toThrow('owned by daemon uid');
    } finally {
      uid.mockRestore();
    }
    await provider.prepare(handle);
    expect(statSync(directory).mode & 0o777).toBe(0o750);
  },
);

test('relay never creates a missing runtime directory', async () => {
  const { root } = fixture();
  const directory = join(root, 'absent');
  const relay = new RelayMachineServer({
    socketPath: join(directory, 'relay.sock'),
    release: orbTestRelease(join(directory, 'relay.sock')),
    stepId: 's1',
    upstream: new FakeMachineApi(),
  });
  try {
    await expect(relay.listen()).rejects.toThrow();
    expect(existsSync(directory)).toBe(false);
  } finally {
    await relay.close();
  }
});

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects an unbounded or negative runtime directory timeout %s',
  (runtimeDirectoryTimeoutMs) => {
    expect(() => new NspawnOrbProvider({ runtimeDirectoryTimeoutMs })).toThrow(
      'Orb runtime directory timeout must be finite and nonnegative',
    );
  },
);

test('the default runtime directory deadline is thirty seconds', async () => {
  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const controller = new AbortController();
  const { provider } = fixture({ onStart: () => {} });
  const handle = await provider.ensure({ conversationId: 'thread', projectId: 'project' });
  const starting = provider.start(handle, { signal: controller.signal }).then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await vi.waitFor(() => expect(handle.running).toBe(true));
    now = 29_999;
    await new Promise<void>((resolve) => setTimeout(resolve, 110));
    expect(handle.running).toBe(true);
    now = 30_000;
    expect(await starting).toMatchObject({
      message: expect.stringContaining('Timed out waiting for orb runtime directory'),
    });
    expect(handle.running).toBe(false);
  } finally {
    controller.abort();
    await starting;
    clock.mockRestore();
  }
});

test.each(['missing', 'mode'] as const)(
  'runtime directory %s failure reports the reason through the host step and powers off',
  async (kind) => {
    const { provider, commands } = fixture({
      onStart: (directory) => {
        if (kind === 'mode') mkdirSync(directory, { mode: 0o755 });
      },
      runtimeDirectoryTimeoutMs: 20,
    });
    const api = new FakeMachineApi();
    api.claimQueue.push(CLAIMED);
    const { handle } = await boot({
      api,
      orbProvider: provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect(api.doneBodies).toEqual([
        {
          stepId: 's1',
          body: {
            status: 'failed',
            errorMessage: expect.stringContaining(
              kind === 'missing' ? 'Timed out waiting for orb runtime directory' : 'mode 0700',
            ),
          },
        },
      ]);
      expect(commands.some((argv) => argv[1] === 'poweroff')).toBe(true);
      expect((await provider.list())[0]?.running).toBe(false);
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);
