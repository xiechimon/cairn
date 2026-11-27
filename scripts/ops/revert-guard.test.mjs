import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { checkReverts, LOOKBACK_COMMITS, parseDeclaredReverts } from './revert-guard.mjs';

const SCRIPT = join(import.meta.dirname, 'revert-guard.mjs');

function setupRepo(t) {
  const root = makeTestTempDir('revert-guard-');
  t.after(() => releaseTestTempDir(root));
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const commitFile = (relPath, content, message) => {
    const abs = join(repo, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    git('add', '--', relPath);
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  commitFile('README.md', '# cairn\n', 'init');
  commitFile('scripts/prepush.mjs', 'export const checks = ["lint"];\n', 'add prepush');
  commitFile('apps/web/app.ts', 'export const v = 1;\n', 'add web app');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, repo, git, commitFile };
}

test('catches the exact git reset --soft origin/main revert pattern (a167446ce class)', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  git('checkout', '-qb', 'feature');
  commitFile('apps/web/app.ts', 'export const v = 2;\n', 'feature work');

  git('checkout', '-q', 'main');
  const landedSha = commitFile(
    'scripts/ops/secret-scan.mjs',
    'export function scan() {}\n',
    'ops: add secret scan step',
  );
  writeFileSync(join(repo, '.gitleaksignore'), 'fp1\n');
  writeFileSync(join(repo, 'scripts/prepush.mjs'), 'export const checks = ["lint", "secret"];\n');
  git('add', '--', '.gitleaksignore', 'scripts/prepush.mjs');
  git('commit', '-qm', 'ops: wire secret scan into prepush');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  git('checkout', '-q', 'feature');
  git('reset', '--soft', 'origin/main');
  git('commit', '-qm', 'web: feature squashed over stale index');

  const result = checkReverts(repo);
  assert.equal(result.code, 1);
  const flagged = result.findings.map((f) => f.path).sort();
  assert.deepEqual(flagged, [
    '.gitleaksignore',
    'scripts/ops/secret-scan.mjs',
    'scripts/prepush.mjs',
  ]);
  assert.ok(!flagged.includes('apps/web/app.ts'));
  assert.equal(
    result.findings.find((f) => f.path === 'scripts/ops/secret-scan.mjs')?.revertedCommit,
    landedSha,
  );
  assert.match(result.message, /git checkout origin\/main --/);
});

test('catches silent restoration of a file recently deleted on origin/main', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  const addedSha = commitFile('scripts/old-gate.mjs', 'export const old = 1;\n', 'add old gate');
  assert.ok(addedSha);
  git('rm', '-q', 'scripts/old-gate.mjs');
  const deletedSha = git('commit', '-qm', 'cleanup: remove old gate') || git('rev-parse', 'HEAD');
  const deleteCommit = git('rev-parse', 'HEAD');
  assert.ok(deletedSha);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  git('checkout', '-qb', 'feature', 'origin/main');
  commitFile('scripts/old-gate.mjs', 'export const old = 1;\n', 'stale restore');

  const result = checkReverts(repo);
  assert.equal(result.code, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, 'scripts/old-gate.mjs');
  assert.equal(result.findings[0].kind, 'restored-deleted-file');
  assert.equal(result.findings[0].revertedCommit, deleteCommit);
});

test('passes normal additions, modifications, and deletions older than the lookback window', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  commitFile('legacy.txt', 'legacy\n', 'add legacy');
  for (let i = 0; i < LOOKBACK_COMMITS + 2; i += 1) {
    commitFile('counter.txt', `step ${i}\n`, `tick ${i}`);
  }
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  git('checkout', '-qb', 'feature', 'origin/main');
  commitFile('new-file.txt', 'brand new\n', 'add new file');
  commitFile('apps/web/app.ts', 'export const v = 99;\n', 'edit web app');
  git('rm', '-q', 'legacy.txt');
  git('commit', '-qm', 'remove ancient legacy file');

  const result = checkReverts(repo);
  assert.equal(result.code, 0, result.message);
  assert.deepEqual(result.findings, []);
});

test('allows explicit git revert commits and Revert-landed trailers with real reasons', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  const badSha = commitFile('scripts/bad.mjs', 'export const bad = true;\n', 'add bad script');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  git('checkout', '-qb', 'via-git-revert', 'origin/main');
  git('revert', '--no-edit', badSha);
  const revertResult = checkReverts(repo);
  assert.equal(revertResult.code, 0, revertResult.message);

  git('checkout', '-qb', 'via-trailer', 'origin/main');
  git('rm', '-q', 'scripts/bad.mjs');
  git(
    'commit',
    '-qm',
    'ops: drop bad script\n\nRevert-landed: scripts/bad.mjs - replaced by unified gate in follow-up',
  );
  const trailerResult = checkReverts(repo);
  assert.equal(trailerResult.code, 0, trailerResult.message);
});

