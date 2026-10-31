import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { OrbLifecycle, resolveOrbCap } from '../src/orb/lifecycle.js';
import { HostOrbProvider, NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { rejectGuestExec } from './orb-fake.js';

function fixture() {
  const commands: string[][] = [];
  const machines = new Set<string>();
  const runner: OrbCommandRunner = async (argv) => {
    rejectGuestExec(argv);
    commands.push([...argv]);
    if (argv[1] === 'start') machines.add(argv[2]!);
    if (argv[1] === 'poweroff' || argv[1] === 'terminate') machines.delete(argv[2]!);
    return { code: 0, stdout: argv[1] === 'list' ? [...machines].join('\n') : '', stderr: '' };
  };
  const stateFile = join(mkdtempSync(join(tmpdir(), 'cairn-orbs-')), 'state.json');
  const provider = new NspawnOrbProvider({ runner, stateFile });
  return { commands, machines, runner, provider, stateFile };
}

test.each([
  ['systemd-run', '-M', 'cairn-orb-A'],
  ['systemd-run', '--machine', 'cairn-orb-A'],
  ['systemd-run', '--machine=cairn-orb-A'],
  ['machinectl', 'bind', 'cairn-orb-A', '/host', '/guest'],
  ['machinectl', 'shell', 'cairn-orb-A'],
  ['machinectl', 'login', 'cairn-orb-A'],
])('fake rejects forbidden transport %j', (...argv) => {
  expect(() => rejectGuestExec(argv)).toThrow('Forbidden guest transport');
});

describe('Orb provider', () => {
  test('clones once, serializes ensure and bounds unique machine names', async () => {
    const { provider, commands } = fixture();
    const [first, again] = await Promise.all([
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
    ]);
    expect(commands).toEqual([['machinectl', 'clone', 'cairn-orb-base', 'cairn-orb-C']]);
    expect(again).toBe(first);
    const long = await provider.ensure({ conversationId: 'a'.repeat(150), projectId: 'P' });
    const other = await provider.ensure({ conversationId: `${'a'.repeat(149)}b`, projectId: 'P' });
    expect(long.id.length).toBeLessThanOrEqual(64);
    expect(other.id).not.toBe(long.id);
  });

  test('recovers running machines and restarts stopped machines without cloning again', async () => {
    const { provider, runner, stateFile, commands, machines } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await provider.start(handle);
    const recovered = new NspawnOrbProvider({ runner, stateFile });
    const running = await recovered.ensure({ conversationId: 'C', projectId: 'P' });
    await recovered.start(running);
    expect(commands.filter((argv) => argv[1] === 'start')).toHaveLength(1);
    machines.clear();
    const rebooted = new NspawnOrbProvider({ runner, stateFile });
    await rebooted.start(await rebooted.ensure({ conversationId: 'C', projectId: 'P' }));
    expect(commands.filter((argv) => argv[1] === 'start')).toHaveLength(2);
    expect(commands.filter((argv) => argv[1] === 'clone')).toHaveLength(1);
  });

  test('failed start retries without cloning twice', async () => {
    const { runner, commands } = fixture();
    let fail = true;
    const provider = new NspawnOrbProvider({
      runner: async (argv, options) => {
        if (argv[1] === 'start' && fail) {
          fail = false;
          throw new Error('start failed');
        }
        return runner(argv, options);
      },
    });
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await expect(provider.start(handle)).rejects.toThrow('start failed');
    await provider.start(handle);
    expect(commands.filter((argv) => argv[1] === 'clone')).toHaveLength(1);
  });

  test('host exec strips the orb marker', async () => {
    const runner = vi.fn<OrbCommandRunner>(async () => ({ code: 0, stdout: '', stderr: '' }));
    const host = new HostOrbProvider(runner);
    await host.exec(await host.ensure({ conversationId: 'C', projectId: 'P' }), ['env'], {
      env: { CAIRN_ORB: '1', SAMPLE: 'host' },
    });
    expect(runner.mock.calls[0]![1]!.env?.CAIRN_ORB).toBeUndefined();
    expect(runner.mock.calls[0]![1]!.env?.SAMPLE).toBe('host');
  });

  test('destroy waits for poweroff and list before removing the image', async () => {
    const { provider, commands } = fixture();
    const handle = await provider.ensure({ conversationId: 'A', projectId: 'P' });
    await provider.start(handle);
    await provider.destroy(handle);
    expect(commands.slice(-3).map((argv) => argv[1])).toEqual(['poweroff', 'list', 'remove']);
    expect(await provider.list()).toEqual([]);
  });

  test('poweroff timeout terminates only its machine and verifies shutdown', async () => {
    const { runner, stateFile, commands, machines } = fixture();
    const provider = new NspawnOrbProvider({
      stateFile,
      shutdownTimeoutMs: 0,
      runner: async (argv, options) => {
        if (argv[1] === 'poweroff') {
          commands.push([...argv]);
          return { code: 0, stdout: '', stderr: '' };
        }
        return runner(argv, options);
      },
    });
    const handle = await provider.ensure({ conversationId: 'A', projectId: 'P' });
    await provider.start(handle);
    machines.add('unrelated');
    await provider.stop(handle);
    expect(commands.slice(-4).map((argv) => argv[1])).toEqual([
      'poweroff',
      'list',
      'terminate',
      'list',
    ]);
    expect(machines).toEqual(new Set(['unrelated']));
    expect(handle.running).toBe(false);
  });

  test('rejects persisted machine names outside its namespace before running commands', () => {
    const { runner, stateFile, commands } = fixture();
    writeFileSync(stateFile, JSON.stringify([{ id: 'unrelated', conversationId: 'A' }]));
    expect(() => new NspawnOrbProvider({ runner, stateFile })).toThrow('Invalid orb machine name');
    expect(commands).toEqual([]);
  });
});

test('lifecycle caps, serializes Threads, evicts idle machines and protects pending recovery', async () => {
  const { provider, commands } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  const releases: (() => void)[] = [];
  const runs = ['A', 'B', 'C'].map((conversationId) =>
    lifecycle.run({ conversationId, projectId: 'P' }, async (handle) => {
      await provider.start(handle);
      await new Promise<void>((resolve) => releases.push(resolve));
    }),
  );
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  releases[0]!();
  await vi.waitFor(() => expect(releases).toHaveLength(3));
  releases[1]!();
  releases[2]!();
  await Promise.all(runs);
  expect((await provider.list()).filter((handle) => handle.running)).toHaveLength(2);
  expect(commands.some((argv) => argv[1] === 'poweroff')).toBe(true);
  await lifecycle.sweep({ activeConversationIds: ['A'], now: Date.now() + 73 * 60 * 60_000 });
  expect((await provider.list()).map((handle) => handle.conversationId)).toEqual(['A']);
  expect(resolveOrbCap({ CAIRN_ORB_MAX: '4' }, 1)).toBe(1);
  expect(resolveOrbCap({}, 4)).toBe(2);
});

test('same-Thread lifecycle runs serialize and active steps cannot be swept', async () => {
  const { provider, commands } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  let release: () => void = () => {};
  let starts = 0;
  const first = lifecycle.run({ conversationId: 'A', projectId: 'P' }, async (handle) => {
    await provider.start(handle);
    starts++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const second = lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {
    starts++;
  });
  await vi.waitFor(() => expect(starts).toBe(1));
  await lifecycle.sweep({
    activeConversationIds: [],
    closedConversationIds: ['A'],
    now: Date.now() + 80 * 60 * 60_000,
  });
  expect(starts).toBe(1);
  expect(commands.some((argv) => argv[1] === 'poweroff')).toBe(false);
  release();
  await Promise.all([first, second]);
  expect(starts).toBe(2);
});

test('idle poweroff and image removal retain their twenty-minute and seventy-two-hour thresholds', async () => {
  const { provider } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  const handle = await provider.ensure({ conversationId: 'A', projectId: 'P' });
  await provider.start(handle);
  const used = handle.lastUsedAt;
  await lifecycle.sweep({ activeConversationIds: [], now: used + 20 * 60_000 - 1 });
  expect(handle.running).toBe(true);
  await lifecycle.sweep({ activeConversationIds: [], now: used + 20 * 60_000 });
  expect(handle.running).toBe(false);
  await lifecycle.sweep({ activeConversationIds: [], now: used + 72 * 60 * 60_000 - 1 });
  expect(await provider.list()).toHaveLength(1);
  await lifecycle.sweep({ activeConversationIds: [], now: used + 72 * 60 * 60_000 });
  expect(await provider.list()).toEqual([]);
});

test('a Thread named base never aliases the base image', async () => {
  const { provider, commands } = fixture();
  const handle = await provider.ensure({ conversationId: 'base', projectId: 'P' });
  expect(handle.id).not.toBe('cairn-orb-base');
  expect(commands[0]![3]).toBe(handle.id);
});

test('a cached running handle is restarted when the machine has powered off externally', async () => {
  const { provider, machines, commands } = fixture();
  const handle = await provider.ensure({ conversationId: 'A', projectId: 'P' });
  await provider.start(handle);
  machines.clear();
  await provider.start(handle);
  expect(commands.filter((argv) => argv[1] === 'start')).toHaveLength(2);
  expect(commands.filter((argv) => argv[1] === 'clone')).toHaveLength(1);
});

test('a pending machine start reserves capacity before another Thread evicts idle machines', async () => {
  const { runner } = fixture();
  let release: () => void = () => {};
  let starting = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = new NspawnOrbProvider({
    runner: async (argv, options) => {
      if (argv[1] === 'start' && argv[2] === 'cairn-orb-A') {
        starting = true;
        await gate;
      }
      return runner(argv, options);
    },
  });
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  for (const conversationId of ['idle-I', 'idle-J'])
    await lifecycle.run({ conversationId, projectId: 'P' }, (handle) => provider.start(handle));
  const first = lifecycle.run({ conversationId: 'A', projectId: 'P' }, (handle) =>
    provider.start(handle),
  );
  try {
    await vi.waitFor(() => expect(starting).toBe(true));
    await lifecycle.run({ conversationId: 'B', projectId: 'P' }, (handle) =>
      provider.start(handle),
    );
  } finally {
    release();
    await first;
  }
  expect((await provider.list()).filter((handle) => handle.running)).toHaveLength(2);
});
