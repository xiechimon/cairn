import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'doc-drift.mjs');
const NOW = '2026-10-24T12:00:00Z';
const date = NOW.slice(0, 10);

const fixture = () => {
  const cwd = mkdtempSync(join(tmpdir(), 'doc-drift-'));
  const git = (date, ...args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  git(NOW, 'init', '-b', 'main');
  git(NOW, 'config', 'user.email', 'test@example.com');
  git(NOW, 'config', 'user.name', 'Test');
  return {
    cwd,
    commit: (tree, message = 'change') => {
      for (const [path, content] of Object.entries(tree)) {
        if (content === null) {
          execFileSync('git', ['rm', '-q', path], { cwd, stdio: 'pipe' });
          continue;
        }
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), content);
      }
      git(NOW, 'add', '-A');
      git(NOW, 'commit', '-m', message);
    },
    run: (...args) =>
      spawnSync(process.execPath, [script, '--now', NOW, ...args], {
        cwd,
        encoding: 'utf8',
      }),
  };
};

test('a spec naming an existing path and an existing exported function reports nothing', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md':
        'The ledger lives at `apps/server/src/services/builds.ts`; count with `countMetric(`.\n',
      'apps/server/src/services/builds.ts': 'export function countMetric() {}\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No spec\/ADR drift found/);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a spec naming a deleted path reports it once with its line number', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md':
        'line one\nline two\nSee `apps/server/src/services/gone.ts` for the shape.\n',
      'apps/server/src/services/gone.ts': 'export const gone = true;\n',
    });
    commit({ 'apps/server/src/services/gone.ts': null }, 'delete gone');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, [
      {
        doc: 'docs/spec/01-test.md',
        name: 'apps/server/src/services/gone.ts',
        kind: 'path',
        line: 3,
      },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a renamed function is reported as a missing identifier', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'Invoke `oldHelper(` after the call completes.\n',
      'apps/server/src/services/helpers.ts': 'export function oldHelper() {}\n',
    });
    commit({ 'apps/server/src/services/helpers.ts': 'export function newHelper() {}\n' }, 'rename');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, [
      { doc: 'docs/spec/01-test.md', name: 'oldHelper', kind: 'identifier', line: 1 },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('names inside fenced code blocks and URLs are ignored', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md':
        '```ts\nimport { gone } from "apps/server/src/services/gone.ts";\n```\n' +
        'Fetch https://example.com/apps/server/src/services/gone.ts for the raw text.\n',
      'apps/server/src/services/gone.ts': 'export const gone = true;\n',
    });
    commit({ 'apps/server/src/services/gone.ts': null }, 'delete gone');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a table row marked superseded is ignored', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md':
        '| Fact | Source | Status |\n| --- | --- | --- |\n' +
        '| F1 | `apps/server/src/services/gone.ts` | superseded |\n',
      'apps/server/src/services/gone.ts': 'export const gone = true;\n',
    });
    commit({ 'apps/server/src/services/gone.ts': null }, 'delete gone');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('short or common words in backticks are not treated as identifiers', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'The fields are `id`, `name`, `true` and `builds(` when lowercase.\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a path that never existed in the repo is not reported', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md':
        'The reference layout uses `packages/ui/styles/tokens.css` and `auth/chatgpt-oauth.ts`.\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a relative path resolving under a tracked file is not reported', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'The client lives at `api/mode.ts`.\n',
      'apps/web/src/api/mode.ts': 'export const mode = true;\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a path with a line-range suffix is checked without the range', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'See `apps/server/src/services/builds.ts:1719` for the jump.\n',
      'apps/server/src/services/builds.ts': 'export function countMetric() {}\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a directory reference is not reported as a missing path', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'Specs live under `apps/web/e2e/`.\n',
      'apps/web/e2e/smoke.spec.ts': 'test("smoke", () => {});\n',
    });
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a deleted relative path is reported through its historical repository path', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'Line one\nSee `api/mode.ts` for the client.\n',
      'apps/web/src/api/mode.ts': 'export const mode = true;\n',
    });
    commit({ 'apps/web/src/api/mode.ts': null }, 'delete client');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    const rows = JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8'));
    assert.deepEqual(rows, [
      { doc: 'docs/spec/01-test.md', name: 'api/mode.ts', kind: 'path', line: 2 },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('historical suffix matching respects directory boundaries', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'See `api/mode.ts` for the reference client.\n',
      'apps/web/src/not-api/mode.ts': 'export const mode = true;\n',
    });
    commit({ 'apps/web/src/not-api/mode.ts': null }, 'delete other client');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8')),
      [],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('uncommitted file restoration does not hide drift at HEAD', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'See `api/mode.ts` for the client.\n',
      'apps/web/src/api/mode.ts': 'export const mode = true;\n',
    });
    commit({ 'apps/web/src/api/mode.ts': null }, 'delete client');
    mkdirSync(join(cwd, 'apps/web/src/api'), { recursive: true });
    writeFileSync(join(cwd, 'apps/web/src/api/mode.ts'), 'export const mode = true;\n');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8')),
      [{ doc: 'docs/spec/01-test.md', name: 'api/mode.ts', kind: 'path', line: 1 }],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('an identifier mentioned only in integration fixtures is still missing from application code', () => {
  const { cwd, commit, run } = fixture();
  try {
    commit({
      'docs/spec/01-test.md': 'Invoke `oldHelper(` after the call completes.\n',
      'apps/server/src/helpers.ts': 'export function oldHelper() {}\n',
      'integration/fixture.ts': 'const historicalName = "oldHelper";\n',
    });
    commit({ 'apps/server/src/helpers.ts': 'export function newHelper() {}\n' }, 'rename');
    const result = run('--out', '.gardener');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(cwd, '.gardener', `drift-${date}.json`), 'utf8')),
      [{ doc: 'docs/spec/01-test.md', name: 'oldHelper', kind: 'identifier', line: 1 }],
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
