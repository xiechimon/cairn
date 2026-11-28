import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createHostRestarter,
  type ReplacementTarget,
  startReplacement,
} from '../src/host-restart.js';
import { relaunchWindowAtRoot } from '../src/relaunch-window.js';

function fakeExecutable(root: string): { executable: string; record: string } {
  const executable = join(root, 'Cairn');
  const record = join(root, 'launched.txt');
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`);
  chmodSync(executable, 0o755);
  return { executable, record };
}

function sleepingProcess(): { pid: number; stop: () => Promise<void> } {
  const child = spawn('/bin/sh', ['-c', 'exec sleep 30'], { stdio: 'ignore' });
  return {
    pid: child.pid ?? 0,
    stop: () =>
      new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) return done();
        child.once('exit', () => done());
        child.kill('SIGKILL');
      }),
  };
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((wake) => setTimeout(wake, 50));
  }
  return false;
}

function target(overrides: Partial<ReplacementTarget>): ReplacementTarget {
  return { pid: 1, executablePath: '/bin/true', args: [], ...overrides };
}

describe('host switch restart', () => {
  test('launches the replacement only after the old process is gone, with its arguments intact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-host-restart-'));
    const { executable, record } = fakeExecutable(root);
    const old = sleepingProcess();
    try {
      startReplacement(
        target({
          pid: old.pid,
          executablePath: executable,
          args: ['--user-data-dir=/tmp/a b', '--cairn-shell={"localMode":true}'],
        }),
      );
      await new Promise((wake) => setTimeout(wake, 1_000));
      expect(existsSync(record), 'the replacement started while the old process was alive').toBe(
        false,
      );
      await old.stop();
      expect(await waitForFile(record, 4_000), 'the replacement never started').toBe(true);
      expect(readFileSync(record, 'utf8').trim().split('\n')).toEqual([
        '--user-data-dir=/tmp/a b',
        '--cairn-shell={"localMode":true}',
      ]);
    } finally {
      await old.stop();
    }
  }, 15_000);

  test('remembers the window on the first page so the other host does not open the old path', () => {
    const saved = relaunchWindowAtRoot(
      {
        isVisible: () => true,
        isMinimized: () => false,
        isMaximized: () => false,
        isFullScreen: () => false,
        url: 'http://127.0.0.1:54400/app/projects/p_123?tab=runs',
      },
      'http://127.0.0.1:54400',
    );
    expect(saved.path).toBe('/');
    expect(saved.visible).toBe(true);
  });

  test('remembers the window, starts the waiter with this process, then quits', () => {
    const order: string[] = [];
    let argv: string[] = [];
    createHostRestarter(((_command: string, args: string[]) => {
      order.push('start');
      argv = args;
      return { on: () => {}, unref: () => {} } as never;
    }) as never)(
      {
        rememberWindow: () => order.push('remember'),
        quit: () => order.push('quit'),
        fallback: () => order.push('fallback'),
      },
      target({ pid: 4242, executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn' }),
    );
    expect(order).toEqual(['remember', 'start', 'quit']);
    expect(argv.slice(3)).toEqual(['4242', '/Applications/Cairn.app/Contents/MacOS/Cairn']);
  });

  test('falls back to the in-process relaunch when the waiter cannot spawn', () => {
    const order: string[] = [];
    createHostRestarter(((_command: string, _args: string[]) => {
      order.push('start');
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      setImmediate(() => emitter.emit('error', new Error('spawn /bin/sh ENOENT')));
      return emitter as never;
    }) as never)(
      {
        rememberWindow: () => order.push('remember'),
        quit: () => order.push('quit'),
        fallback: () => order.push('fallback'),
      },
      target({}),
    );
    return new Promise((done) =>
      setImmediate(() =>
        setImmediate(() => {
          expect(order).toEqual(['remember', 'start', 'quit', 'fallback']);
          done(undefined);
        }),
      ),
    );
  });

  test('the host switch path starts the waiter instead of asking Electron to relaunch', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'main.ts'), 'utf8');
    const start = source.indexOf('function switchDesktopHost(');
    const end = source.indexOf('\nfunction hostMenuEntries(', start);
    expect(start, 'switchDesktopHost is missing from main.ts').toBeGreaterThan(-1);
    const body = source.slice(start, end);
    expect(body).toContain('restartForSwitch()');
    expect(body).not.toContain('app.relaunch');
  });

  test('starts one replacement when a second switch arrives mid-quit', () => {
    const launched: string[][] = [];
    const restart = createHostRestarter(((_command: string, args: string[]) => {
      launched.push(args);
      return { on: () => {}, unref: () => {} } as never;
    }) as never);
    const hooks = { rememberWindow: () => {}, quit: () => {}, fallback: () => {} };
    const first = target({ pid: 77, executablePath: '/bin/true', args: ['a'] });
    restart(hooks, first);
    restart(hooks, target({ pid: 77, executablePath: '/bin/true', args: ['b'] }));
    expect(launched).toHaveLength(1);
    expect(launched[0]?.slice(3)).toEqual(['77', '/bin/true', 'a']);
  });
});
