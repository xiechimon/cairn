import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  COMPUTER_IDLE_STOP_MS,
  COMPUTER_TAKEOVER_GRACE_MS,
  ComputerOrbs,
  computerMachineName,
} from '../src/orb/computer.js';
import { NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { rejectGuestExec } from './orb-fake.js';

function fixture(options: { busy?: Set<string>; failClone?: boolean; noRuntime?: boolean } = {}) {
  const runtimeRoot = mkdtempSync(join(tmpdir(), 'orb-computer-run-'));
  const stateFile = join(mkdtempSync(join(tmpdir(), 'orb-computer-state-')), 'computers.json');
  const commands: string[][] = [];
  const images = new Set<string>(['cairn-orb-base', 'cairn-orb-computer']);
  const machines = new Set<string>();
  const runner: OrbCommandRunner = async (argv) => {
    rejectGuestExec(argv);
    commands.push([...argv]);
    const [, verb, name] = argv;
    if (verb === 'clone') {
      if (options.failClone) return { code: 1, stdout: '', stderr: 'clone failed' };
      images.add(argv[3] ?? '');
    }
    if (verb === 'start') {
      if (!options.noRuntime)
        mkdirSync(join(runtimeRoot, name ?? ''), { recursive: true, mode: 0o700 });
      machines.add(name ?? '');
    }
    if (verb === 'poweroff' || verb === 'terminate') machines.delete(name ?? '');
    const stdout =
      verb === 'list'
        ? [...machines].join('\n')
        : verb === 'list-images'
          ? [...images].map((i) => `${i} btrfs no`).join('\n')
          : '';
    return { code: 0, stdout, stderr: '' };
  };
  let now = 1_000_000;
  const computers = new ComputerOrbs({
    runner,
    runtimeRoot,
    stateFile,
    runtimeDirectoryTimeoutMs: 50,
    now: () => now,
    isBusy: async (name) => options.busy?.has(name) ?? false,
  });
  return {
    computers,
    commands,
    machines,
    images,
    stateFile,
    runner,
    runtimeRoot,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('computer machine names', () => {
  test('a scope always maps to the same valid computer name, never the template or a worker name', () => {
    const name = computerMachineName('chief:chief-1');
    expect(name).toBe(computerMachineName('chief:chief-1'));
    expect(name).toMatch(/^cairn-orb-computer-[a-f0-9]{40}$/);
    expect(computerMachineName('chief:chief-2')).not.toBe(name);
    expect(() => computerMachineName('')).toThrow();
  });

  test('worker Orbs never take a computer name, even for a conversation called computer-*', async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'orb-worker-run-'));
    const runner: OrbCommandRunner = async () => ({ code: 0, stdout: '', stderr: '' });
    const provider = new NspawnOrbProvider({ runner, runtimeRoot });
    for (const conversationId of ['computer-abc', 'computer', 'Computer-x']) {
      const handle = await provider.ensure({ conversationId, projectId: 'P' });
      expect(handle.id.toLowerCase().startsWith('cairn-orb-computer')).toBe(false);
    }
  });
});

describe('computer Orbs', () => {
  test('ensure clones the template once, starts it and waits for its runtime directory', async () => {
    const { computers, commands } = fixture();
    const [first, again] = await Promise.all([
      computers.ensure('chief:c1'),
      computers.ensure('chief:c1'),
    ]);
    expect(first).toBe(again);
    const name = computerMachineName('chief:c1');
    expect(commands.filter((c) => c[1] === 'clone')).toEqual([
      ['machinectl', 'clone', 'cairn-orb-computer', name],
    ]);
    expect(commands.filter((c) => c[1] === 'start')).toEqual([['machinectl', 'start', name]]);
    await computers.ensure('chief:c1');
    expect(commands.filter((c) => c[1] === 'clone' || c[1] === 'start')).toHaveLength(2);
  });

  test('an existing stopped computer is started again without cloning, so its home survives', async () => {
    const { computers, commands, machines, images } = fixture();
    const name = computerMachineName('chief:c1');
    images.add(name);
    await computers.ensure('chief:c1');
    machines.clear();
    await computers.ensure('chief:c1');
    expect(commands.filter((c) => c[1] === 'clone')).toEqual([]);
    expect(commands.filter((c) => c[1] === 'start')).toHaveLength(2);
  });

  test('a failed clone is reported and nothing is recorded or started', async () => {
    const { computers, commands, stateFile } = fixture({ failClone: true });
    await expect(computers.ensure('chief:c1')).rejects.toThrow(/clone failed/);
    expect(commands.some((c) => c[1] === 'start')).toBe(false);
    expect(() => readFileSync(stateFile, 'utf8')).toThrow();
  });

  test('a computer whose runtime never appears is stopped and the error surfaces', async () => {
    const { computers, machines } = fixture({ noRuntime: true });
    await expect(computers.ensure('chief:c1')).rejects.toThrow(/runtime directory/);
    expect(machines.size).toBe(0);
  });

  test('idle computers stop after ten minutes unless busy or held for a takeover, and are never removed', async () => {
    const busy = new Set<string>();
    const { computers, machines, commands, advance } = fixture({ busy });
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS - 1);
    await computers.sweep();
    expect(machines.has(name)).toBe(true);
    busy.add(name);
    advance(2);
    await computers.sweep();
    expect(machines.has(name)).toBe(true);
    busy.delete(name);
    computers.hold('chief:c1');
    advance(COMPUTER_TAKEOVER_GRACE_MS - 1);
    await computers.sweep();
    expect(machines.has(name)).toBe(true);
    advance(2);
    await computers.sweep();
    expect(machines.has(name)).toBe(false);
    expect(commands.some((c) => c[1] === 'remove')).toBe(false);
  });

  test('use resets the idle clock and state survives a daemon restart', async () => {
    const { computers, machines, advance, runner, runtimeRoot, stateFile } = fixture();
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS - 10);
    computers.touch('chief:c1');
    advance(20);
    await computers.sweep();
    expect(machines.has(name)).toBe(true);
    const restarted = new ComputerOrbs({ runner, runtimeRoot, stateFile, now: () => 0 });
    expect(restarted.known()).toEqual([name]);
  });
});
