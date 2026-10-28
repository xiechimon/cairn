import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { collectCandidates, parseDiffGitPaths, resolveTraces } from './escape-trace.mjs';
import { prepushPlan } from './prepush.mjs';

const cli = resolve('scripts/escape-trace.mjs');
const start = '2026-10-01T00:00:00Z';
const end = '2026-10-02T00:00:00Z';
const day = 24 * 60 * 60 * 1000;

function fixture(t, prefix = 'escape-candidates-') {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
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
  const run = (...args) =>
    spawnSync(process.execPath, [cli, '--since', start, '--until', end, ...args], {
      cwd,
      encoding: 'utf8',
    });
  return {
    cwd,
    git,
    run,
    commit(message, date = start, pathOrFiles = 'file.txt') {
      const files =
        typeof pathOrFiles === 'string' ? { [pathOrFiles]: message } : { ...pathOrFiles };
      for (const [path, content] of Object.entries(files)) {
        const absolute = join(cwd, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
        git(['add', '--', path]);
      }
      git(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      return git(['rev-parse', 'HEAD']);
    },
    runArgs(args, opts = {}) {
      return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', ...opts });
    },
  };
}

function isoPlus(base, ms) {
  return new Date(new Date(base).getTime() + ms).toISOString().replace(/\.000Z$/, 'Z');
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
  const { cwd, git, run } = fixture(t);
  writeFileSync(join(cwd, 'file.txt'), 'bulk\n');
  git(['add', '--', 'file.txt']);
  const tree = git(['write-tree']);
  let parent = null;
  for (let i = 0; i < 205; i++) {
    const args = parent
      ? ['commit-tree', tree, '-p', parent, '-m', `fix: repair ${i}`]
      : ['commit-tree', tree, '-m', `fix: repair ${i}`];
    parent = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: start,
        GIT_COMMITTER_DATE: start,
        GIT_AUTHOR_NAME: 'Candidate test',
        GIT_AUTHOR_EMAIL: 'candidate@example.invalid',
        GIT_COMMITTER_NAME: 'Candidate test',
        GIT_COMMITTER_EMAIL: 'candidate@example.invalid',
      },
    }).trim();
  }
  git(['update-ref', 'HEAD', parent]);
  git(['update-ref', 'refs/remotes/origin/main', parent]);
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

test('fix: repair regression introduced by #100 (#201) resolves origin PR 100 and fixing PR 201', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-explicit-');
  const introduceAt = '2026-09-20T00:00:00Z';
  const fixAt = '2026-09-27T00:00:00Z';
  const introducingSha = commit('feat: land broken token path (#100)', introduceAt, {
    'token.txt': 'broken\n',
  });
  const fixingSha = commit('fix: repair regression introduced by #100 (#201)', fixAt, {
    'token.txt': 'fixed\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-09-26T00:00:00Z',
    until: '2026-09-28T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 100, merged_at: introduceAt }],
      [fixingSha]: [{ number: 201, merged_at: fixAt }],
    },
    refs: {
      100: {
        type: 'pull',
        number: 100,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
      201: {
        type: 'pull',
        number: 201,
        merged_at: fixAt,
        merge_commit_sha: fixingSha,
      },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.originalPr, 100);
  assert.equal(trace.fixingPr, 201);
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.fixingSha, fixingSha);
  assert.equal(trace.method, 'explicit-reference');
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.withinEscapeWindow, true);
  assert.equal(trace.introducingMergedAt, new Date(introduceAt).toISOString());
  assert.equal(trace.followUpTimestamp, new Date(fixAt).toISOString());
  assert.ok(trace.evidence.references.some((ref) => ref.number === 100));
  assert.ok(
    trace.evidence.files.some(
      (file) => file.path === 'token.txt' && file.lines.some((range) => range.start >= 1),
    ),
  );
});

