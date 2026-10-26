import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { depViolations, preinstallNodeFiles } from './preinstall-deps-gate.mjs';
import { cleanupTestDirs, makeTestTempDir } from './test-tmpdir.mjs';

const WORKFLOW = `on:
  pull_request:
jobs:
  bare:
    runs-on: ubuntu-latest
    steps:
      - name: Bare gate
        run: |
          node --test scripts/bare.test.mjs
  installs-first:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: After install
        run: node scripts/after.mjs
  installs-midway:
    runs-on: ubuntu-latest
    steps:
      - name: Early gate
        run: node scripts/early.mjs
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Late gate
        run: node scripts/late.mjs
  nameless:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/nameless.mjs
`;

function sandbox(files) {
  const root = makeTestTempDir('preinstall-deps-test');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const entriesOf = () =>
  preinstallNodeFiles(WORKFLOW).map((entry) => ({ ...entry, workflow: 'ci.yml' }));

test('only steps before the dependency install are collected', () => {
  assert.deepEqual(preinstallNodeFiles(WORKFLOW), [
    { job: 'bare', step: 'Bare gate', file: 'scripts/bare.test.mjs' },
    { job: 'installs-midway', step: 'Early gate', file: 'scripts/early.mjs' },
    { job: 'nameless', step: 'node scripts/nameless.mjs', file: 'scripts/nameless.mjs' },
  ]);
});

test('a package import reachable before any install step is one violation', () => {
  const root = sandbox({
    'scripts/bare.test.mjs': "import { afterAll } from 'vitest';\n",
    'scripts/after.mjs': "import { afterAll } from 'vitest';\n",
    'scripts/early.mjs': "import { join } from 'node:path';\n",
    'scripts/late.mjs': "import { afterAll } from 'vitest';\n",
    'scripts/nameless.mjs': "import { join } from 'node:path';\n",
  });
  try {
    const violations = depViolations(entriesOf(), root);
    assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
    assert.match(violations[0].message, /scripts\/bare\.test\.mjs imports package 'vitest'/);
    assert.equal(violations[0].job, 'bare');
    assert.equal(violations[0].step, 'Bare gate');
  } finally {
    cleanupTestDirs([root]);
  }
});

test('a violation names the importing file through relative imports', () => {
  const root = sandbox({
    'scripts/bare.test.mjs':
      "import { helper } from './bare-helper.mjs';\nexport const x = helper;\n",
    'scripts/bare-helper.mjs': "import { parse } from 'yaml';\nexport const helper = parse;\n",
    'scripts/early.mjs': "import { join } from 'node:path';\n",
    'scripts/nameless.mjs': "import { join } from 'node:path';\n",
  });
  try {
    const violations = depViolations(entriesOf(), root);
    assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
    assert.match(violations[0].message, /scripts\/bare-helper\.mjs imports package 'yaml'/);
    assert.equal(violations[0].file, 'scripts/bare.test.mjs');
  } finally {
    cleanupTestDirs([root]);
  }
});

test('node builtins and resolvable relative imports stay green', () => {
  const root = sandbox({
    'scripts/bare.test.mjs':
      "import { join } from 'node:path';\nimport { helper } from './bare-helper.mjs';\n",
    'scripts/bare-helper.mjs':
      "import { readFileSync } from 'node:fs';\nexport const helper = 1;\n",
    'scripts/early.mjs': "import { test } from 'node:test';\nexport const t = test;\n",
    'scripts/nameless.mjs': "import { join } from 'node:path';\n",
  });
  try {
    assert.deepEqual(depViolations(entriesOf(), root), []);
  } finally {
    cleanupTestDirs([root]);
  }
});

test('a relative import that does not resolve is a violation', () => {
  const root = sandbox({
    'scripts/bare.test.mjs': "import './missing.mjs';\n",
    'scripts/early.mjs': "import { join } from 'node:path';\n",
    'scripts/nameless.mjs': "import { join } from 'node:path';\n",
  });
  try {
    const violations = depViolations(entriesOf(), root);
    assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
    assert.match(violations[0].message, /imports missing file '\.\/missing\.mjs'/);
  } finally {
    cleanupTestDirs([root]);
  }
});

test('the gate passes on this repository', () => {
  const result = execFileSync(process.execPath, [resolve('scripts/preinstall-deps-gate.mjs')], {
    encoding: 'utf8',
  });
  assert.match(result, /\[preinstall-deps-gate\] PASS \(\d+ pre-install node files\)/);
});
