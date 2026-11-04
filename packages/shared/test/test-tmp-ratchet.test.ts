import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  compareToBaseline,
  countRawAllocations,
  scan,
  shrunk,
} from '../../../scripts/test-tmp-ratchet-gate.mjs';
import { cleanupTestTempDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const GATE = join(import.meta.dirname, '../../../scripts/test-tmp-ratchet-gate.mjs');
const BASELINE = join(import.meta.dirname, '../../../scripts/test-tmp-baseline.json');

afterEach(() => cleanupTestTempDirs());

function fixtureRepo(files: Record<string, string>, baseline: Record<string, number>): string {
  const root = makeTestTempDir('ratchet-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/test-tmp-baseline.json'), JSON.stringify(baseline));
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

function runGate(root: string) {
  return spawnSync('node', [GATE, '--root', root], { encoding: 'utf8' });
}

describe('countRawAllocations', () => {
  test.each([
    ['sync call', "const d = mkdtempSync(join(tmpdir(), 'x-'));", 1],
    ['async call', "const d = await mkdtemp(join(tmpdir(), 'x-'));", 1],
    ['namespace call', "const d = fs.mkdtempSync('/tmp/x-');", 1],
    ['promises namespace call', "const d = await fsp.mkdtemp('/tmp/x-');", 1],
    [
      'aliased import',
      "import { mkdtempSync as makeDir } from 'node:fs';\nconst d = makeDir('/tmp/x-');\nconst e = makeDir('/tmp/y-');",
      2,
    ],
    [
      'destructured require alias',
      "const { mkdtempSync: mk } = require('node:fs');\nmk('/tmp/x-');",
      1,
    ],
    ['import line alone', "import { mkdtempSync } from 'node:fs';", 0],
    ['the shared helper', "const d = makeTestTempDir('x-');", 0],
  ])('%s', (_name, source, expected) => {
    expect(countRawAllocations(source)).toBe(expected);
  });
});

describe('compareToBaseline and shrunk', () => {
  test('a file above its baseline is a violation', () => {
    expect(compareToBaseline({ 'a.test.ts': 3 }, { 'a.test.ts': 2 })).toEqual([
      { file: 'a.test.ts', count: 3, allowed: 2 },
    ]);
  });

  test('a new file with any raw allocation is a violation', () => {
    expect(compareToBaseline({ 'new.test.ts': 1 }, {})).toHaveLength(1);
  });

  test('equal and lower counts pass', () => {
    expect(
      compareToBaseline({ 'a.test.ts': 2, 'b.test.ts': 1 }, { 'a.test.ts': 2, 'b.test.ts': 4 }),
    ).toEqual([]);
  });

  test('shrinking drops migrated files and never raises a count', () => {
    expect(shrunk({ 'a.test.ts': 1 }, { 'a.test.ts': 3, 'b.test.ts': 2 })).toEqual({
      'a.test.ts': 1,
    });
  });
});

describe('the gate exit code', () => {
  test('a deliberately added raw allocation exits non-zero', () => {
    const root = fixtureRepo(
      { 'apps/server/test/leak.test.ts': "const d = mkdtempSync('/tmp/cairn-leak-');" },
      {},
    );
    const run = runGate(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('apps/server/test/leak.test.ts');
  });

  test('an aliased raw allocation exits non-zero', () => {
    const root = fixtureRepo(
      {
        'integration/test/alias.test.ts':
          "import { mkdtemp as makeDir } from 'node:fs/promises';\nawait makeDir('/tmp/cairn-leak-');",
      },
      {},
    );
    expect(runGate(root).status).toBe(1);
  });

  test('the shared helper and an allowed baseline exit zero', () => {
    const root = fixtureRepo(
      {
        'apps/server/test/ok.test.ts': "const d = makeTestTempDir('ok-');",
        'apps/server/test/old.test.ts': "const d = mkdtempSync('/tmp/old-');",
      },
      { 'apps/server/test/old.test.ts': 1 },
    );
    expect(runGate(root).status).toBe(0);
  });
});

describe('this repository', () => {
  test('no test source has more raw allocations than the baseline', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
    expect(compareToBaseline(scan(), baseline)).toEqual([]);
  });
});