test('a revert body resolves to the reverted commit and its PR', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-revert-');
  const introduceAt = '2026-09-10T00:00:00Z';
  const fixAt = '2026-09-12T00:00:00Z';
  const introducingSha = commit('feat: broken feature (#50)', introduceAt, {
    'feature.txt': 'bad\n',
  });
  const fixingSha = commit(
    `Revert "feat: broken feature"\n\nThis reverts commit ${introducingSha}.\n`,
    fixAt,
    { 'feature.txt': '' },
  );
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-09-11T00:00:00Z',
    until: '2026-09-13T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 50, merged_at: introduceAt }],
    },
    refs: {
      50: {
        type: 'pull',
        number: 50,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.method, 'revert-body');
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.fixingSha, fixingSha);
  assert.equal(trace.originalPr, 50);
  assert.equal(trace.withinEscapeWindow, true);
  assert.ok(
    trace.evidence.files.some(
      (file) => file.path === 'feature.txt' && file.lines.some((range) => range.start >= 1),
    ),
  );
});

test('Fixes #N where N is an issue keeps an unvalidated reference with reason issue-not-pr', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-fixes-issue-');
  const introduceAt = '2026-09-01T00:00:00Z';
  const fixAt = '2026-09-05T00:00:00Z';
  const introducingSha = commit('feat: ship defect (#80)', introduceAt, {
    'bug.txt': 'line\n',
  });
  commit('fix: repair defect\n\nFixes #77.\n', fixAt, { 'bug.txt': 'line-fixed\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-09-04T00:00:00Z',
    until: '2026-09-06T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 80, merged_at: introduceAt }],
    },
    refs: {
      77: { type: 'issue', number: 77 },
      80: {
        type: 'pull',
        number: 80,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.ok(
    trace.evidence.unvalidatedReferences.some(
      (ref) => ref.number === 77 && ref.reason === 'issue-not-pr',
    ),
  );
  assert.notEqual(trace.originalPr, 77);
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.originalPr, 80);
  assert.equal(trace.status, 'resolved');
});

test('blame on the parent: the changed line last commit is the introducing commit', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-blame-');
  const introduceAt = '2026-08-01T00:00:00Z';
  const fixAt = '2026-08-08T00:00:00Z';
  const introducingSha = commit('feat: add buggy line (#90)', introduceAt, {
    'src/app.txt': 'alpha\nBUG\nomega\n',
  });
  const fixingSha = commit('fix: correct buggy line (#91)', fixAt, {
    'src/app.txt': 'alpha\nGOOD\nomega\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-08-07T00:00:00Z',
    until: '2026-08-09T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 90, merged_at: introduceAt }],
      [fixingSha]: [{ number: 91, merged_at: fixAt }],
    },
    refs: {
      90: {
        type: 'pull',
        number: 90,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
      91: {
        type: 'pull',
        number: 91,
        merged_at: fixAt,
        merge_commit_sha: fixingSha,
      },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.fixingSha, fixingSha);
  assert.equal(trace.originalPr, 90);
  assert.equal(trace.fixingPr, 91);
  assert.ok(
    trace.evidence.files.some(
      (file) =>
        file.path === 'src/app.txt' &&
        file.lines.some((range) => range.start <= 2 && range.end >= 2),
    ),
  );
});

test('blame split across two commits yields multiple-origin, not a guess', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-multi-');
  const firstAt = '2026-07-01T00:00:00Z';
  const secondAt = '2026-07-02T00:00:00Z';
  const fixAt = '2026-07-05T00:00:00Z';
  const firstSha = commit('feat: first defect (#11)', firstAt, {
    'multi.txt': 'A\nkeep\n',
  });
  const secondSha = commit('feat: second defect (#12)', secondAt, {
    'multi.txt': 'A\nkeep\nB\n',
  });
  commit('fix: repair both defects (#13)', fixAt, { 'multi.txt': 'X\nkeep\nY\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-07-04T00:00:00Z',
    until: '2026-07-06T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [firstSha]: [{ number: 11, merged_at: firstAt }],
      [secondSha]: [{ number: 12, merged_at: secondAt }],
    },
    refs: {},
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'multiple-origin');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.originalPr, null);
  assert.equal(trace.introducingSha, null);
  assert.deepEqual([...trace.evidence.introducingCandidates].sort(), [firstSha, secondSha].sort());
});