test('rejects hollow, wildcard, mismatched, and partial revert declarations', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  const sha = commitFile('scripts/a.mjs', 'export const a = 1;\n', 'add a');
  commitFile('scripts/b.mjs', 'export const b = 1;\n', 'add b');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  assert.deepEqual(
    parseDeclaredReverts(['Revert-landed: * - remove everything']).declaredPaths.size,
    0,
  );
  assert.deepEqual(
    parseDeclaredReverts(['Revert-landed: scripts/a.mjs - ok']).declaredPaths.size,
    0,
  );
  assert.deepEqual(
    parseDeclaredReverts(['Revert-landed: scripts/a.mjs - intentional']).declaredPaths.size,
    0,
  );
  assert.deepEqual(
    parseDeclaredReverts(['Revert-landed: scripts/a.mjs - too short']).declaredPaths.size,
    0,
  );

  git('checkout', '-qb', 'hollow', 'origin/main');
  git('rm', '-q', 'scripts/a.mjs', 'scripts/b.mjs');
  git(
    'commit',
    '-qm',
    [
      'remove a and b',
      '',
      `This reverts commit ${'0'.repeat(40)}.`,
      'Revert-landed: * - clean up both files at once',
      'Revert-landed: scripts/a.mjs - ok',
    ].join('\n'),
  );
  const hollowResult = checkReverts(repo);
  assert.equal(hollowResult.code, 1);
  assert.deepEqual(hollowResult.findings.map((f) => f.path).sort(), [
    'scripts/a.mjs',
    'scripts/b.mjs',
  ]);

  git('checkout', '-qb', 'partial', 'origin/main');
  git('rm', '-q', 'scripts/a.mjs', 'scripts/b.mjs');
  git(
    'commit',
    '-qm',
    `drop a and b\n\nThis reverts commit ${sha}.\nRevert-landed: scripts/a.mjs - superseded by new module`,
  );
  const partialResult = checkReverts(repo);
  assert.equal(partialResult.code, 1);
  assert.deepEqual(
    partialResult.findings.map((f) => f.path),
    ['scripts/b.mjs'],
  );
});

test('catches silent revert of a file added by a merge commit on mainline', (t) => {
  const { repo, git, commitFile } = setupRepo(t);
  git('checkout', '-qb', 'side');
  commitFile('scripts/from-merge.mjs', 'export const m = 1;\n', 'side work');
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-qm', 'merge side branch', 'side');
  const mergeSha = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/main', mergeSha);

  git('checkout', '-qb', 'feature', 'origin/main');
  git('rm', '-q', 'scripts/from-merge.mjs');
  git('commit', '-qm', 'accidentally drop merged file');

  const result = checkReverts(repo);
  assert.equal(result.code, 1);
  assert.equal(result.findings[0].path, 'scripts/from-merge.mjs');
  assert.equal(result.findings[0].revertedCommit, mergeSha);
});

test('returns code 2 when origin/main is missing or repo is invalid, and cannot be shadowed by local branch', (t) => {
  const { root, repo, git, commitFile } = setupRepo(t);
  const added = commitFile('scripts/added.mjs', 'export const x = 1;\n', 'add');
  assert.ok(added);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-qb', 'origin/main');
  git('rm', '-q', 'scripts/added.mjs');
  git('commit', '-qm', 'drop added despite local origin/main shadow');

  const shadowedResult = checkReverts(repo);
  assert.equal(shadowedResult.code, 1);

  git('update-ref', '-d', 'refs/remotes/origin/main');
  const missingRef = checkReverts(repo);
  assert.equal(missingRef.code, 2);

  const nonRepo = join(root, 'not-a-repo');
  mkdirSync(nonRepo, { recursive: true });
  assert.equal(checkReverts(nonRepo).code, 2);
});

test('CLI returns exact exit codes 0, 1, 2 and works through a symlink', (t) => {
  const { root, repo, git, commitFile } = setupRepo(t);
  commitFile('scripts/added.mjs', 'export const x = 1;\n', 'add');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  git('checkout', '-qb', 'clean', 'origin/main');
  commitFile('scripts/other.mjs', 'export const y = 2;\n', 'clean commit');
  const link = join(root, 'revert-guard-link.mjs');
  symlinkSync(SCRIPT, link);
  const okRun = spawnSync(process.execPath, [link], { cwd: repo, encoding: 'utf8' });
  assert.equal(okRun.status, 0, okRun.stderr);
  assert.match(okRun.stdout, /PASS/);

  git('rm', '-q', 'scripts/added.mjs');
  git('commit', '-qm', 'drop added');
  const redRun = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' });
  assert.equal(redRun.status, 1);
  assert.match(redRun.stderr, /scripts\/added\.mjs/);

  git('update-ref', '-d', 'refs/remotes/origin/main');
  const errRun = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' });
  assert.equal(errRun.status, 2);
});
