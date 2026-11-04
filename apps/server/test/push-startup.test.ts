import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 40_000 });

describe('production server Web Push startup', () => {
  test('starts and reuses persisted keys without procfs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-push-startup-'));
    const keysPath = join(home, 'server', 'vapid.json');
    try {
      let persisted = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const child = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '--eval',
            `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import Database from 'better-sqlite3';
new Database(':memory:').close();
const open = fs.openSync;
fs.openSync = (path, ...args) => {
  if (String(path).startsWith('/proc/')) throw new Error('procfs unavailable');
  return open(path, ...args);
};
syncBuiltinESMExports();
await import('./src/index.ts');`,
          ],
          {
            cwd: join(import.meta.dirname, '..'),
            env: {
              ...process.env,
              NODE_ENV: 'production',
              CAIRN_HOME: home,
              PORT: '0',
              HOST: '127.0.0.1',
              CAIRN_TOKEN: 'startup-test',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        child.stdout.on('data', (chunk) => {
          output += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          output += String(chunk);
        });
        try {
          await expect.poll(() => output, { timeout: 15_000 }).toContain('cairn-server online');
          expect(child.exitCode, output).toBeNull();
          const keys = readFileSync(keysPath, 'utf8');
          expect(JSON.parse(keys)).toEqual({
            publicKey: expect.any(String),
            privateKey: expect.any(String),
          });
          if (attempt === 1) expect(keys).toBe(persisted);
          persisted = keys;
          expect(statSync(keysPath).mode & 0o777).toBe(0o600);
          expect(statSync(join(home, 'server')).mode & 0o777).toBe(0o700);
        } finally {
          child.kill('SIGTERM');
          await exited;
        }
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
