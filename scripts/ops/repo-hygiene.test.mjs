import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  changeOnMain,
  classifyBranch,
  classifyCache,
  classifyIssue,
  classifyPackageVersion,
  classifyPreflightRef,
  classifyPullRequest,
  classifyRelease,
  classifyScheduledRun,
  closesCommitsFor,
  liveChecks,
  newestPackageVersion,
  planBoard,
  renderReport,
} from './repo-hygiene.mjs';

function initRepo(t) {
  const cwd = makeTestTempDir('hygiene-');
  t.after(() => releaseTestTempDir(cwd));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Hygiene test');
  git('config', 'user.email', 'hygiene@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  return { cwd, git };
}

test('checks literal Git paths, including glob characters, whitespace, and newlines', (t) => {
  const { cwd, git } = initRepo(t);
  const files = ['a[1].txt', ' trailing ', 'with\nnewline.txt'];
  for (const file of files) writeFileSync(join(cwd, file), 'original');
  git('add', '--all');
  git('commit', '-qm', 'base');
  for (const [i, file] of files.entries()) {
    const branch = `topic-${i}`;
    git('switch', '-qc', branch, 'main');
    writeFileSync(join(cwd, file), 'changed');
    git('add', '--all');
    git('commit', '-qm', 'change');
    assert.equal(changeOnMain('main', branch, cwd), false, file);
  }
  git('switch', '-q', 'main');
  git('cherry-pick', '--no-commit', 'topic-0');
  git('commit', '-qm', 'land equivalent change on main');
  writeFileSync(join(cwd, 'unrelated.txt'), 'on main only');
  git('add', '--all');
  git('commit', '-qm', 'unrelated main change');
  assert.equal(changeOnMain('main', 'topic-0', cwd), true);
  git('revert', '--no-edit', 'topic-0');
  assert.equal(changeOnMain('main', 'topic-0', cwd), false);
  assert.equal(changeOnMain('main', 'missing-topic', cwd), null);
});

test('an unreadable pathname diff is not mistaken for an empty diff', (t) => {
  const { cwd, git } = initRepo(t);
  git('commit', '--allow-empty', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const identity = 'Hygiene test <hygiene@example.invalid> 1700000000 +0000';
  const input = `tree ${'b'.repeat(40)}\nparent ${base}\nauthor ${identity}\ncommitter ${identity}\n\nmissing tree\n`;
  const head = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd,
    input,
    encoding: 'utf8',
  }).trim();
  assert.equal(git('merge-base', 'main', head), base);
  assert.equal(changeOnMain('main', head, cwd), null);
});

test('a rename is not present on main when only the destination exists on both sides', (t) => {
  const { cwd, git } = initRepo(t);
  writeFileSync(join(cwd, 'old.txt'), 'same content');
  git('add', '--all');
  git('commit', '-qm', 'base');
  git('switch', '-qc', 'topic');
  renameSync(join(cwd, 'old.txt'), join(cwd, 'new.txt'));
  git('add', '--all');
  git('commit', '-qm', 'rename');
  git('switch', '-q', 'main');
  writeFileSync(join(cwd, 'new.txt'), 'same content');
  git('add', '--all');
  git('commit', '-qm', 'copy');
  assert.equal(changeOnMain('main', 'topic', cwd), false);
});

// Fixtures mirror the live repo state measured on 2026-11-22.

test('a draft PR is reported and never closed even when its diff is empty', () => {
  assert.equal(
    classifyPullRequest({ isDraft: true, uniqueCommits: 0, changeOnMain: true }).action,
    'report',
  );
});

test('a PR with zero unique patches on main is closed as landed, naming the matching commit', () => {
  const verdict = classifyPullRequest({
    number: 5300,
    title: 'daemon(5299): a fix that already landed',
    mergeable: 'CONFLICTING',
    uniqueCommits: 0,
    changeOnMain: true,
    mainMatchSha: 'deadbeef'.repeat(5),
    linkedIssue: null,
  });
  assert.equal(verdict.action, 'close');
  assert.equal(verdict.kind, 'landed');
  assert.match(verdict.comment, /deadbeef/);
});

