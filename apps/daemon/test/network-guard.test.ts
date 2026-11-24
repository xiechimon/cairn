import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const DAEMON_SETUP = join(REPO, 'apps/daemon/test/setup.ts');
const DAEMON_CONFIG = join(REPO, 'apps/daemon/vitest.config.ts');
const INTEGRATION_SETUP = join(REPO, 'integration/test/tmpdir-cleanup-setup.ts');
const INTEGRATION_CONFIG = join(REPO, 'integration/vitest.config.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function fixtureEnv(root: string): NodeJS.ProcessEnv {
  const { GITHUB_ACTIONS: _actions, FORCE_COLOR: _color, ...inherited } = process.env;
  return { ...inherited, NO_COLOR: '1', CAIRN_TEST_TEMP_ROOT: root };
}

function runSwallowingFixture(setupFile: string) {
  const root = makeTestTempDir('daemon-network-guard-fixture-');
  roots.push(root);
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { setupFiles: ${JSON.stringify([setupFile])} } };\n`,
  );
  writeFileSync(
    join(root, 'leak.test.mjs'),
    [
      "import { connect } from 'node:net';",
      "import { test } from 'vitest';",
      "test('swallows a real fetch', async () => { await fetch('https://antigravity-cli-auto-updater.example/manifest.json').catch(() => undefined); });",
      "test('swallows a real socket', async () => { await new Promise((done) => connect(443, 'example.com').on('error', done).on('connect', done)); });",
      "test('rejects custom lookup resolving to external IP', async () => { await new Promise((done) => connect({ host: 'proxy.test', port: 80, lookup: (_h, _o, cb) => cb(null, '93.184.216.34', 4) }).on('error', done).on('connect', done)); });",
      "test('loopback stays allowed', async () => { await fetch('http://127.0.0.1:9/').catch(() => undefined); });",
      '',
    ].join('\n'),
  );
  return spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--root', root, '--config', join(root, 'vitest.config.mjs')],
    { cwd: REPO, encoding: 'utf8', env: fixtureEnv(root) },
  );
}

describe('daemon and integration tests cannot reach external networks', () => {
  test('setup files are registered on both vitest configs', () => {
    expect(readFileSync(DAEMON_CONFIG, 'utf8')).toContain('./test/setup.ts');
    expect(readFileSync(INTEGRATION_CONFIG, 'utf8')).toContain('./test/tmpdir-cleanup-setup.ts');
  });

  test.each([
    ['daemon', DAEMON_SETUP],
    ['integration', INTEGRATION_SETUP],
  ])(
    '%s setup fails tests that swallow real network calls while allowing loopback',
    (_label, setupFile) => {
      const result = runSwallowingFixture(setupFile);
      const output = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
      expect(result.status).not.toBe(0);
      expect(output).toContain(
        'fetch GET https://antigravity-cli-auto-updater.example/manifest.json',
      );
      expect(output).toContain('socket connect example.com');
      expect(output).toContain('socket connect proxy.test');
      expect(output).toMatch(/3 failed \| 1 passed/);
    },
    120_000,
  );
});