test('shallow history yields unresolved with a reason', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-shallow-');
  const introduceAt = '2026-06-01T00:00:00Z';
  const fixAt = '2026-06-03T00:00:00Z';
  commit('feat: buried defect (#40)', introduceAt, { 'deep.txt': 'old\n' });
  const fixingSha = commit('fix: patch without trail (#41)', fixAt, { 'deep.txt': 'new\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const bare = mkdtempSync(join(tmpdir(), 'escape-shallow-clone-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  git(['clone', '--depth', '1', `file://${cwd}`, bare]);
  execFileSync('git', ['remote', 'rename', 'origin', 'upstream'], { cwd: bare });
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: bare });
  const candidates = [
    {
      followUpSha: fixingSha,
      timestamp: new Date(fixAt).toISOString(),
      message: 'fix: patch without trail (#41)\n',
      paths: ['deep.txt'],
      fixingPr: 41,
    },
  ];
  const [trace] = resolveTraces(candidates, {
    cwd: bare,
    responder: { pullsByCommit: {}, refs: {} },
  });
  assert.equal(trace.status, 'unresolved');
  assert.ok(trace.unresolvedReason);
  assert.match(trace.unresolvedReason, /shallow|history|blame|parent/i);
});

test('exactly 14 days qualifies; 14 days plus one second does not', (t) => {
  const introduceAt = '2026-05-01T00:00:00Z';
  const edgeAt = isoPlus(introduceAt, 14 * day);
  const lateAt = isoPlus(introduceAt, 14 * day + 1000);

  const edge = fixture(t, 'escape-window-edge-');
  const edgeIntroducingSha = edge.commit('feat: timed defect (#60)', introduceAt, {
    'timed.txt': 'bad\n',
  });
  edge.commit('fix: edge window (#61)', edgeAt, { 'timed.txt': 'edge\n' });
  edge.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const edgeResponder = {
    pullsByCommit: {
      [edgeIntroducingSha]: [{ number: 60, merged_at: introduceAt }],
    },
    refs: {
      60: {
        type: 'pull',
        number: 60,
        merged_at: introduceAt,
        merge_commit_sha: edgeIntroducingSha,
      },
    },
  };
  const [edgeTrace] = resolveTraces(
    collectCandidates({
      since: isoPlus(edgeAt, -day),
      until: isoPlus(edgeAt, day),
      cwd: edge.cwd,
    }),
    { cwd: edge.cwd, responder: edgeResponder },
  );
  assert.equal(edgeTrace.status, 'resolved');
  assert.equal(edgeTrace.withinEscapeWindow, true);

  const late = fixture(t, 'escape-window-late-');
  const lateIntroducingSha = late.commit('feat: timed defect (#60)', introduceAt, {
    'timed.txt': 'bad\n',
  });
  late.commit('fix: late window (#62)', lateAt, { 'timed.txt': 'late\n' });
  late.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const lateResponder = {
    pullsByCommit: {
      [lateIntroducingSha]: [{ number: 60, merged_at: introduceAt }],
    },
    refs: {
      60: {
        type: 'pull',
        number: 60,
        merged_at: introduceAt,
        merge_commit_sha: lateIntroducingSha,
      },
    },
  };
  const [lateTrace] = resolveTraces(
    collectCandidates({
      since: isoPlus(lateAt, -day),
      until: isoPlus(lateAt, day),
      cwd: late.cwd,
    }),
    { cwd: late.cwd, responder: lateResponder },
  );
  assert.equal(lateTrace.status, 'outside-window');
  assert.equal(lateTrace.withinEscapeWindow, false);
  assert.equal(lateTrace.originalPr, 60);
  assert.equal(lateTrace.introducingSha, lateIntroducingSha);
});

