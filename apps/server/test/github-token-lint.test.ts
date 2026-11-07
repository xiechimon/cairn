import { spawnSync } from 'node:child_process';
import { readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const root = resolve(import.meta.dirname, '../../..');
function lint(path: string) {
  return spawnSync(
    resolve(root, 'node_modules/.bin/biome'),
    ['lint', '--only=style/noRestrictedImports', path],
    { cwd: root, encoding: 'utf8' },
  );
}

function lintFixture(input: string) {
  const directory = makeTestTempDir('identity-fixture-');
  const fixture = join(root, 'apps/server/src/services', basename(directory));
  symlinkSync(directory, fixture, 'dir');
  try {
    const path = join(directory, 'write.ts');
    writeFileSync(path, `${input}\n`);
    return lint(join(fixture, 'write.ts'));
  } finally {
    unlinkSync(fixture);
    releaseTestTempDir(directory);
  }
}

test('new write files cannot import legacy getters, aliases or namespace imports', () => {
  for (const input of [
    "import { githubTokenOrNull } from './github-connection.js';",
    "import * as connection from './github-connection.js';",
  ]) {
    const result = lintFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('noRestrictedImports');
  }
});

test('current importers and new branded providers remain importable without disabling other seams', () => {
  expect(lint('apps/server/src/services/builds.ts').status).toBe(0);
  expect(lint('apps/server/src/routes-resources.ts').status).toBe(0);
  expect(lint('apps/server/src/services/mcp-face.ts').status).toBe(0);
  expect(lint('apps/server/src/services/schedules.ts').status).toBe(0);
  expect(lintFixture("import { userTokenOrNull } from './github-connection.js';").status).toBe(0);
  expect(lintFixture("import x from 'simple-git';").status).toBe(1);
});

test('former migration allowlist no longer exempts any legacy getter importer', () => {
  const config = JSON.parse(readFileSync(join(root, 'biome.json'), 'utf8')) as {
    overrides: { includes: string[] }[];
  };
  for (const path of [
    'routes-resources',
    'services/builds',
    'services/pr-watch',
    'services/ci-loop',
    'services/issue-intake',
    'services/machine-step-token',
    'services/merge-gate-run',
    'services/todos',
    'services/scheduler',
  ]) {
    expect(
      config.overrides.some((rule) => rule.includes.includes(`!apps/server/src/${path}.ts`)),
    ).toBe(false);
    const result = lintFixture(
      "import { githubTokenOrNull as legacy } from './github-connection.js';",
    );
    expect(result.status).toBe(1);
    expect(result.stderr.includes('noRestrictedImports')).toBe(true);
  }
});
