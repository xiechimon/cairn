import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  COMPUTER_IDLE_STOP_MS,
  COMPUTER_TAKEOVER_GRACE_MS,
  ComputerOrbs,
  computerImageOffersBrowser,
  computerMachineName,
  PINNED_AGENT_BROWSER_VERSION,
} from '../src/orb/computer.js';
import { NspawnOrbProvider, type OrbCommandRunner } from '../src/orb/provider.js';
import { rejectGuestExec } from './orb-fake.js';
import { testTempDir } from './test-temp-dir.js';

const PINNED_MARKER = `recipe=abc\npackages=chromium\nagent-browser=${PINNED_AGENT_BROWSER_VERSION}\n`;

function fixture(
  options: {
    busy?: Set<string>;
    failClone?: boolean;
    noRuntime?: boolean;
    slowShutdownLists?: number;
    busyProbe?: () => Promise<boolean>;
  } = {},
) {
  const stopping = new Map<string, number>();
  const runtimeRoot = testTempDir('orb-computer-run-');
  const imageMarkerPath = join(testTempDir('orb-computer-marker-'), 'computer-image');
  const stateFile = join(testTempDir('orb-computer-state-'), 'computers.json');
  const commands: string[][] = [];
  const images = new Set<string>(['cairn-orb-base', 'cairn-orb-computer']);
  const machines = new Set<string>();
  writeFileSync(imageMarkerPath, PINNED_MARKER);
  const runner: OrbCommandRunner = async (argv) => {
    rejectGuestExec(argv);
    commands.push([...argv]);
    const [, verb, name] = argv;
    if (verb === 'clone') {
      if (options.failClone) return { code: 1, stdout: '', stderr: 'clone failed' };
      const target = argv[3] ?? '';
      images.add(target);
    }
    if (verb === 'remove') {
      images.delete(name ?? '');
    }
    if (verb === 'start') {
      if (!options.noRuntime)
        mkdirSync(join(runtimeRoot, name ?? ''), { recursive: true, mode: 0o700 });
      machines.add(name ?? '');
    }
    if (verb === 'poweroff') {
      if (options.slowShutdownLists) stopping.set(name ?? '', options.slowShutdownLists);
      else machines.delete(name ?? '');
    }
    if (verb === 'terminate') {
      stopping.delete(name ?? '');
      machines.delete(name ?? '');
    }
    if (verb === 'list') {
      for (const [machine, left] of stopping) {
        if (left <= 1) {
          stopping.delete(machine);
          machines.delete(machine);
        } else stopping.set(machine, left - 1);
      }
    }
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
    imageMarkerPath,
    stateFile,
    runtimeDirectoryTimeoutMs: 50,
    now: () => now,
    shutdownTimeoutMs: 200,
    isBusy: options.busyProbe ?? (async (name) => options.busy?.has(name) ?? false),
  });
  return {
    computers,
    commands,
    machines,
    images,
    imageMarkerPath,
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
    const runtimeRoot = testTempDir('orb-worker-run-');
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
    const { computers, commands, machines } = fixture();
    await computers.ensure('chief:c1');
    machines.clear();
    await computers.ensure('chief:c1');
    expect(commands.filter((c) => c[1] === 'clone')).toHaveLength(1);
    expect(commands.filter((c) => c[1] === 'start')).toHaveLength(2);
  });

  test('a clone made from an older template marker is removed and recloned before start', async () => {
    const { computers, commands, machines, imageMarkerPath } = fixture();
    const name = computerMachineName('chief:c1');
    writeFileSync(imageMarkerPath, 'recipe=old\npackages=chromium\n');
    await computers.ensure('chief:c1');
    writeFileSync(imageMarkerPath, PINNED_MARKER);
    await computers.ensure('chief:c1');
    expect(machines.has(name)).toBe(true);
    expect(commands.filter((c) => c[1] === 'remove')).toEqual([['machinectl', 'remove', name]]);
    expect(commands.filter((c) => c[1] === 'clone')).toEqual([
      ['machinectl', 'clone', 'cairn-orb-computer', name],
      ['machinectl', 'clone', 'cairn-orb-computer', name],
    ]);
  });

  test('a clone the daemon never recorded a marker for is recloned once, then kept', async () => {
    const { computers, commands, images, machines } = fixture();
    const name = computerMachineName('chief:c1');
    images.add(name);
    machines.add(name);
    await computers.ensure('chief:c1');
    machines.clear();
    await computers.ensure('chief:c1');
    expect(commands.filter((c) => c[1] === 'remove')).toEqual([['machinectl', 'remove', name]]);
    expect(commands.filter((c) => c[1] === 'clone')).toHaveLength(1);
  });

  test('the recorded marker survives a daemon restart, so a current clone is not recloned', async () => {
    const first = fixture();
    await first.computers.ensure('chief:c1');
    const restarted = new ComputerOrbs({
      runner: first.runner,
      runtimeRoot: first.runtimeRoot,
      imageMarkerPath: first.imageMarkerPath,
      stateFile: first.stateFile,
      runtimeDirectoryTimeoutMs: 50,
    });
    await restarted.ensure('chief:c1');
    expect(first.commands.filter((c) => c[1] === 'clone')).toHaveLength(1);
  });

  test('without a readable template marker an existing clone is kept', async () => {
    const { computers, commands, images, imageMarkerPath } = fixture();
    rmSync(imageMarkerPath);
    images.add(computerMachineName('chief:c1'));
    await computers.ensure('chief:c1');
    expect(commands.filter((c) => c[1] === 'remove' || c[1] === 'clone')).toEqual([]);
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

  test('poweroff gets time to shut down cleanly before terminate is used', async () => {
    const { computers, machines, commands, advance } = fixture({ slowShutdownLists: 3 });
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS + 1);
    await computers.sweep();
    expect(machines.has(name)).toBe(false);
    expect(commands.some((c) => c[1] === 'terminate')).toBe(false);
  });

  test('a computer that ignores poweroff is terminated after the shutdown timeout', async () => {
    const { computers, machines, commands, advance } = fixture({ slowShutdownLists: 10_000 });
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS + 1);
    await computers.sweep();
    expect(commands.some((c) => c[1] === 'terminate')).toBe(true);
    expect(machines.has(name)).toBe(false);
  });

  test('a computer used while the sweep waits on the busy probe is not stopped', async () => {
    let releaseBusy: (busy: boolean) => void = () => {};
    const busyProbe = new Promise<boolean>((resolve) => {
      releaseBusy = resolve;
    });
    const { computers, machines, advance } = fixture({ busyProbe: () => busyProbe });
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS + 1);
    const sweeping = computers.sweep();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await computers.ensure('chief:c1');
    releaseBusy(false);
    await sweeping;
    expect(machines.has(name)).toBe(true);
  });

  test('ensure during a stop waits for it and then starts the computer again', async () => {
    const { computers, machines, advance } = fixture({ slowShutdownLists: 3 });
    const name = computerMachineName('chief:c1');
    await computers.ensure('chief:c1');
    advance(COMPUTER_IDLE_STOP_MS + 1);
    const sweeping = computers.sweep();
    const ensuring = computers.ensure('chief:c1');
    await Promise.all([sweeping, ensuring]);
    expect(machines.has(name)).toBe(true);
  });
});

