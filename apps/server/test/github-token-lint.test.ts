import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
function lint(path: string) {
  return spawnSync(
    resolve(root, 'node_modules/.bin/biome'),
    ['lint', '--only=style/noRestrictedImports', path],
    { cwd: root, encoding: 'utf8' },
  );
}

function lintFixture(input: string) {
  const directory = mkdtempSync(join(root, 'apps/server/src/services/identity-fixture-'));
  try {
    const path = join(directory, 'write.ts');
    writeFileSync(path, `${input}\n`);
    return lint(path);
  } finally {
    rmSync(directory, { recursive: true });
  }
}

test('new write files cannot import legacy getters, aliases or namespace imports', () => {
  for (const input of [
    "import { githubTokenOrNull } from './github-connection.js';",
    "import { teamGithubToken as token } from '../services/github-connection.js';",
    "import * as connection from './github-connection.js';",
  ]) {
    const result = lintFixture(input);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('noRestrictedImports');
  }
});

test('current importers and new branded providers remain importable without disabling other seams', () => {
  expect(lint('apps/server/src/services/builds.ts').status).toBe(0);
  expect(lint('apps/server/src/services/mcp-face.ts').status).toBe(0);
  expect(lint('apps/server/src/services/schedules.ts').status).toBe(0);
  expect(lintFixture("import { userTokenOrNull } from './github-connection.js';").status).toBe(0);
  expect(lintFixture("import x from 'simple-git';").status).toBe(1);
});
