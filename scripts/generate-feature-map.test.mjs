import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const SCRIPTS = new URL('.', import.meta.url).pathname;

function makeFixtureRepo() {
  const root = makeTestTempDir('fm-gen-');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'docs/spec'), { recursive: true });
  mkdirSync(join(root, 'docs/verify/101'), { recursive: true });
  mkdirSync(join(root, 'apps/web/test'), { recursive: true });
  for (const name of ['generate-feature-map.mjs', 'eval-coverage.mjs']) {
    copyFileSync(join(SCRIPTS, name), join(root, 'scripts', name));
  }
  writeFileSync(join(root, 'scripts/eval-capabilities.json'), '[]');
  writeFileSync(join(root, 'docs/spec/01-core.md'), '# Core\n\nShips the widget (#101).\n');
  writeFileSync(join(root, 'docs/verify/101/notes.md'), 'evidence\n');
  writeFileSync(join(root, 'apps/web/test/a.test.ts'), '// covers #101\nexport {};\n');
  const issues = [
    { number: 101, state: 'open', state_reason: null, pr: false, title: 'Widget' },
    { number: 102, state: 'open', state_reason: null, pr: false, title: 'Gadget' },
  ];
  const gh = `#!/bin/sh
if [ "$1" = "repo" ]; then echo owner/repo; exit 0; fi
cat <<'JSON'
${issues.map((issue) => JSON.stringify(issue)).join('\n')}
JSON
`;
  writeFileSync(join(root, 'bin/gh'), gh, { mode: 0o755 });
  return root;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [join(root, 'scripts/generate-feature-map.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
  });
}

test('adding a test file or spec volume does not make --check fail', () => {
  const root = makeFixtureRepo();
  assert.equal(run(root).status, 0);
  assert.equal(run(root, '--check').status, 0);
  writeFileSync(join(root, 'apps/web/test/b.test.ts'), 'export {};\n');
  writeFileSync(join(root, 'docs/spec/02-extra.md'), '# Extra\n');
  const result = run(root, '--check');
  assert.equal(result.status, 0, result.stderr);
});

test('a real feature change still fails --check', () => {
  const root = makeFixtureRepo();
  assert.equal(run(root).status, 0);
  writeFileSync(join(root, 'apps/web/test/b.test.ts'), '// covers #102\nexport {};\n');
  const result = run(root, '--check');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from a fresh extraction/);
});
