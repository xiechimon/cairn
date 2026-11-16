import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCESS_TOKEN_FILE_NAME, formatAccessTokenFile } from '@cairn/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

vi.setConfig({ testTimeout: 40_000 });

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function runServerBin(args: string[], home: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, CAIRN_HOME: home, PORT: '0', HOST: '127.0.0.1' };
  delete env.CAIRN_TOKEN;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: join(import.meta.dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(null);
    }, 20_000);
    child.once('exit', (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  return { code, stdout, stderr };
}

function homeWithToken(token: string): string {
  const home = makeTestTempDir('cairn-server-command-');
  homes.push(home);
  writeFileSync(join(home, ACCESS_TOKEN_FILE_NAME), formatAccessTokenFile(token), { mode: 0o600 });
  return home;
}

test('`cairn token` on the server package prints the owner token and serves nothing', async () => {
  const home = homeWithToken('a'.repeat(64));
  const result = await runServerBin(['token'], home);
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.split('\n')[0]).toBe('a'.repeat(64));
  expect(result.stdout).not.toContain('cairn-server online');
  expect(existsSync(join(home, 'server', 'server.db'))).toBe(false);
});

test('a Runner command on the server package names the CLI package instead of starting a server', async () => {
  const home = homeWithToken('b'.repeat(64));
  const result = await runServerBin(['start', '--server', 'http://127.0.0.1:8787'], home);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('@xiechimon/cairn-cli');
  expect(result.stdout).not.toContain('cairn-server online');
  expect(existsSync(join(home, 'server', 'server.db'))).toBe(false);
});