test('an introducing merge before --since is still resolvable', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-before-since-');
  const introduceAt = '2026-04-01T00:00:00Z';
  const fixAt = '2026-04-10T00:00:00Z';
  const introducingSha = commit('feat: early defect (#70)', introduceAt, {
    'early.txt': 'bad\n',
  });
  commit('fix: repair early defect introduced by #70 (#71)', fixAt, {
    'early.txt': 'good\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const since = '2026-04-09T00:00:00Z';
  assert.ok(new Date(introduceAt).getTime() < new Date(since).getTime());
  const candidates = collectCandidates({
    since,
    until: '2026-04-11T00:00:00Z',
    cwd,
  });
  assert.equal(candidates.length, 1);
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 70, merged_at: introduceAt }],
    },
    refs: {
      70: {
        type: 'pull',
        number: 70,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
      71: { type: 'pull', number: 71, merged_at: fixAt },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.originalPr, 70);
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.introducingMergedAt, new Date(introduceAt).toISOString());
});

test('each resolved trace has immutable shas, PRs, method, timestamps and file/line evidence', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-shape-');
  const introduceAt = '2026-03-01T00:00:00Z';
  const fixAt = '2026-03-04T00:00:00Z';
  const introducingSha = commit('feat: shape defect (#30)', introduceAt, {
    'shape.txt': 'one\n',
  });
  const fixingSha = commit('fix: shape repair (#31)', fixAt, { 'shape.txt': 'two\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-03-03T00:00:00Z',
    until: '2026-03-05T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 30, merged_at: introduceAt }],
      [fixingSha]: [{ number: 31, merged_at: fixAt }],
    },
    refs: {
      30: {
        type: 'pull',
        number: 30,
        merged_at: introduceAt,
        merge_commit_sha: introducingSha,
      },
    },
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  for (const key of [
    'introducingSha',
    'fixingSha',
    'originalPr',
    'fixingPr',
    'method',
    'introducingMergedAt',
    'followUpTimestamp',
  ])
    assert.notEqual(trace[key], null, key);
  assert.equal(typeof trace.introducingSha, 'string');
  assert.equal(trace.introducingSha.length, 40);
  assert.equal(trace.fixingSha, fixingSha);
  assert.ok(Array.isArray(trace.evidence.files));
  assert.ok(trace.evidence.files.length > 0);
  assert.ok(trace.evidence.files[0].lines.length > 0);
});

test('candidates subcommand pipes into trace through the CLI with a recorded responder', (t) => {
  const { cwd, git, commit, runArgs } = fixture(t, 'escape-cli-pipe-');
  const introduceAt = '2026-02-01T00:00:00Z';
  const fixAt = '2026-02-05T00:00:00Z';
  const introducingSha = commit('feat: pipe defect (#20)', introduceAt, {
    'pipe.txt': 'bad\n',
  });
  commit('fix: repair regression introduced by #20 (#21)', fixAt, { 'pipe.txt': 'good\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const respondFile = join(cwd, 'respond.json');
  writeFileSync(
    respondFile,
    JSON.stringify({
      pullsByCommit: {
        [introducingSha]: [{ number: 20, merged_at: introduceAt }],
      },
      refs: {
        20: {
          type: 'pull',
          number: 20,
          merged_at: introduceAt,
          merge_commit_sha: introducingSha,
        },
        21: { type: 'pull', number: 21, merged_at: fixAt },
      },
    }),
  );
  const candidates = runArgs([
    'candidates',
    '--since',
    '2026-02-04T00:00:00Z',
    '--until',
    '2026-02-06T00:00:00Z',
  ]);
  assert.equal(candidates.status, 0, candidates.stderr);
  const traced = runArgs(['trace', '--respond-file', respondFile], {
    input: candidates.stdout,
  });
  assert.equal(traced.status, 0, traced.stderr);
  const [trace] = JSON.parse(traced.stdout);
  assert.equal(trace.originalPr, 20);
  assert.equal(trace.fixingPr, 21);
  assert.equal(trace.method, 'explicit-reference');
  assert.equal(trace.status, 'resolved');
});

test('blame resolves quotePath-quoted paths that contain a tab and newline', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-quoted-path-');
  const oddPath = 'tab\tand\nline.txt';
  const introduceAt = '2026-01-10T00:00:00Z';
  const fixAt = '2026-01-12T00:00:00Z';
  const introducingSha = commit('feat: odd path defect (#301)', introduceAt, {
    [oddPath]: 'broken\n',
  });
  const fixingSha = commit('fix: repair odd path (#302)', fixAt, { [oddPath]: 'fixed\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const header = execFileSync(
    'git',
    ['diff', '--unified=0', `${introducingSha}`, fixingSha, '--', oddPath],
    { cwd, encoding: 'utf8' },
  ).split('\n', 1)[0];
  assert.match(header, /^diff --git "/);
  const candidates = collectCandidates({
    since: '2026-01-11T00:00:00Z',
    until: '2026-01-13T00:00:00Z',
    cwd,
  });
  assert.deepEqual(candidates[0].paths, [oddPath]);
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 301, merged_at: introduceAt }],
      [fixingSha]: [{ number: 302, merged_at: fixAt }],
    },
    refs: {},
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.originalPr, 301);
  assert.ok(
    trace.evidence.files.some(
      (file) => file.path === oddPath && file.lines.some((range) => range.start === 1),
    ),
  );
});

