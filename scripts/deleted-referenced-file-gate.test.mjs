import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkDeletedReferences } from './deleted-referenced-file-gate.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: {
      ...scrubGitEnv({ ...process.env }),
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .toString('utf8')
    .trim();
}

function makeSandboxRepo(files) {
  const dir = makeTestTempDir('deleted-ref-gate-');
  runGit(dir, ['init', '-b', 'main']);
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(dir, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  runGit(dir, ['add', '.']);
  runGit(dir, ['commit', '-m', 'init']);
  const baseSha = runGit(dir, ['rev-parse', 'HEAD']);
  return { dir, baseSha };
}

test('flags deleting a file referenced by full path inside a living doc fenced code block', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'scripts/ops/example-job.mjs': 'console.log("hi");\n',
    'docs/ops/example.md': '# Example\n\n```bash\nnode scripts/ops/example-job.mjs\n```\n',
  });
  try {
    unlinkSync(join(dir, 'scripts/ops/example-job.mjs'));
    const res = checkDeletedReferences(dir, { baseRef: baseSha });
    assert.deepEqual(res.deleted, ['scripts/ops/example-job.mjs']);
    assert.equal(res.violations.length, 1);
    assert.equal(res.violations[0].referencingFile, 'docs/ops/example.md');
    assert.equal(res.violations[0].line, 4);
    assert.equal(res.violations[0].matchKind, 'exact-path');
  } finally {
    releaseTestTempDir(dir);
  }
});

test('flags deleting a file referenced by relative markdown link in a living doc', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'docs/ops/sub-guide.md': '# Sub\n',
    'docs/getting-started.md': '# Start\n\nSee [sub guide](ops/sub-guide.md#usage) for details.\n',
  });
  try {
    unlinkSync(join(dir, 'docs/ops/sub-guide.md'));
    const res = checkDeletedReferences(dir, { baseRef: baseSha });
    assert.equal(res.violations.length, 1);
    assert.equal(res.violations[0].deletedPath, 'docs/ops/sub-guide.md');
    assert.equal(res.violations[0].referencingFile, 'docs/getting-started.md');
    assert.equal(res.violations[0].line, 3);
    assert.equal(res.violations[0].matchKind, 'markdown-link');
  } finally {
    releaseTestTempDir(dir);
  }
});

test('flags deleting a script or unit referenced by unique basename in a living doc', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'scripts/ops/deploy-self.sh': '#!/usr/bin/env bash\n',
    'scripts/ops/systemd/cairn-server.service': '[Unit]\nDescription=Server\n',
    'docs/ops/deploy-guide.md':
      '# Deploy\n\nRun `deploy-self.sh` and check `cairn-server.service`.\n',
  });
  try {
    unlinkSync(join(dir, 'scripts/ops/deploy-self.sh'));
    unlinkSync(join(dir, 'scripts/ops/systemd/cairn-server.service'));
    const res = checkDeletedReferences(dir, { baseRef: baseSha });
    assert.equal(res.violations.length, 2);
    assert.deepEqual(
      res.violations.map((v) => [v.deletedPath, v.matchKind]),
      [
        ['scripts/ops/deploy-self.sh', 'basename'],
        ['scripts/ops/systemd/cairn-server.service', 'basename'],
      ],
    );
  } finally {
    releaseTestTempDir(dir);
  }
});

test('flags deleting a file referenced in a systemd service, launchd plist, or ops installer', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'scripts/ops/real-smoke.mjs': 'export {};\n',
    'scripts/ops/eval-daily.mjs': 'export {};\n',
    'scripts/ops/systemd/cairn-real-smoke.service':
      '[Service]\nExecStart=/usr/bin/node $REPO/scripts/ops/real-smoke.mjs\n',
    'scripts/ops/install-eval-daily.sh':
      '#!/usr/bin/env bash\necho "$EVAL_DAILY_REPO/scripts/ops/eval-daily.mjs"\n',
    'ops/launchd/com.xiechimon.eval.plist':
      '<plist><dict><string>/repo/scripts/ops/eval-daily.mjs</string></dict></plist>\n',
  });
  try {
    unlinkSync(join(dir, 'scripts/ops/real-smoke.mjs'));
    unlinkSync(join(dir, 'scripts/ops/eval-daily.mjs'));
    const res = checkDeletedReferences(dir, { baseRef: baseSha });
    assert.equal(res.violations.length, 3);
    assert.deepEqual(res.violations.map((v) => v.referencingFile).sort(), [
      'ops/launchd/com.xiechimon.eval.plist',
      'scripts/ops/install-eval-daily.sh',
      'scripts/ops/systemd/cairn-real-smoke.service',
    ]);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('passes when referencing docs remove or update the reference in the same commit', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'scripts/ops/old-script.sh': '#!/usr/bin/env bash\n',
    'docs/ops/guide.md': '# Guide\n\nUse `old-script.sh` or `scripts/ops/old-script.sh`.\n',
  });
  try {
    unlinkSync(join(dir, 'scripts/ops/old-script.sh'));
    writeFileSync(
      join(dir, 'docs/ops/guide.md'),
      '# Guide\n\nReplaced by `cairn start`.\n',
      'utf8',
    );
    runGit(dir, ['add', '-A']);
    runGit(dir, ['commit', '-m', 'retire old-script cleanly']);
    const headSha = runGit(dir, ['rev-parse', 'HEAD']);
    const res = checkDeletedReferences(dir, { baseRef: baseSha, headRef: headSha });
    assert.deepEqual(res.violations, []);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('ignores references that exist only in historical record docs', () => {
  const { dir, baseSha } = makeSandboxRepo({
    'scripts/ops/archived-tool.sh': '#!/usr/bin/env bash\n',
    'docs/research/old-note.md':
      '# Note\n\nUsed `scripts/ops/archived-tool.sh` and `archived-tool.sh`.\n',
    'docs/design/dated-record.md': '# Design\n\nSee `scripts/ops/archived-tool.sh`.\n',
  });
  try {
    unlinkSync(join(dir, 'scripts/ops/archived-tool.sh'));
    const res = checkDeletedReferences(dir, { baseRef: baseSha });
    assert.deepEqual(res.violations, []);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('real-repo negative control: 0e1e81c03 fails and 0e1e81c03^ passes', (t) => {
  try {
    runGit(REPO_ROOT, ['cat-file', '-e', '0e1e81c03^{commit}']);
    runGit(REPO_ROOT, ['cat-file', '-e', '0e1e81c03^^^{commit}']);
  } catch {
    t.skip('0e1e81c03 history unavailable in shallow clone');
    return;
  }

  const bad = checkDeletedReferences(REPO_ROOT, {
    baseRef: '0e1e81c03^',
    headRef: '0e1e81c03',
  });
  assert.ok(bad.violations.length > 0, 'expected 0e1e81c03 to trigger violations');
  assert.ok(
    bad.violations.some((v) => v.deletedPath === 'scripts/ops/deploy-self.sh'),
    'expected scripts/ops/deploy-self.sh reference to be flagged',
  );
  assert.ok(
    bad.violations.some((v) => v.deletedPath === 'scripts/ops/systemd/cairn-server.service'),
    'expected cairn-server.service reference to be flagged',
  );

  const parent = checkDeletedReferences(REPO_ROOT, {
    baseRef: '0e1e81c03^^',
    headRef: '0e1e81c03^',
  });
  assert.deepEqual(parent.violations, []);
});
