import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
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

function fakeSystemd(display: string) {
  const calls: string[][] = [];
  const active = new Set<string>();
  const run: CommandRunner = async (argv) => {
    calls.push([...argv]);
    if (argv[0] === 'systemd-run') {
      const unit = argv.find((arg) => arg.startsWith('--unit='))?.slice('--unit='.length) ?? '';
      const directory = argv.at(-2) as string;
      await listen(join(directory, 'computer', 'view.sock'));
      await listen(join(directory, 'computer', 'vnc.sock'));
      writeFileSync(join(directory, 'display'), `${display}\n`);
      active.add(unit);
      return { code: 0, stdout: '' };
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
        providerRef: expect.stringMatching(/^cairn-desktop-[a-f0-9]{16}\.service$/),
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
});
