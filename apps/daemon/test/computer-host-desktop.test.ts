import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  type CommandRunner,
  HOST_DESKTOP_PROGRAMS,
  HostDesktops,
} from '../src/computer/host-desktop.js';
import { ComputerRefusal } from '../src/computer/provider.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function workspace(programs: readonly string[]) {
  const root = makeTestTempDir('host-desktop-');
  cleanups.push(() => releaseTestTempDir(root));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const name of programs) {
    writeFileSync(join(bin, name), '#!/bin/sh\n');
    chmodSync(join(bin, name), 0o755);
  }
  return { root, env: { PATH: bin } };
}

function listen(path: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer().listen(path, () => resolve(server));
    cleanups.push(() => server.close());
  });
}

function fakeSystemd(display: string, onStop: () => void = () => {}) {
  const calls: string[][] = [];
  const active = new Set<string>();
  const servers = new Map<string, Server[]>();
  const run: CommandRunner = async (argv) => {
    calls.push([...argv]);
    if (argv[0] === 'systemd-run') {
      const unit = argv.find((arg) => arg.startsWith('--unit='))?.slice('--unit='.length) ?? '';
      const directory = argv.at(-2) as string;
      for (const server of servers.get(directory) ?? []) server.close();
      for (const name of ['view.sock', 'vnc.sock'])
        rmSync(join(directory, 'computer', name), { force: true });
      servers.set(directory, [
        await listen(join(directory, 'computer', 'view.sock')),
        await listen(join(directory, 'computer', 'vnc.sock')),
      ]);
      writeFileSync(join(directory, 'display'), `${display}\n`);
      active.add(unit);
      return { code: 0, stdout: '' };
    }
    if (argv[0] === 'systemctl' && argv[2] === 'stop' && active.has(argv[3] as string)) {
      onStop();
      active.delete(argv[3] as string);
    }
    if (argv[0] === 'systemctl' && argv[2] === 'is-active') {
      const units = argv.slice(3);
      return {
        code: units.every((unit) => active.has(unit)) ? 0 : 3,
        stdout: units.map((unit) => (active.has(unit) ? 'active' : 'inactive')).join('\n'),
      };
    }
    return { code: 0, stdout: '' };
  };
  return { calls, active, run };
}

const PROGRAMS = [...HOST_DESKTOP_PROGRAMS];

describe('HostDesktops', () => {
  test('a missing program refuses before any unit starts and names the program', async () => {
    const { root, env } = workspace(PROGRAMS.filter((name) => name !== 'x11vnc'));
    const systemd = fakeSystemd('90');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    const error = await desktops.ensure('chief:a').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ComputerRefusal);
    expect((error as Error).message).toContain('x11vnc');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(0);
    expect(await desktops.presence()).toEqual([]);
  });

  test('a scope gets its own desktop, reused while its unit stays active', async () => {
    const { root, env } = workspace(PROGRAMS);
    const systemd = fakeSystemd('93');
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    expect(await desktops.ensure('chief:a')).toBe(':93');
    const view = desktops.socketPath('chief:a', 'view');
    expect(view.endsWith('/computer/view.sock')).toBe(true);
    expect(desktops.socketPath('chief:b', 'view')).not.toBe(view);
    expect(desktops.socketPath('chief:a', 'control')).toBe(view.replace('view.sock', 'vnc.sock'));

    const started = systemd.calls.find((argv) => argv[0] === 'systemd-run') ?? [];
    for (const name of [
      'HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'XDG_STATE_HOME',
    ]) {
      const value = started.find((arg) => arg.startsWith(`--setenv=${name}=`));
      expect(value?.slice(`--setenv=${name}=`.length).startsWith(`${root}/`)).toBe(true);
    }

    const again = new HostDesktops({ root, toolsRoot: root, env, run: systemd.run });
    expect(await again.ensure('chief:a')).toBe(':93');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(1);

    expect(await again.presence()).toEqual([
      {
        scopeKey: 'chief:a',
        providerRef: `cairn-orb-computer-${createHash('sha256').update('chief:a').digest('hex').slice(0, 40)}`,
        state: 'running',
      },
    ]);
    systemd.active.clear();
    expect((await again.presence())[0]?.state).toBe('stopped');
  });

  test('a desktop that never becomes ready is stopped and reported failed', async () => {
    const { root, env } = workspace(PROGRAMS);
    const calls: string[][] = [];
    const run: CommandRunner = async (argv) => {
      calls.push([...argv]);
      return { code: argv[0] === 'systemd-run' ? 0 : 3, stdout: 'inactive' };
    };
    const desktops = new HostDesktops({ root, toolsRoot: root, env, run, readyMs: 50 });
    await expect(desktops.ensure('chief:a')).rejects.toThrow('did not become ready');
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['systemctl', '--user', 'stop']);
    expect((await desktops.presence())[0]?.state).toBe('failed');
  });

  test('an idle desktop saves the browser login, stops, and starts again on the next call', async () => {
    const { root, env } = workspace(PROGRAMS);
    const log = join(root, 'agent-browser.log');
    writeFileSync(
      join(env.PATH, 'agent-browser'),
      `#!/bin/sh\nsleep 0.3\necho "$HOME $*" >> '${log}'\n`,
    );
    chmodSync(join(env.PATH, 'agent-browser'), 0o755);
    const closedBeforeStop: boolean[] = [];
    const systemd = fakeSystemd('94', () => closedBeforeStop.push(existsSync(log)));
    let now = 0;
    const desktops = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => now,
      idleStopMs: 1_000,
    });
    await desktops.forScope('chief:a').writeFile('note.txt', 'x');
    now = 999;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);

    const release = await desktops.hold('chief:a');
    now = 5_000;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);
    release();
    now = 5_999;
    await desktops.sweep();
    expect(systemd.active.size).toBe(1);

    now = 6_000;
    await desktops.sweep();
    expect(systemd.active.size).toBe(0);
    expect(closedBeforeStop).toEqual([true]);
    const [line] = readFileSync(log, 'utf8').trim().split('\n');
    expect(line).toMatch(
      new RegExp(`^${root}/[0-9a-f]{16}/home --session chief_a --restore close$`),
    );
    expect((await desktops.presence())[0]?.state).toBe('stopped');

    expect(await desktops.forScope('chief:a').readFile('note.txt')).toBe('x');
    expect(systemd.calls.filter((argv) => argv[0] === 'systemd-run')).toHaveLength(2);
    expect(systemd.active.size).toBe(1);
  });

  test('a desktop an earlier daemon left running is stopped once idle', async () => {
    const { root, env } = workspace(PROGRAMS);
    const systemd = fakeSystemd('95');
    await new HostDesktops({ root, toolsRoot: root, env, run: systemd.run }).ensure('chief:a');
    let now = 0;
    const later = new HostDesktops({
      root,
      toolsRoot: root,
      env,
      run: systemd.run,
      now: () => now,
      idleStopMs: 1_000,
    });
    await later.sweep();
    expect(systemd.active.size).toBe(1);
    now = 1_000;
    await later.sweep();
    expect(systemd.active.size).toBe(0);
  });
});
