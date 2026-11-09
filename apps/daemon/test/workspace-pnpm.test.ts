import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { testTempDir } from './test-temp-dir.js';

const repo = new URL('../../../', import.meta.url);

test('workspace installation never bootstraps package managers into the tracked lockfile', () => {
  const cwd = testTempDir('cairn-pnpm-');
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', npm_config_ignore_scripts: 'true' };
  delete env.npm_config_pm_on_fail;
  writeFileSync(join(cwd, 'package.json'), '{"private":true}');
  execFileSync('pnpm', ['--pm-on-fail=ignore', 'install', '--offline', '--ignore-scripts'], {
    cwd,
    env,
    timeout: 30_000,
  });
  const lock = readFileSync(join(cwd, 'pnpm-lock.yaml'));
  const manifest = JSON.parse(readFileSync(new URL('package.json', repo), 'utf8'));
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ private: true, packageManager: manifest.packageManager }),
  );
  writeFileSync(
    join(cwd, 'pnpm-workspace.yaml'),
    readFileSync(new URL('pnpm-workspace.yaml', repo)),
  );
  const result = spawnSync(
    'pnpm',
    ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'],
    {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  expect(readFileSync(join(cwd, 'pnpm-lock.yaml')).equals(lock)).toBe(true);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr + result.stdout).toBe(0);
}, 70_000);
