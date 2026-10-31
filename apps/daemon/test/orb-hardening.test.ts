import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { StepJournal } from '../src/journal.js';
import { NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import { RunStop } from '../src/step-stops.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';
import { createOrbCheckout } from './orb-dist-fixture.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orb-hardening-'));
  roots.push(root);
  const checkout = createOrbCheckout(root);
  const runtimeRoot = join(root, 'run');
  const distRoot = join(root, 'dist');
  const seedRoot = join(root, 'seed');
  for (const directory of [runtimeRoot, distRoot, seedRoot]) mkdirSync(directory);
  const machines = new Set<string>();
  const commands: string[][] = [];
  const runner: OrbCommandRunner = async (argv, options) => {
    if (argv[0] !== 'machinectl') return checkout.runner(argv, options);
    commands.push([...argv]);
    const id = argv[2] ?? '';
    if (argv[1] === 'start') {
      mkdirSync(join(runtimeRoot, id), { recursive: true, mode: 0o700 });
      machines.add(id);
    }
    if (argv[1] === 'poweroff') {
      machines.delete(id);
      rmSync(join(runtimeRoot, id), { recursive: true, force: true });
    }
    return { code: 0, stdout: argv[1] === 'list' ? [...machines].join('\n') : '', stderr: '' };
  };
  const options = {
    runtimeRoot,
    distRoot,
    seedRoot,
    distSource: checkout.distSource,
    stateFile: join(root, 'state.json'),
    runner,
  };
  return {
    ...checkout,
    ...options,
    root,
    commands,
    provider: new NspawnOrbProvider(options),
    options,
  };
}