test('a PR whose patch-ids are all on main but whose tree differs is reported, not closed (revert case)', () => {
  const verdict = classifyPullRequest({
    number: 5301,
    title: 'daemon(5300): a fix that was reverted on main',
    mergeable: 'MERGEABLE',
    uniqueCommits: 0,
    changeOnMain: false,
    mainMatchSha: null,
    linkedIssue: null,
  });
  assert.equal(verdict.action, 'report');
  assert.match(verdict.reason, /revert/i);
});

test('a PR whose touched files are identical to main and whose issue is closed closes as superseded', () => {
  const verdict = classifyPullRequest({
    number: 5397,
    title: 'daemon(5006): keep Mac sessions from signalling outside their sandbox',
    mergeable: 'CONFLICTING',
    uniqueCommits: 8,
    changeOnMain: true,
    mainMatchSha: null,
    linkedIssue: { number: 5006, state: 'CLOSED', landedSha: '2e6ab61a'.repeat(5) },
  });
  assert.equal(verdict.action, 'close');
  assert.equal(verdict.kind, 'superseded');
  assert.match(verdict.comment, /2e6ab61a/);
});

test('PR #5379 keeps unique commits and is only reported, even though its issue was closed by a different fix', () => {
  const verdict = classifyPullRequest({
    number: 5379,
    title: 'daemon(5378): name the closing commit in English and leave the pre-step dirt alone',
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    uniqueCommits: 1,
    changeOnMain: false,
    mainMatchSha: null,
    linkedIssue: { number: 5378, state: 'CLOSED', landedSha: 'e3e046fa'.repeat(5) },
  });
  assert.equal(verdict.action, 'report');
  assert.match(verdict.reason, /conflict|unique|wanted/i);
});

test('PR #5355 (mergeable, unique commits) is reported, never closed', () => {
  const verdict = classifyPullRequest({
    number: 5355,
    title: 'server(5354): retry length-capped summary calls + Langfuse self-review report',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    uniqueCommits: 2,
    changeOnMain: false,
    mainMatchSha: null,
    linkedIssue: { number: 5354, state: 'CLOSED', landedSha: null },
  });
  assert.equal(verdict.action, 'report');
});

test('PR #5402 (mergeable, unique commits on a closed issue) is reported, never closed', () => {
  const verdict = classifyPullRequest({
    number: 5402,
    title: 'ops(5398): launch batch claude -p sessions with credential env vars scrubbed',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    uniqueCommits: 3,
    changeOnMain: false,
    mainMatchSha: null,
    linkedIssue: { number: 5398, state: 'CLOSED', landedSha: 'ccec4f37'.repeat(5) },
  });
  assert.equal(verdict.action, 'report');
});

test('branch with every patch on main is deleted', () => {
  assert.deepEqual(
    classifyBranch({
      name: 'cairn/conv-01a1f6d7-5ec6-761e-b70e-3abff6fad6aa',
      uniquePatches: 0,
      changeOnMain: true,
      openPr: null,
      closedPr: null,
      liveChecks: false,
      tipAgeDays: 3,
    }),
    { action: 'delete', reason: 'every patch is on main' },
  );
});

