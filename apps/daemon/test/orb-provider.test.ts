import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { OrbLifecycle, resolveOrbCap } from '../src/orb/lifecycle.js';
import { HostOrbProvider, NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';

function fixture() {
  const commands: { argv: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
  const runner: OrbCommandRunner = async (argv, options) => {
    commands.push({ argv, env: options?.env });
    return { code: 0, stdout: '', stderr: '' };
  };
  const stateFile = join(mkdtempSync(join(tmpdir(), 'cairn-orbs-')), 'state.json');
  const provider = new NspawnOrbProvider({ runner, stateFile });
  return { commands, runner, provider, stateFile };
}

afterEach(() => vi.useRealTimers());

describe('OrbProvider', () => {
  test('clones once per conversation, serializes concurrent ensure and bounds unique names', async () => {
    const { provider, commands } = fixture();
    const [first, again] = await Promise.all([
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
      provider.ensure({ conversationId: 'C', projectId: 'P' }),
    ]);
    expect(commands.map((c) => c.argv)).toEqual([
      ['machinectl', 'clone', 'cairn-orb-base', 'cairn-orb-C'],
      ['machinectl', 'start', 'cairn-orb-C'],
    ]);
    expect(again.id).toBe(first.id);
    const other = await provider.ensure({ conversationId: 'D', projectId: 'P' });
    expect(other.id).not.toBe(first.id);
    const long = await provider.ensure({ conversationId: 'a'.repeat(150), projectId: 'P' });
    const collision = await provider.ensure({
      conversationId: `${'a'.repeat(149)}b`,
      projectId: 'P',
    });
    expect(long.id.length).toBeLessThanOrEqual(64);
    expect(collision.id).not.toBe(long.id);
  });

  test('recovers state across provider restart and restarts a stopped container without cloning', async () => {
    const { provider, commands, runner, stateFile } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await provider.stop(handle);
    const restarted = new NspawnOrbProvider({ runner, stateFile });
    await restarted.ensure({ conversationId: 'C', projectId: 'P' });
    expect(commands.map((c) => c.argv[1])).toEqual(['clone', 'start', 'poweroff', 'stop', 'start']);
    expect(await restarted.list()).toHaveLength(1);
  });

  test('exec binds paths and runs as agent with CAIRN_ORB, host exec strips the marker', async () => {
    const { provider, commands, runner } = fixture();
    const handle = await provider.ensure({ conversationId: 'C', projectId: 'P' });
    await provider.exec(handle, ['printenv', 'CAIRN_ORB'], {
      env: { SAMPLE: 'value' },
      binds: [{ source: '/work', target: '/work' }],
    });
    expect(commands.at(-2)?.argv).toEqual([
      'machinectl',
      'bind',
      '--mkdir',
      'cairn-orb-C',
      '/work',
      '/work',
    ]);
    expect(commands.at(-1)?.argv).toEqual([
      'systemd-run',
      '-M',
      handle.id,
      '--uid=agent',
      '--wait',
      '--pipe',
      '--quiet',
      '--setenv=SAMPLE=value',
      '--setenv=CAIRN_ORB=1',
      '--',
      'printenv',
      'CAIRN_ORB',
    ]);
    const host = new HostOrbProvider(runner);
    await host.exec(await host.ensure({ conversationId: 'C', projectId: 'P' }), ['env'], {
      env: { CAIRN_ORB: '1', SAMPLE: 'host' },
    });
    expect(commands.at(-1)?.env?.CAIRN_ORB).toBeUndefined();
    expect(commands.at(-1)?.env?.SAMPLE).toBe('host');
  });

  test('a failed start retries without cloning the image twice', async () => {
    const { runner, stateFile, commands } = fixture();
    let fail = true;
    const provider = new NspawnOrbProvider({
      stateFile,
      runner: async (argv, opts) => {
        const result = await runner(argv, opts);
        if (argv[1] === 'start' && fail) {
          fail = false;
          return { ...result, code: 1 };
        }
        return result;
      },
    });
    await expect(provider.ensure({ conversationId: 'C', projectId: 'P' })).rejects.toThrow();
    await provider.ensure({ conversationId: 'C', projectId: 'P' });
    expect(commands.filter((c) => c.argv[1] === 'clone')).toHaveLength(1);
  });
});

describe('Orb lifecycle', () => {
  test('three claimed steps wait for two slots, then start without a capacity error', async () => {
    const { provider } = fixture();
    const ensure = vi.spyOn(provider, 'ensure');
    const lifecycle = new OrbLifecycle(provider, { max: resolveOrbCap({ CAIRN_ORB_MAX: '2' }, 4) });
    const releases: (() => void)[] = [];
    const runs = ['A', 'B', 'C'].map((conversationId) =>
      lifecycle.run(
        { conversationId, projectId: 'P' },
        async () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(ensure).toHaveBeenCalledTimes(2);
    releases[0]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(ensure).toHaveBeenCalledTimes(3);
    releases[1]?.();
    releases[2]?.();
    await expect(Promise.all(runs)).resolves.toEqual([undefined, undefined, undefined]);
    expect(resolveOrbCap({ CAIRN_ORB_MAX: '4' }, 1)).toBe(1);
    expect(resolveOrbCap({}, 4)).toBe(2);
  });

  test('idle threshold, active protection, pending journal protection and closed builds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { provider, commands } = fixture();
    const lifecycle = new OrbLifecycle(provider, { max: 2 });
    await lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {});
    vi.setSystemTime(19 * 60_000 + 59_000);
    await lifecycle.sweep({ activeConversationIds: [] });
    expect(commands.some((c) => c.argv[1] === 'poweroff')).toBe(false);
    vi.setSystemTime(20 * 60_000 + 1_000);
    await lifecycle.sweep({ activeConversationIds: [] });
    expect(commands.at(-2)?.argv).toEqual(['machinectl', 'poweroff', 'cairn-orb-A']);
    vi.setSystemTime(73 * 60 * 60_000);
    await lifecycle.sweep({ activeConversationIds: ['A'], closedConversationIds: ['A'] });
    expect(await provider.list()).toHaveLength(1);
    await lifecycle.sweep({ activeConversationIds: [], closedConversationIds: ['A'] });
    expect(commands.at(-1)?.argv).toEqual(['machinectl', 'remove', 'cairn-orb-A']);
    expect(await provider.list()).toEqual([]);
  });

  test('sweep cannot stop an executing step and releases capacity after a failure', async () => {
    const { provider, commands } = fixture();
    const lifecycle = new OrbLifecycle(provider, { max: 1, idleStopMs: 1 });
    let release: () => void = () => {};
    const running = lifecycle.run(
      { conversationId: 'A', projectId: 'P' },
      async () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    await vi.waitFor(() => expect(provider.list()).resolves.toHaveLength(1));
    await lifecycle.sweep({
      activeConversationIds: [],
      closedConversationIds: ['A'],
      now: Date.now() + 80 * 60 * 60_000,
    });
    expect(commands.some((c) => c.argv[1] === 'poweroff')).toBe(false);
    release();
    await running;
    await expect(
      lifecycle.run({ conversationId: 'B', projectId: 'P' }, async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await expect(
      lifecycle.run({ conversationId: 'C', projectId: 'P' }, async () => 'ok'),
    ).resolves.toBe('ok');
  });
});

test('a free step slot stops an idle orb before starting a third container', async () => {
  const { provider, commands } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  await lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {});
  await lifecycle.run({ conversationId: 'B', projectId: 'P' }, async () => {});
  await lifecycle.run({ conversationId: 'C', projectId: 'P' }, async () => {});
  expect((await provider.list()).filter((handle) => handle.running)).toHaveLength(2);
  expect(commands.findIndex((command) => command.argv[1] === 'poweroff')).toBeLessThan(
    commands.findIndex(
      (command) => command.argv[1] === 'clone' && command.argv[3] === 'cairn-orb-C',
    ),
  );
});

test('steps for the same conversation serialize even when two slots are available', async () => {
  const { provider } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  let release: () => void = () => {};
  let starts = 0;
  const first = lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {
    starts += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const second = lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {
    starts += 1;
  });
  await vi.waitFor(() => expect(starts).toBeGreaterThan(0));
  expect(starts).toBe(1);
  release();
  await Promise.all([first, second]);
  expect(starts).toBe(2);
});

test('idle removal uses 72 hours and a pending journal protects the container across restart', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const { provider, stateFile, runner } = fixture();
  const lifecycle = new OrbLifecycle(provider, { max: 2 });
  await lifecycle.run({ conversationId: 'A', projectId: 'P' }, async () => {});
  vi.setSystemTime(72 * 60 * 60_000 - 1);
  await lifecycle.sweep({ activeConversationIds: [] });
  expect(await provider.list()).toHaveLength(1);
  vi.setSystemTime(72 * 60 * 60_000 + 1);
  const restarted = new NspawnOrbProvider({ stateFile, runner });
  const recovered = new OrbLifecycle(restarted, { max: 2 });
  await recovered.sweep({ activeConversationIds: ['A'] });
  expect(await restarted.list()).toHaveLength(1);
  await recovered.sweep({ activeConversationIds: [] });
  expect(await restarted.list()).toHaveLength(0);
});

test('destroy waits for the container service to stop before removing its image', async () => {
  const { provider, commands } = fixture();
  const handle = await provider.ensure({ conversationId: 'A', projectId: 'P' });
  await provider.destroy(handle);
  expect(commands.slice(-3).map((command) => command.argv)).toEqual([
    ['machinectl', 'poweroff', handle.id],
    ['systemctl', 'stop', `systemd-nspawn@${handle.id}.service`],
    ['machinectl', 'remove', handle.id],
  ]);
});