test('daemon restart recovers a running machine with stale relay files and resumes its step', async () => {
  const f = fixture();
  const machine = await f.provider.ensure({
    conversationId: CLAIMED.conversationId,
    projectId: 'p1',
  });
  await f.provider.prepare(machine);
  await f.provider.start(machine);
  const socketPath = join(f.runtimeRoot, machine.id, 'relay.sock');
  execFileSync(process.execPath, [
    '-e',
    'require("node:net").createServer().listen(process.argv[1], () => process.exit(0))',
    socketPath,
  ]);
  writeFileSync(`${socketPath}.token`, 'stale token');
  const listen = RelayMachineServer.prototype.listen;
  const worker = vi
    .spyOn(RelayMachineServer.prototype, 'listen')
    .mockImplementation(async function (this: RelayMachineServer) {
      await listen.call(this);
      const relay = await RelayMachineApi.connect(socketPath);
      await relay.api.done('s1', { status: 'success' });
      relay.close();
    });
  const api = new FakeMachineApi();
  api.recoverSteps = [{ ...CLAIMED.step, kind: 'plan' }];
  const { handle, paths } = await boot({
    api,
    orbProvider: new NspawnOrbProvider(f.options),
    capEnv: { CAIRN_EXECUTOR: 'orb' },
    seedJournal: (paths) =>
      new StepJournal(paths.outboxDir).claim({
        stepId: 's1',
        buildId: CLAIMED.step.buildId,
        kind: 'plan',
        conversationId: CLAIMED.conversationId,
        sessionAction: 'new',
        prompt: null,
        claimed: CLAIMED,
      }),
  });
  try {
    expect(api.doneBodies).toEqual([{ stepId: 's1', body: { status: 'success' } }]);
    expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(f.commands.filter((argv) => argv[1] === 'start')).toHaveLength(1);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test.each(['relay.sock', 'relay.sock.token', 'outbox'])(
  'a planted %s directory powers off and restarts the machine before accepting a worker',
  async (name) => {
    const f = fixture();
    const machine = await f.provider.ensure({
      conversationId: CLAIMED.conversationId,
      projectId: 'p1',
    });
    await f.provider.prepare(machine);
    await f.provider.start(machine);
    const directory = join(f.runtimeRoot, machine.id);
    mkdirSync(join(directory, name));
    const planted = name === 'outbox' ? join(directory, name, 'nested') : join(directory, name);
    if (name === 'outbox') mkdirSync(planted);
    writeFileSync(join(planted, 'guest-file'), 'left for root');
    const listen = RelayMachineServer.prototype.listen;
    vi.spyOn(RelayMachineServer.prototype, 'listen').mockImplementation(async function (
      this: RelayMachineServer,
    ) {
      await listen.call(this);
      expect(statSync(join(directory, 'outbox')).isDirectory()).toBe(true);
      const relay = await RelayMachineApi.connect(join(directory, 'relay.sock'));
      await relay.api.done('s1', { status: 'success' });
      relay.close();
    });
    const api = new FakeMachineApi();
    api.claimQueue.push({
      ...CLAIMED,
      project: { ...CLAIMED.project!, repo: { kind: 'local', cloneUrl: f.checkout } },
    });
    const { handle } = await boot({
      api,
      orbProvider: f.provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      expect(api.doneBodies[0]?.body.status).toBe('success');
      expect(
        f.commands
          .filter((argv) => ['start', 'poweroff'].includes(argv[1] ?? ''))
          .map((argv) => argv[1]),
      ).toEqual(['start', 'poweroff', 'start']);
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);

test('any listen failure powers off a running machine and still reports failure', async () => {
  const f = fixture();
  vi.spyOn(RelayMachineServer.prototype, 'listen').mockRejectedValue(new Error('listen failed'));
  const api = new FakeMachineApi();
  api.claimQueue.push(CLAIMED);
  const { handle } = await boot({
    api,
    orbProvider: f.provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'listen failed',
    });
    expect(f.commands.filter((argv) => argv[1] === 'poweroff')).toHaveLength(1);
    expect((await f.provider.list())[0]?.running).toBe(false);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test.each(['directory', 'close-rejection'])(
  'relay %s cannot skip fallback done, outbox cleanup or stop settlement',
  async (failure) => {
    const f = fixture();
    const socketPath = join(f.runtimeRoot, 'cairn-orb-conv-1', 'relay.sock');
    const listen = RelayMachineServer.prototype.listen;
    vi.spyOn(RelayMachineServer.prototype, 'listen').mockImplementation(async function (
      this: RelayMachineServer,
    ) {
      await listen.call(this);
      const relay = await RelayMachineApi.connect(socketPath);
      if (failure === 'directory') {
        rmSync(socketPath);
        mkdirSync(socketPath);
      }
      relay.close();
    });
    if (failure === 'close-rejection') {
      const close = RelayMachineServer.prototype.close;
      vi.spyOn(RelayMachineServer.prototype, 'close').mockImplementation(async function (
        this: RelayMachineServer,
      ) {
        await close.call(this);
        throw new Error('close failed');
      });
    }
    const settle = vi.spyOn(RunStop.prototype, 'settle');
    const api = new FakeMachineApi();
    api.claimQueue.push({
      ...CLAIMED,
      project: { ...CLAIMED.project!, repo: { kind: 'local', cloneUrl: f.checkout } },
    });
    const { handle, paths } = await boot({
      api,
      orbProvider: f.provider,
      capEnv: { CAIRN_EXECUTOR: 'orb' },
    });
    try {
      await waitFor(() => api.doneBodies.length === 1);
      await waitFor(() => settle.mock.calls.length === 1);
      expect(api.doneBodies[0]?.body.status).toBe('failed');
      expect(new StepJournal(paths.outboxDir).pending()).toEqual([]);
      expect(existsSync(join(dirname(socketPath), 'outbox'))).toBe(false);
    } finally {
      await handle.stop();
      await handle.done;
    }
  },
);

test('outbox cleanup removes direct files and symlinks but leaves nested directories for root', async () => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'sentinel'), 'untouched');
  const socketPath = join(f.runtimeRoot, 'cairn-orb-conv-1', 'relay.sock');
  const outbox = join(dirname(socketPath), 'outbox');
  const listen = RelayMachineServer.prototype.listen;
  vi.spyOn(RelayMachineServer.prototype, 'listen').mockImplementation(async function (
    this: RelayMachineServer,
  ) {
    await listen.call(this);
    mkdirSync(join(outbox, 'nested'));
    writeFileSync(join(outbox, 'nested/sentinel'), 'guest nested');
    writeFileSync(join(outbox, 'direct.bundle'), 'direct');
    symlinkSync(outside, join(outbox, 'outside'));
    const relay = await RelayMachineApi.connect(socketPath);
    relay.close();
  });
  const settle = vi.spyOn(RunStop.prototype, 'settle');
  const api = new FakeMachineApi();
  api.claimQueue.push({
    ...CLAIMED,
    project: { ...CLAIMED.project!, repo: { kind: 'local', cloneUrl: f.checkout } },
  });
  const { handle } = await boot({
    api,
    orbProvider: f.provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => settle.mock.calls.length === 1);
    expect(readFileSync(join(outbox, 'nested/sentinel'), 'utf8')).toBe('guest nested');
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('untouched');
    expect(readdirSync(outbox)).toEqual(['nested']);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('running release pins survive daemon restart and are pruned only after machine stop', async () => {
  const f = fixture();
  const machine = await f.provider.ensure({ conversationId: 'old', projectId: 'p1' });
  await f.provider.prepare(machine);
  await f.provider.start(machine);
  const pinned = readlinkSync(join(f.distRoot, 'current'));
  utimesSync(join(f.distRoot, pinned), 1, 1);
  const recovered = new NspawnOrbProvider(f.options);
  const next = await recovered.ensure({ conversationId: 'new', projectId: 'p1' });
  for (let index = 0; index < 4; index++) {
    writeFileSync(join(f.checkout, 'source.txt'), `source-${index}`);
    await recovered.prepare(next);
  }
  expect(existsSync(join(f.distRoot, pinned))).toBe(true);
  expect(readFileSync(join(f.distRoot, pinned, 'dist/cli.mjs'), 'utf8')).toBe('first');
  await recovered.stop((await recovered.list()).find((handle) => handle.id === machine.id)!);
  await recovered.prepare(next);
  expect(existsSync(join(f.distRoot, pinned))).toBe(false);
}, 30_000);

test('seed pruning keeps current and running versions across restart then removes stopped versions', async () => {
  const f = fixture();
  const machine = await f.provider.ensure({ conversationId: 'old', projectId: 'p1' });
  await f.provider.prepare(machine, f.checkout);
  await f.provider.start(machine);
  const project = join(f.seedRoot, 'p1');
  const pinned = readlinkSync(join(project, 'current'));
  const recovered = new NspawnOrbProvider(f.options);
  const next = await recovered.ensure({ conversationId: 'new', projectId: 'p1' });
  for (let index = 0; index < 3; index++) {
    writeFileSync(join(f.checkout, 'source.txt'), `seed-${index}`);
    execFileSync('git', ['-C', f.checkout, 'add', 'source.txt']);
    execFileSync('git', [
      '-C',
      f.checkout,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-m',
      `Seed ${index}`,
    ]);
    await recovered.prepare(next, f.checkout);
  }
  const current = readlinkSync(join(project, 'current'));
  expect(
    readdirSync(project)
      .filter((name) => name.startsWith('.data-'))
      .sort(),
  ).toEqual([pinned, current].sort());
  expect(statSync(join(project, pinned, 'repo')).isDirectory()).toBe(true);
  await recovered.stop((await recovered.list()).find((handle) => handle.id === machine.id)!);
  await recovered.prepare(next, f.checkout);
  expect(readdirSync(project).filter((name) => name.startsWith('.data-'))).toEqual([
    readlinkSync(join(project, 'current')),
  ]);
}, 30_000);
