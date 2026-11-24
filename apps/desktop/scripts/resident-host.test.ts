import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  clearServerOwner,
  installResidentHost,
  isResidentInstalled,
  probeResidentServer,
  readServerOwner,
  uninstallResidentHost,
  writeServerOwner,
} from '../src/resident-host.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-resident-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resident host and ownership lock', () => {
  test('writes, probes, and clears server-owner.json safely', async () => {
    const home = tempDir();
    writeServerOwner(home, {
      pid: process.pid,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: Date.now(),
    });
    expect(readServerOwner(home)?.pid).toBe(process.pid);

    const alive = await probeResidentServer(home, async () => new Response('{}', { status: 200 }));
    expect(alive?.origin).toBe('http://127.0.0.1:8787');

    const dead = await probeResidentServer(home, async () => new Response('', { status: 500 }));
    expect(dead).toBeNull();

    clearServerOwner(home, process.pid + 999);
    expect(readServerOwner(home)?.pid).toBe(process.pid);
    clearServerOwner(home, process.pid);
    expect(readServerOwner(home)).toBeNull();
  });

  test('installs and uninstalls macOS LaunchAgent plist via launchctl', async () => {
    const home = tempDir();
    const calls: string[][] = [];
    const runLaunchctl = async (args: string[]) => {
      calls.push(args);
    };
    const res = await installResidentHost({
      homeDir: home,
      executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn',
      serverEntry: '/Applications/Cairn.app/Contents/Resources/server/dist/index.mjs',
      cairnHome: join(home, '.cairn-server'),
      logDir: join(home, 'logs'),
      uid: 501,
      runLaunchctl,
    });
    expect(res.ok).toBe(true);
    expect(isResidentInstalled(home)).toBe(true);
    if (res.ok) {
      const xml = readFileSync(res.plistPath, 'utf8');
      expect(xml).toContain('ELECTRON_RUN_AS_NODE');
      expect(xml).toContain('/Applications/Cairn.app/Contents/MacOS/Cairn');
    }
    expect(calls.some((args) => args[0] === 'bootstrap')).toBe(true);

    await uninstallResidentHost({ homeDir: home, uid: 501, runLaunchctl });
    expect(isResidentInstalled(home)).toBe(false);
  });
});
