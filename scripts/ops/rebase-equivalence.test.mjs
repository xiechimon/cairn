import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { isCleanRebaseOf, rebaseOwnerLane } from './rebase-equivalence.mjs';

const ENV = {
  GIT_AUTHOR_NAME: 'xiechimon',
  GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'xiechimon',
  GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
};

function setupRepo() {
  const cwd = makeTestTempDir('rebase-eq-');
  const git = (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...ENV },
    }).trim();
  const commit = (file, content, message) => {
    writeFileSync(join(cwd, file), content);
    git(['add', file]);
    git(['commit', '--quiet', '-m', message]);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '--quiet', '-b', 'main']);
  const base0 = commit('base.txt', 'v0\n', 'chore: base0');
  git(['checkout', '--quiet', '-b', 'other']);
  const other = commit('other.txt', 'other\n', 'chore: other');
  git(['checkout', '--quiet', 'main']);
  const main1 = commit('main.txt', 'm1\n', 'chore: main1');
  return { cwd, git, commit, base0, main1, other };
}

test('isCleanRebaseOf accepts clean forward rebases and trailer-only amends', () => {
  const { cwd, git, commit, base0, main1 } = setupRepo();
  try {
    git(['checkout', '--quiet', '-b', 'feat', base0]);
    commit('f1.txt', 'one\n', 'feat: one');
    const tested = commit('f2.txt', 'two\n', 'feat: two');

    git(['checkout', '--quiet', '-b', 'feat-stamped', tested]);
    git(['commit', '--quiet', '--amend', '--no-edit', '-m', 'feat: two\n\nLane: m-1/wt']);
    const stamped = git(['rev-parse', 'HEAD']);
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: stamped }),
      true,
    );

    git(['checkout', '--quiet', '-b', 'feat-rebased', tested]);
    git(['rebase', '--quiet', main1]);
    const rebased = git(['rev-parse', 'HEAD']);
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: rebased }),
      true,
    );
  } finally {
    releaseTestTempDir(cwd);
  }
});

test('isCleanRebaseOf rejects code edits, subject edits, commit additions, backward rebases, and merges', () => {
  const { cwd, git, commit, base0, main1, other } = setupRepo();
  try {
    git(['checkout', '--quiet', '-b', 'feat', base0]);
    const tested = commit('f1.txt', 'one\n', 'feat: one');

    git(['checkout', '--quiet', '-b', 'feat-edited', main1]);
    const edited = commit('f1.txt', 'one edited\n', 'feat: one');
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: edited }),
      false,
    );

    git(['checkout', '--quiet', '-b', 'feat-reworded', main1]);
    const reworded = commit('f1.txt', 'one\n', 'feat: one reworded');
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: reworded }),
      false,
    );

    git(['checkout', '--quiet', '-b', 'feat-extra', main1]);
    commit('f1.txt', 'one\n', 'feat: one');
    const extra = commit('f2.txt', 'two\n', 'feat: two');
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: extra }),
      false,
    );

    git(['checkout', '--quiet', '-b', 'feat-from-main1', main1]);
    const testedOnMain1 = commit('g.txt', 'g\n', 'feat: g');
    git(['checkout', '--quiet', '-b', 'feat-backward', base0]);
    const backward = commit('g.txt', 'g\n', 'feat: g');
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: testedOnMain1, headSha: backward }),
      false,
    );

    git(['checkout', '--quiet', '-b', 'feat-merge', main1]);
    commit('f1.txt', 'one\n', 'feat: one');
    git(['merge', '--quiet', '--no-ff', '-m', 'merge other', other]);
    const merged = git(['rev-parse', 'HEAD']);
    assert.equal(
      isCleanRebaseOf({ cwd, baseRef: main1, testedSha: tested, headSha: merged }),
      false,
    );

    assert.equal(isCleanRebaseOf({ cwd, baseRef: main1, testedSha: main1, headSha: main1 }), false);
  } finally {
    releaseTestTempDir(cwd);
  }
});

test('rebaseOwnerLane returns lane only for Lane trailers, never Amp-Thread-ID or untrailered commits', () => {
  assert.equal(
    rebaseOwnerLane('feat(ci): clean rebase\n\nLane: m-abc/ci-queue\n'),
    'm-abc/ci-queue',
  );
  assert.equal(rebaseOwnerLane('feat(ci): amp commit\n\nAmp-Thread-ID: T-01999999\n'), null);
  assert.equal(
    rebaseOwnerLane('feat(ci): no owner\n\nLane: m-abc/lane\nAmp-Thread-ID: T-01999999\n'),
    null,
  );
  assert.equal(rebaseOwnerLane('feat(ci): plain commit\n'), null);
});
