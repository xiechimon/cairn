import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HostComputerProvider } from '../src/computer/host.js';
import type { ComputerProcessEvent } from '../src/computer/provider.js';

const fixture = fileURLToPath(new URL('./computer-host-detached-fixture.py', import.meta.url));
const hasPython = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function alive(pid: number): boolean {
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
      .trim()
      .startsWith('Z');
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error('Detached fixture did not reach its expected state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Receipt {
  pid: number;
  ppid: number;
  ppidComm?: string;
  pgid: number;
  sid: number;
  uid: number;
  markerPresent: boolean;
  token: string;
  cwd: string;
}

function commandPath(name: string): string {
  return execFileSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
}

async function expectDetachedDescendantDies(input: {
  argv: string[];
  env?: Record<string, string>;
}): Promise<void> {
  const allocated = makeTestTempDir('host-detached-');
  const home = realpathSync(allocated);
  const receiptPath = join(home, 'receipt.json');
  const token = randomUUID();
  const host = new HostComputerProvider({ home, killGraceMs: 30 });
  let receipt: Receipt | undefined;
  let events: AsyncIterable<ComputerProcessEvent> | undefined;
  try {
    events = await host.execute({
      argv: input.argv.flatMap((part) =>
        part === '$RECEIPT' ? [receiptPath] : part === '$TOKEN' ? [token] : [part],
      ),
      ...(input.env ? { env: input.env } : {}),
      timeoutMs: 800,
      signal: new AbortController().signal,
    });
    await waitFor(() => existsSync(receiptPath));
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Receipt;
    expect(receipt.markerPresent).toBe(false);
    expect(receipt.uid).toBe(process.getuid?.());
    expect(receipt.token).toBe(token);
    expect(receipt.cwd).toBe(home);
    expect(receipt.sid).not.toBe(receipt.pid);
    if (process.platform === 'linux') {
      expect(['bash', 'sleep'], JSON.stringify(receipt)).toContain(receipt.ppidComm);
    }
    const seen: ComputerProcessEvent[] = [];
    for await (const event of events) seen.push(event);
    expect(seen.at(-1)).toMatchObject({ kind: 'exit', code: 124, reason: 'timeout' });
    expect(alive(receipt.pid), JSON.stringify(receipt)).toBe(false);
  } finally {
    await host.killAll();
    if (!receipt && existsSync(receiptPath)) {
      receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Receipt;
    }
    if (receipt && alive(receipt.pid)) {
      const command = execFileSync('ps', ['-o', 'command=', '-p', String(receipt.pid)], {
        encoding: 'utf8',
      });
      expect(command).toContain(fixture);
      expect(command).toContain(token);
      expect(command).toContain(receiptPath);
      if (process.platform === 'linux') {
        expect(realpathSync(`/proc/${receipt.pid}/cwd`)).toBe(home);
      } else {
        const cwd = execFileSync('lsof', ['-a', '-p', String(receipt.pid), '-d', 'cwd', '-Fn'], {
          encoding: 'utf8',
        });
        expect(cwd.split('\n')).toContain(`n${home}`);
      }
      expect(receipt.uid).toBe(process.getuid?.());
      process.kill(receipt.pid, 'SIGKILL');
      await waitFor(() => !alive(receipt?.pid ?? -1));
    }
    expect(dirname(receiptPath)).toBe(home);
    expect(releaseTestTempDir(allocated)).toBe(true);
  }
}

test.skipIf(!hasPython || process.platform === 'win32')(
  'timeout kills a double-forked new-session descendant after it removes the marker',
  () =>
    expectDetachedDescendantDies({
      argv: [
        'bash',
        '-c',
        'python3 "$1" launch "$2" "$3"; sleep 30',
        'fixture-shell',
        fixture,
        '$RECEIPT',
        '$TOKEN',
      ],
    }),
);

test.skipIf(!hasPython || process.platform !== 'linux')(
  'a command PATH without python3 still keeps the descendant under the command',
  () => {
    const home = makeTestTempDir('host-detached-path-');
    mkdirSync(join(home, 'bin'));
    return expectDetachedDescendantDies({
      argv: [
        commandPath('bash'),
        '-c',
        '"$1" "$2" launch "$3" "$4"; "$5" 30',
        'fixture-shell',
        commandPath('python3'),
        fixture,
        '$RECEIPT',
        '$TOKEN',
        commandPath('sleep'),
      ],
      env: { PATH: join(home, 'bin') },
    }).finally(() => {
      expect(releaseTestTempDir(home)).toBe(true);
    });
  },
);