describe('computerImageOffersBrowser', () => {
  test('false when the computer image marker is missing', () => {
    const root = testTempDir('orb-browser-marker-');
    expect(computerImageOffersBrowser({ root })).toBe(false);
  });

  test('false when the marker has no pinned agent-browser line', () => {
    const root = testTempDir('orb-browser-marker-');
    const dir = join(root, 'var/lib/cairn-orb');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'computer-image'), 'recipe=abc\npackages=chromium\n');
    expect(computerImageOffersBrowser({ root })).toBe(false);
  });

  test('a marker only inside the root-only machines directory does not count', () => {
    const root = testTempDir('orb-browser-marker-');
    const dir = join(root, 'var/lib/machines/cairn-orb-computer/etc');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'cairn-orb-computer-image'),
      `recipe=abc\npackages=chromium\nagent-browser=${PINNED_AGENT_BROWSER_VERSION}\n`,
    );
    expect(computerImageOffersBrowser({ root })).toBe(false);
  });

  test('true only when the published marker pins the expected agent-browser version', () => {
    const root = testTempDir('orb-browser-marker-');
    const dir = join(root, 'var/lib/cairn-orb');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'computer-image'),
      `recipe=abc\npackages=chromium\nagent-browser=${PINNED_AGENT_BROWSER_VERSION}\n`,
    );
    expect(computerImageOffersBrowser({ root })).toBe(true);
    expect(computerImageOffersBrowser({ root, version: '9.9.9' })).toBe(false);
  });
});