test('blame keeps separate origins when only one changed path is quotePath-quoted', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-mixed-quote-');
  const oddPath = 'tab\tand\nline.txt';
  const firstAt = '2026-01-01T00:00:00Z';
  const secondAt = '2026-01-02T00:00:00Z';
  const fixAt = '2026-01-04T00:00:00Z';
  const firstSha = commit('feat: ordinary defect (#311)', firstAt, {
    'ordinary.txt': 'A\n',
  });
  const secondSha = commit('feat: quoted defect (#312)', secondAt, {
    'ordinary.txt': 'A\n',
    [oddPath]: 'B\n',
  });
  commit('fix: repair ordinary and quoted (#313)', fixAt, {
    'ordinary.txt': 'X\n',
    [oddPath]: 'Y\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2026-01-03T00:00:00Z',
    until: '2026-01-05T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [firstSha]: [{ number: 311, merged_at: firstAt }],
      [secondSha]: [{ number: 312, merged_at: secondAt }],
    },
    refs: {},
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'multiple-origin');
  assert.equal(trace.method, 'blame');
  assert.deepEqual([...trace.evidence.introducingCandidates].sort(), [firstSha, secondSha].sort());
  assert.ok(trace.evidence.files.some((file) => file.path === 'ordinary.txt'));
  assert.ok(trace.evidence.files.some((file) => file.path === oddPath));
});

test('missing PR metadata stays unresolved with unavailable-pr-metadata', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-no-pr-meta-');
  const introduceAt = '2025-12-01T00:00:00Z';
  const fixAt = '2025-12-03T00:00:00Z';
  const introducingSha = commit('feat: orphan defect', introduceAt, {
    'orphan.txt': 'bad\n',
  });
  commit('fix: repair orphan defect (#401)', fixAt, { 'orphan.txt': 'good\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const candidates = collectCandidates({
    since: '2025-12-02T00:00:00Z',
    until: '2025-12-04T00:00:00Z',
    cwd,
  });
  const [trace] = resolveTraces(candidates, {
    cwd,
    responder: { pullsByCommit: {}, refs: {} },
  });
  assert.equal(trace.status, 'unresolved');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.equal(trace.originalPr, null);
  assert.equal(trace.unresolvedReason, 'unavailable-pr-metadata');
});

test('parseDiffGitPaths decodes Git octal escapes as UTF-8 bytes', () => {
  assert.deepEqual(parseDiffGitPaths('diff --git "a/\\303\\251.txt" "b/\\303\\251.txt"'), {
    a: 'é.txt',
    b: 'é.txt',
  });
  assert.notEqual(
    parseDiffGitPaths('diff --git "a/\\303\\251.txt" "b/\\303\\251.txt"').a,
    'Ã©.txt',
  );
});

