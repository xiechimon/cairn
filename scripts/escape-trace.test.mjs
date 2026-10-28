import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { prepushPlan } from './prepush.mjs';

const cli = resolve('scripts/escape-trace.mjs');
const start = '2026-10-01T00:00:00Z';
const end = '2026-10-02T00:00:00Z';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'escape-candidates-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (args, env = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: 'pipe',
    }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Candidate test']);
  git(['config', 'user.email', 'candidate@example.invalid']);
  function commit(message, date = start, path = 'file.txt') {
    writeFileSync(join(cwd, path), message);
    git(['add', '--', path]);
    git(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(['rev-parse', 'HEAD']);
  }
  const run = (...args) =>
    spawnSync(process.execPath, [cli, '--since', start, '--until', end, ...args], {
      cwd,
      encoding: 'utf8',
    });
  return { cwd, git, commit, run };
}

test('CLI uses origin/main, preserves full records, and recognizes only candidate syntax', (t) => {
  const { git, commit, run } = fixture(t);
  commit('fix: before interval', '2026-09-30T23:59:59Z');
  const message =
    'web(1832): fix crash (#1803)\n\nIntroduced by #100.\nDetails with "quotes" and\ta tab.';
  const sha = commit(message, start, 'tab\tand\nline.txt');
  commit('fix(server)!: repair fallback (#201)', '2026-10-01T12:00:00Z');
  commit('server(200): fix token fallback (#202)');
  commit(
    'Revert "feat: broken feature"\n\nThis reverts commit 0123456789012345678901234567890123456789.',
  );
  commit('revert(server): undo broken feature (#203)');
  commit('docs: explain how to revert (#204)');
  commit('web(1): document revert behavior (#205)');
  commit('fix: at exclusive end', end);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  commit('fix: unrelated branch (#999)');
  const before = git(['status', '--porcelain']);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  assert.equal(records.length, 5);
  assert.deepEqual(
    records.find((record) => record.followUpSha === sha),
    {
      followUpSha: sha,
      timestamp: '2026-10-01T00:00:00.000Z',
      message: `${message}\n`,
      paths: ['tab\tand\nline.txt'],
      fixingPr: 1803,
    },
  );
  assert.ok(records.some((record) => record.fixingPr === null));
  assert.ok(records.every((record) => !('pr' in record) && !('originatingPr' in record)));
  assert.equal(run().stdout, result.stdout);
  assert.equal(git(['status', '--porcelain']), before);
});

test('CLI does not truncate more than 200 qualifying commits', (t) => {
  const { git, commit, run } = fixture(t);
  for (let i = 0; i < 205; i++) commit(`fix: repair ${i}`);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).length, 205);
});

test('CLI rejects missing refs and invalid or ambiguous UTC intervals', (t) => {
  const { cwd, git, commit, run } = fixture(t);
  assert.notEqual(run().status, 0);
  commit('fix: valid');
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (const args of [
    ['--since', '2026-10-01', '--until', end],
    ['--since', end, '--until', end],
    ['--since', start, '--until', '2026-02-30T00:00:00Z'],
    ['--unknown', 'x'],
    [],
  ])
    assert.notEqual(
      spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }).status,
      0,
    );
});

test('local and CI plans execute behavior assertions and propagate deliberate failures', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'escape-runner-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const failing = join(cwd, 'escape-trace.test.mjs');
  writeFileSync(
    failing,
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('deliberate negative control', () => assert.equal(1, 2));\n",
  );
  const prepush = resolve('scripts/prepush.mjs');
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /run: pnpm prepush --ci/);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const mode of ['local', 'ci']) {
    const step = prepushPlan(['scripts/escape-trace.mjs'], mode).find((args) =>
      args.includes('scripts/escape-trace.test.mjs'),
    );
    assert.deepEqual(step, ['node', '--test', 'scripts/escape-trace.test.mjs']);
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { runPlan } from ${JSON.stringify(prepush)}; runPlan(${JSON.stringify([[step[0], step[1], failing]])}, { cwd: ${JSON.stringify(cwd)}, env: process.env });`,
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /deliberate negative control/);
  }
});
