import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { rejectingGithubFetch, takeUnstubbedCalls } from './network-guard.js';

const REPO = resolve(import.meta.dirname, '../../..');
const SETUP = join(REPO, 'apps/server/test/tmpdir-cleanup-setup.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function fixtureEnv(root: string): NodeJS.ProcessEnv {
  const { GITHUB_ACTIONS: _actions, FORCE_COLOR: _color, ...inherited } = process.env;
  return { ...inherited, NO_COLOR: '1', CAIRN_TEST_TEMP_ROOT: root };
}

function runSwallowingFixture() {
  const root = makeTestTempDir('network-guard-fixture-');
  roots.push(root);
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { setupFiles: ${JSON.stringify([SETUP])} } };\n`,
  );
  writeFileSync(
    join(root, 'leak.test.mjs'),
    [
      "import { get as httpGet } from 'node:http';",
      "import { get as httpsGet } from 'node:https';",
      "import { connect } from 'node:net';",
      "import { test } from 'vitest';",
      "test('swallows a real fetch', async () => { await fetch('https://api.github.com/zen').catch(() => undefined); });",
      "test('swallows a real socket', async () => { await new Promise((done) => connect(443, 'example.com').on('error', done).on('connect', done)); });",
      "test('swallows a real http request', async () => { await new Promise((done) => httpGet('http://example.org/').on('error', done).on('response', done)); });",
      "test('swallows a real https request', async () => { await new Promise((done) => httpsGet('https://example.net/').on('error', done).on('response', done)); });",
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

describe('server tests cannot reach the network', () => {
  test('a test that makes a real network call fails even when it swallows the error', () => {
    const result = runSwallowingFixture();
    const output = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
    expect(result.status).not.toBe(0);
    expect(output).toContain('fetch GET https://api.github.com/zen');
    expect(output).toContain('socket connect example.com');
    expect(output).toContain('socket connect example.org');
    expect(output).toContain('socket connect example.net');
    expect(output).toMatch(/4 failed \| 1 passed/);
  }, 120_000);

  test('the default githubFetch and the global fetch reject with an error naming the URL', async () => {
    const reasons = await Promise.all(
      [
        rejectingGithubFetch('https://api.github.com/repos/acme/widgets/pulls', { method: 'GET' }),
        fetch('https://api.github.com/repos/acme/widgets', { method: 'POST' }),
      ].map((call) =>
        call.then(
          () => '',
          (error: unknown) => String(error),
        ),
      ),
    );
    expect(reasons[0]).toContain('githubFetch GET https://api.github.com/repos/acme/widgets/pulls');
    expect(reasons[1]).toContain('fetch POST https://api.github.com/repos/acme/widgets');
    expect(takeUnstubbedCalls()).toEqual([
      'githubFetch GET https://api.github.com/repos/acme/widgets/pulls',
      'fetch POST https://api.github.com/repos/acme/widgets',
    ]);
  });
});