test('a closed PR does not permit deletion of a branch with unique commits', () => {
  const verdict = classifyBranch({
    name: 'cairn/conv-01a1fa64-1733-7033-a8b4-7fb37d354a59',
    uniquePatches: 8,
    openPr: null,
    closedPr: 5397,
    liveChecks: false,
    tipAgeDays: 3,
  });
  assert.equal(verdict.action, 'report');
  assert.match(verdict.reason, /#5397/);
});

test('a recent or unreadable branch tip is retained even if its change is on main', () => {
  for (const tipAgeDays of [0.05, null]) {
    assert.notEqual(
      classifyBranch({
        name: 'cairn/conv-01a1fa64-1733-7033-a8b4-7fb37d354a59',
        uniquePatches: 0,
        changeOnMain: true,
        liveChecks: false,
        tipAgeDays,
      }).action,
      'delete',
    );
  }
});

test('unreadable change evidence cannot authorize a close or branch deletion', () => {
  const branch = { name: 'topic', uniquePatches: 0, changeOnMain: null, liveChecks: false };
  assert.equal(classifyPullRequest({ uniqueCommits: 0, changeOnMain: null }).action, 'report');
  assert.equal(classifyBranch({ ...branch, closedPr: 5397, tipAgeDays: 10 }).action, 'report');
  assert.equal(classifyPreflightRef({ ...branch, ageDays: 10 }).action, 'report');
});

test('branch of a merged PR is deleted', () => {
  assert.equal(
    classifyBranch({
      name: 'claude/admiring-darwin-1b506x',
      uniquePatches: 0,
      changeOnMain: true,
      openPr: null,
      closedPr: 5332,
      liveChecks: false,
      tipAgeDays: 3,
    }).action,
    'delete',
  );
});

test('branch with unique commits and no PR is reported, not deleted', () => {
  const verdict = classifyBranch({
    name: 'cairn/conv-01a1edc9-3ce7-7d8b-b169-fa62417a7256',
    uniquePatches: 1,
    openPr: null,
    closedPr: null,
    liveChecks: false,
    tipAgeDays: 10,
  });
  assert.equal(verdict.action, 'report');
  assert.match(verdict.reason, /unique/);
});

test('branch backing an open PR is kept', () => {
  assert.equal(
    classifyBranch({
      name: 'cairn/conv-01a1eec8-844e-7656-a92d-8df4df72c0df',
      uniquePatches: 2,
      openPr: 5355,
      closedPr: null,
      liveChecks: false,
    }).action,
    'keep',
  );
});

test('protected refs and branches with a live ci run are never deleted', () => {
  for (const name of ['main', 'queue/main', 'queue-state/main']) {
    assert.equal(
      classifyBranch({
        name,
        uniquePatches: 0,
        changeOnMain: true,
        openPr: null,
        closedPr: null,
        liveChecks: false,
      }).action,
      'keep',
    );
  }
  assert.equal(
    classifyBranch({
      name: 'rescue/antigravity-acp',
      uniquePatches: 0,
      changeOnMain: true,
      openPr: null,
      closedPr: null,
      liveChecks: true,
    }).action,
    'keep',
  );
});

test('preflight ref under 7 days is kept; over 7 days deletes only when landed; unique old refs are reported', () => {
  assert.equal(
    classifyPreflightRef({
      name: 'preflight/host/eval-fw',
      ageDays: 1.25,
      uniquePatches: 0,
      changeOnMain: true,
      liveChecks: false,
      openPrHead: false,
    }).action,
    'keep',
  );
  assert.equal(
    classifyPreflightRef({
      name: 'preflight/host/old-landed',
      ageDays: 9,
      uniquePatches: 0,
      changeOnMain: true,
      liveChecks: false,
      openPrHead: false,
    }).action,
    'delete',
  );
  assert.equal(
    classifyPreflightRef({
      name: 'preflight/host/old-unique',
      ageDays: 9,
      uniquePatches: 3,
      liveChecks: false,
      openPrHead: false,
    }).action,
    'report',
  );
  assert.equal(
    classifyPreflightRef({
      name: 'preflight/host/pr-head',
      ageDays: 9,
      uniquePatches: 0,
      changeOnMain: true,
      liveChecks: false,
      openPrHead: true,
    }).action,
    'keep',
  );
});

test('only standalone, unquoted Closes lines identify a closing commit', () => {
  const real = 'a'.repeat(40);
  const prose = 'b'.repeat(40);
  const quoted = 'c'.repeat(40);
  const example = 'd'.repeat(40);
  const log = [
    `${prose} Mention Closes #42 as prose\n`,
    `${quoted} Quotation\n\n> Closes #42\n`,
    `${example} Example\n\n\`\`\`\nCloses #42\n\`\`\`\n\nCloses #420\n`,
    `${real} Subject\n\nCloses #42\n`,
  ].join('\0\n');
  assert.deepEqual(closesCommitsFor(42, 'main', log), [real]);
});

test('open issue with a Closes commit on main is closed naming that commit', () => {
  const verdict = classifyIssue({
    number: 5395,
    closesCommits: ['2e6ab61a'.repeat(5)],
    daysSinceUpdate: 1,
    wasReopened: false,
  });
  assert.equal(verdict.action, 'close');
  assert.match(verdict.comment, /2e6ab61a/);
});

test('an issue reopened by a user or with an unreadable timeline is reported, not closed', () => {
  const sha = '2e6ab61a'.repeat(5);
  for (const wasReopened of [true, null, undefined]) {
    const verdict = classifyIssue({
      number: 5400,
      closesCommits: [sha],
      daysSinceUpdate: 1,
      wasReopened,
    });
    assert.equal(verdict.action, 'report');
  }
});

test('issue quiet for over 14 days is flagged, never closed', () => {
  assert.equal(
    classifyIssue({ number: 5327, closesCommits: [], daysSinceUpdate: 20 }).action,
    'flag-stale',
  );
  assert.equal(classifyIssue({ number: 5401, closesCommits: [], daysSinceUpdate: 3 }).action, 'ok');
});

test('board plan adds missing open issues, marks closed Done, removes duplicate drafts, reports the rest', () => {
  const plan = planBoard({
    openIssues: [
      { number: 5360, title: 'goal: claim and drain the un-routed open issue pool' },
      { number: 5401, title: 'daemon: confine task harnesses on Linux' },
      { number: 1836, title: 'chief: zero-context plan review' },
    ],
    boardItems: [
      {
        id: 'item-closed',
        type: 'ISSUE',
        repository: 'xiechimon/cairn',
        number: 5395,
        state: 'CLOSED',
        status: 'Todo',
      },
      {
        id: 'item-open',
        type: 'ISSUE',
        repository: 'xiechimon/cairn',
        number: 1836,
        state: 'OPEN',
        status: 'Todo',
      },
      {
        id: 'item-closed-done',
        type: 'ISSUE',
        repository: 'xiechimon/cairn',
        number: 5369,
        state: 'CLOSED',
        status: 'Done',
      },
      {
        id: 'item-foreign-open',
        type: 'ISSUE',
        repository: 'xiechimon/another',
        number: 77,
        state: 'OPEN',
        status: 'Todo',
      },
      {
        id: 'item-foreign-same-number',
        type: 'ISSUE',
        repository: 'xiechimon/another',
        number: 5360,
        state: 'CLOSED',
        status: 'Todo',
      },
      {
        id: 'item-cairn-open-not-in-list',
        type: 'ISSUE',
        repository: 'xiechimon/cairn',
        number: 99,
        state: 'OPEN',
        status: 'Todo',
      },
      {
        id: 'draft-dup',
        type: 'DRAFT_ISSUE',
        title: 'daemon: confine task harnesses on Linux',
        status: 'Todo',
      },
      {
        id: 'draft-keep',
        type: 'DRAFT_ISSUE',
        title: 'Native iOS client after web settles',
        status: 'Todo',
      },
    ],
  });
  assert.deepEqual(plan.addTodo, [5360, 5401]);
  assert.deepEqual(plan.moveDone, ['item-closed']);
  assert.deepEqual(
    plan.removeDraft.map((d) => d.id),
    ['draft-dup'],
  );
  assert.deepEqual(
    plan.reportDraft.map((d) => d.id),
    ['draft-keep'],
  );
});

test('an empty package version list has no newest version', () => {
  assert.equal(newestPackageVersion([]), null);
});

test('package versions: untagged and old sha tags are pruned; pinned and latest digests kept', () => {
  const referenced = new Set(['sha256:pinned']);
  assert.equal(
    classifyPackageVersion({
      id: 1,
      tags: [],
      digest: 'sha256:unt',
      ageDays: 2,
      latest: false,
      referenced,
    }),
    'delete',
  );
  assert.equal(
    classifyPackageVersion({
      id: 2,
      tags: ['a1b2c3d'],
      digest: 'sha256:old',
      ageDays: 40,
      latest: false,
      referenced,
    }),
    'delete',
  );
  assert.equal(
    classifyPackageVersion({
      id: 3,
      tags: ['e4f5g6h'],
      digest: 'sha256:pinned',
      ageDays: 40,
      latest: false,
      referenced,
    }),
    'keep',
  );
  assert.equal(
    classifyPackageVersion({
      id: 4,
      tags: ['latest'],
      digest: 'sha256:lat',
      ageDays: 40,
      latest: true,
      referenced,
    }),
    'keep',
  );
  assert.equal(
    classifyPackageVersion({
      id: 5,
      tags: ['a1b2c3d'],
      digest: 'sha256:young',
      ageDays: 3,
      latest: false,
      referenced,
    }),
    'keep',
  );
});

test('draft release tags can be deleted only when their absence from live refs is verified', () => {
  assert.equal(classifyRelease({ isDraft: false, ageDays: 100, tagDisposition: 'delete' }), 'keep');
  assert.equal(classifyRelease({ isDraft: true, ageDays: 0.5, tagDisposition: 'delete' }), 'keep');
  assert.equal(classifyRelease({ isDraft: true, ageDays: 2, tagDisposition: 'delete' }), 'delete');
  assert.equal(classifyRelease({ isDraft: true, ageDays: 2, tagDisposition: 'unknown' }), 'report');
  for (const tagDisposition of ['absent', 'keep']) {
    assert.equal(
      classifyRelease({ isDraft: true, ageDays: 2, tagDisposition }),
      'delete-release-only',
    );
  }
});

test('caches on deleted refs are pruned; caches on live refs kept', () => {
  const liveRefs = new Set(['refs/heads/main', 'refs/heads/queue/main']);
  assert.equal(
    classifyCache({ key: 'node-cache-x', ref: 'refs/heads/preflight/h/gone', liveRefs }),
    'delete',
  );
  assert.equal(classifyCache({ key: 'node-cache-y', ref: 'refs/heads/main', liveRefs }), 'keep');
});

test('cache cleanup keeps PR caches when the open-PR list is unreadable, and keeps tag caches', () => {
  assert.equal(classifyCache({ ref: 'refs/pull/999/merge', liveRefs: null }), 'keep');
  assert.equal(classifyCache({ ref: 'refs/tags/desktop-v1.2.3', liveRefs: new Set() }), 'keep');
  assert.equal(classifyCache({ ref: 'refs/pull/999/merge', liveRefs: new Set() }), 'delete');
});

test('a scheduled workflow whose last 3 runs failed is flagged', () => {
  assert.equal(
    classifyScheduledRun({
      name: 'eval-weekly',
      recentConclusions: ['failure', 'failure', 'failure'],
      totalRuns: 3,
    }),
    'flag',
  );
  assert.equal(
    classifyScheduledRun({
      name: 'desktop-release',
      recentConclusions: ['failure', 'success', 'failure'],
      totalRuns: 290,
    }),
    'ok',
  );
  assert.equal(
    classifyScheduledRun({ name: 'eval-weekly', recentConclusions: [], totalRuns: 0 }),
    'report-never-ran',
  );
});

test('report renders judgment items only when asked for the pinned issue body', () => {
  const report = renderReport(
    {
      prs: [
        { number: 5355, title: 'x', verdict: { action: 'report', reason: 'unique commits' } },
        { number: 5300, title: 'y', verdict: { action: 'close', kind: 'landed', comment: 'c' } },
      ],
      issues: {
        open: 6,
        closedNumbers: [5395],
        stale: [],
        uncovered: [5360],
        unlabeled: [],
        byNumber: { 5400: { action: 'report', reason: 'issue timeline unreadable — not closing' } },
      },
      branches: { deleted: ['a'], kept: [], report: ['conv-unique'] },
      board: { addTodo: [5360], moveDone: ['x'], removeDraft: [], reportDraft: [{ title: 'd' }] },
      releases: { report: ['desktop-release run 42 failed on abc1234 (x)'] },
    },
    'issue',
  );
  assert.match(report, /#5355/);
  assert.match(report, /conv-unique/);
  assert.match(report, /#5360/);
  assert.match(report, /#5400 issue timeline unreadable/);
  assert.match(report, /draft “d”/);
  assert.match(report, /desktop-release run 42 failed/);
  assert.doesNotMatch(report, /#5395/);
});

test('liveChecks reads later pages so a still-running check keeps a branch alive', () => {
  const seen = [];
  const live = liveChecks('a'.repeat(40), (args) => {
    seen.push(args.join(' '));
    return [{ check_runs: [{ status: 'completed' }] }, { check_runs: [{ status: 'in_progress' }] }];
  });
  assert.equal(live, true);
  assert.match(seen[0], /--paginate --slurp/);
});

test('liveChecks stays false when every check is done and null when the api fails', () => {
  assert.equal(
    liveChecks('x', () => [{ check_runs: [{ status: 'completed' }] }]),
    false,
  );
  assert.equal(
    liveChecks('x', () => null),
    null,
  );
});