test('parseDiffGitPaths keeps unquoted paths that contain spaces', () => {
  assert.deepEqual(parseDiffGitPaths('diff --git a/space name.txt b/space name.txt'), {
    a: 'space name.txt',
    b: 'space name.txt',
  });
  assert.notEqual(parseDiffGitPaths('diff --git a/space name.txt b/space name.txt').a, 'space');
});

test('parseDiffGitPaths accepts rename headers with one quoted path and one unquoted path', () => {
  assert.deepEqual(parseDiffGitPaths('diff --git "a/tab\\tname.txt" b/plain.txt'), {
    a: 'tab\tname.txt',
    b: 'plain.txt',
  });
  assert.deepEqual(parseDiffGitPaths('diff --git a/plain.txt "b/tab\\tname.txt"'), {
    a: 'plain.txt',
    b: 'tab\tname.txt',
  });
  assert.deepEqual(parseDiffGitPaths('diff --git "a/tab\\tname.txt" b/space name.txt'), {
    a: 'tab\tname.txt',
    b: 'space name.txt',
  });
  assert.deepEqual(parseDiffGitPaths('diff --git a/space name.txt "b/tab\\tname.txt"'), {
    a: 'space name.txt',
    b: 'tab\tname.txt',
  });
});

test('blame resolves a UTF-8 path emitted as Git octal escapes', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-utf8-octal-');
  const utfPath = 'é.txt';
  const introduceAt = '2025-11-01T00:00:00Z';
  const fixAt = '2025-11-03T00:00:00Z';
  const introducingSha = commit('feat: utf8 path defect (#321)', introduceAt, {
    [utfPath]: 'broken\n',
  });
  const fixingSha = commit('fix: repair utf8 path (#322)', fixAt, { [utfPath]: 'fixed\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const header = execFileSync(
    'git',
    ['-c', 'core.quotepath=true', 'diff', '--unified=0', introducingSha, fixingSha, '--', utfPath],
    { cwd, encoding: 'buffer', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
  )
    .toString('latin1')
    .split('\n', 1)[0];
  assert.match(header, /\\303\\251/);
  assert.deepEqual(parseDiffGitPaths(header), { a: utfPath, b: utfPath });
  const candidates = collectCandidates({
    since: '2025-11-02T00:00:00Z',
    until: '2025-11-04T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 321, merged_at: introduceAt }],
      [fixingSha]: [{ number: 322, merged_at: fixAt }],
    },
    refs: {},
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.ok(trace.evidence.files.some((file) => file.path === utfPath));
});

test('blame resolves an unquoted path that contains spaces', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-space-path-');
  git(['config', 'core.quotePath', 'false']);
  const spacePath = 'space name.txt';
  const introduceAt = '2025-10-01T00:00:00Z';
  const fixAt = '2025-10-03T00:00:00Z';
  const introducingSha = commit('feat: space path defect (#331)', introduceAt, {
    [spacePath]: 'broken\n',
  });
  const fixingSha = commit('fix: repair space path (#332)', fixAt, { [spacePath]: 'fixed\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const header = execFileSync(
    'git',
    [
      '-c',
      'core.quotepath=false',
      'diff',
      '--unified=0',
      introducingSha,
      fixingSha,
      '--',
      spacePath,
    ],
    { cwd, encoding: 'utf8' },
  ).split('\n', 1)[0];
  assert.equal(header, 'diff --git a/space name.txt b/space name.txt');
  assert.deepEqual(parseDiffGitPaths(header), { a: spacePath, b: spacePath });
  const candidates = collectCandidates({
    since: '2025-10-02T00:00:00Z',
    until: '2025-10-04T00:00:00Z',
    cwd,
  });
  const responder = {
    pullsByCommit: {
      [introducingSha]: [{ number: 331, merged_at: introduceAt }],
      [fixingSha]: [{ number: 332, merged_at: fixAt }],
    },
    refs: {},
  };
  const [trace] = resolveTraces(candidates, { cwd, responder });
  assert.equal(trace.status, 'resolved');
  assert.equal(trace.method, 'blame');
  assert.equal(trace.introducingSha, introducingSha);
  assert.ok(trace.evidence.files.some((file) => file.path === spacePath));
});
