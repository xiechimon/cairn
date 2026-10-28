import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { exportCases, validateCases } from './escape-trace.mjs';
import { prepushPlan } from './prepush.mjs';

const cli = resolve('scripts/escape-trace.mjs');
const start = '2026-10-01T00:00:00Z';
const end = '2026-10-02T00:00:00Z';
const bankRoot = resolve('integration/eval/review');

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
  function commit(message, date = start, files = { 'file.txt': message }) {
    if (typeof files === 'string') {
      const path = files;
      writeFileSync(join(cwd, path), message);
      git(['add', '--', path]);
    } else {
      for (const [path, contents] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), contents);
        git(['add', '--', path]);
      }
    }
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
    const plan = prepushPlan(['scripts/escape-trace.mjs'], mode);
    const step = plan.find((args) => args.includes('scripts/escape-trace.test.mjs'));
    assert.deepEqual(step, ['node', '--test', 'scripts/escape-trace.test.mjs']);
    const validate = plan.find(
      (args) => args[1] === 'scripts/escape-trace.mjs' && args[2] === 'validate-cases',
    );
    assert.deepEqual(validate, [
      'node',
      'scripts/escape-trace.mjs',
      'validate-cases',
      'integration/eval/review/cases',
    ]);
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

function resolvedTrace({
  introducingSha,
  fixingSha,
  originalPr,
  fixingPr,
  path,
  start,
  end,
  method = 'blame',
  introduceAt = '2026-09-20T00:00:00.000Z',
  fixAt = '2026-09-27T00:00:00.000Z',
  status = 'resolved',
  unresolvedReason = null,
}) {
  return {
    followUpSha: fixingSha,
    fixingSha,
    followUpTimestamp: fixAt,
    fixingPr,
    introducingSha,
    introducingMergedAt: introduceAt,
    originalPr,
    method,
    status,
    unresolvedReason,
    withinEscapeWindow: status === 'resolved' ? true : status === 'outside-window' ? false : null,
    evidence: {
      paths: [path],
      files: [{ path, lines: start == null ? [] : [{ start, end }] }],
      references: originalPr ? [{ kind: 'introduced-by', number: originalPr }] : [],
      unvalidatedReferences: [],
      introducingCandidates: [],
    },
  };
}

test('a controlled introduce/fix history exports one case that validates and replays', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-export-replay-');
  const introduceAt = '2026-09-20T00:00:00Z';
  const fixAt = '2026-09-27T00:00:00Z';
  commit('chore: seed', '2026-09-19T00:00:00Z', { 'src/token.txt': 'safe\n' });
  const introducingSha = commit('feat: land broken token path (#100)', introduceAt, {
    'src/token.txt': 'safe\nbroken\n',
  });
  const fixingSha = commit('fix: repair regression introduced by #100 (#201)', fixAt, {
    'src/token.txt': 'safe\nfixed\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const first = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 100,
        fixingPr: 201,
        path: 'src/token.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(first.exported.length, 1);
  assert.equal(first.candidates.length, 0);
  const casePath = join(out, 'cases', `${first.exported[0].id}.json`);
  const bankCase = JSON.parse(readFileSync(casePath, 'utf8'));
  assert.equal(bankCase.version, 1);
  assert.equal(bankCase.provenance.introducingSha, introducingSha);
  assert.equal(bankCase.provenance.fixingSha, fixingSha);
  assert.equal(bankCase.provenance.originalPr, 100);
  assert.equal(bankCase.provenance.fixingPr, 201);
  assert.equal(bankCase.answer.defect.path, 'src/token.txt');
  assert.equal(bankCase.answer.defect.startLine, 2);
  assert.equal(bankCase.answer.defect.endLine, 2);
  assert.ok(!('defect' in bankCase.reviewerInput));
  assert.ok(!('location' in bankCase.reviewerInput));
  assert.ok(!('correction' in bankCase.reviewerInput));
  assert.ok(!('labels' in bankCase.reviewerInput));
  const validation = validateCases(join(out, 'cases'), { cwd });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const replayBase = bankCase.provenance.replayBase;
  assert.equal(replayBase, git(['rev-parse', `${introducingSha}^`]));
  const work = mkdtempSync(join(tmpdir(), 'escape-replay-work-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', cwd, work], { encoding: 'utf8' });
  execFileSync('git', ['checkout', '--quiet', '--detach', replayBase], {
    cwd: work,
    encoding: 'utf8',
  });
  assert.equal(readFileSync(join(work, 'src/token.txt'), 'utf8'), 'safe\n');
  const patchPath = join(work, 'introducing.patch');
  writeFileSync(
    patchPath,
    execFileSync('git', ['diff', '--binary', replayBase, introducingSha], {
      cwd,
      encoding: 'utf8',
    }),
  );
  execFileSync('patch', ['-p1', '--batch', '--forward', '-i', patchPath], {
    cwd: work,
    encoding: 'utf8',
  });
  const lines = readFileSync(join(work, 'src/token.txt'), 'utf8').split('\n');
  assert.equal(lines[1], 'broken');
});

test('unresolved, conflicting or multiple-origin traces go to a separate candidates file, never the verified bank', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-export-candidates-');
  const introduceAt = '2026-09-01T00:00:00Z';
  const fixAt = '2026-09-05T00:00:00Z';
  const introducingSha = commit('feat: ship defect (#80)', introduceAt, {
    'bug.txt': 'line\n',
  });
  const fixingSha = commit('fix: repair defect (#81)', fixAt, { 'bug.txt': 'line-fixed\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const result = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 80,
        fixingPr: 81,
        path: 'bug.txt',
        start: 1,
        end: 1,
        status: 'unresolved',
        unresolvedReason: 'unavailable-pr-metadata',
      }),
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: null,
        fixingPr: 81,
        path: 'bug.txt',
        start: 1,
        end: 1,
        status: 'multiple-origin',
      }),
      {
        ...resolvedTrace({
          introducingSha,
          fixingSha,
          originalPr: 80,
          fixingPr: 81,
          path: 'bug.txt',
          start: 1,
          end: 1,
          status: 'outside-window',
        }),
        withinEscapeWindow: false,
      },
    ],
    outDir: out,
    cwd,
  });
  assert.equal(result.exported.length, 0);
  assert.equal(result.candidates.length, 3);
  assert.equal(readdirSync(join(out, 'cases')).filter((name) => name.endsWith('.json')).length, 0);
  const candidates = JSON.parse(readFileSync(join(out, 'candidates.json'), 'utf8'));
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((entry) => typeof entry.ineligibleReason === 'string'));
});

test('missing provenance, an invalid line range, or a replay base not in history fails validation', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-validate-bad-');
  const introduceAt = '2026-08-01T00:00:00Z';
  const fixAt = '2026-08-08T00:00:00Z';
  commit('chore: seed', '2026-07-31T00:00:00Z', { 'src/app.txt': 'alpha\n' });
  const introducingSha = commit('feat: add buggy line (#90)', introduceAt, {
    'src/app.txt': 'alpha\nBUG\nomega\n',
  });
  const fixingSha = commit('fix: correct buggy line (#91)', fixAt, {
    'src/app.txt': 'alpha\nGOOD\nomega\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const good = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 90,
        fixingPr: 91,
        path: 'src/app.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(good.exported.length, 1);
  const casePath = join(out, 'cases', `${good.exported[0].id}.json`);
  const bankCase = JSON.parse(readFileSync(casePath, 'utf8'));
  bankCase.provenance.replayBase = '0000000000000000000000000000000000000000';
  writeFileSync(casePath, `${JSON.stringify(bankCase, null, 2)}\n`);
  const missingReplay = validateCases(join(out, 'cases'), { cwd });
  assert.equal(missingReplay.ok, false);
  assert.ok(missingReplay.errors.some((error) => /replay base|not in history/i.test(error)));

  bankCase.provenance.replayBase = git(['rev-parse', `${introducingSha}^`]);
  bankCase.answer.defect.startLine = 99;
  bankCase.answer.defect.endLine = 99;
  writeFileSync(casePath, `${JSON.stringify(bankCase, null, 2)}\n`);
  const badLine = validateCases(join(out, 'cases'), { cwd });
  assert.equal(badLine.ok, false);
  assert.ok(badLine.errors.some((error) => /line|location|range/i.test(error)));

  delete bankCase.provenance.introducingSha;
  bankCase.answer.defect.startLine = 2;
  bankCase.answer.defect.endLine = 2;
  writeFileSync(casePath, `${JSON.stringify(bankCase, null, 2)}\n`);
  const missingProv = validateCases(join(out, 'cases'), { cwd });
  assert.equal(missingProv.ok, false);
});

test('exporting twice is byte-identical and never duplicates a case for the same origin PR, fix and location', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-export-dedupe-');
  const introduceAt = '2026-07-01T00:00:00Z';
  const fixAt = '2026-07-05T00:00:00Z';
  commit('chore: seed', '2026-06-30T00:00:00Z', { 'dup.txt': 'keep\n' });
  const introducingSha = commit('feat: defect (#11)', introduceAt, { 'dup.txt': 'keep\nbad\n' });
  const fixingSha = commit('fix: repair (#12)', fixAt, { 'dup.txt': 'keep\ngood\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const traces = [
    resolvedTrace({
      introducingSha,
      fixingSha,
      originalPr: 11,
      fixingPr: 12,
      path: 'dup.txt',
      start: 2,
      end: 2,
    }),
    resolvedTrace({
      introducingSha,
      fixingSha,
      originalPr: 11,
      fixingPr: 12,
      path: 'dup.txt',
      start: 2,
      end: 2,
    }),
  ];
  const first = exportCases({ traces, outDir: out, cwd });
  const second = exportCases({ traces, outDir: out, cwd });
  assert.equal(first.exported.length, 1);
  assert.equal(second.exported.length, 1);
  assert.equal(first.exported[0].id, second.exported[0].id);
  const casePath = join(out, 'cases', `${first.exported[0].id}.json`);
  assert.equal(readFileSync(casePath, 'utf8'), readFileSync(casePath, 'utf8'));
  const firstBytes = readFileSync(casePath);
  exportCases({ traces, outDir: out, cwd });
  assert.deepEqual(readFileSync(casePath), firstBytes);
  assert.equal(readdirSync(join(out, 'cases')).filter((name) => name.endsWith('.json')).length, 1);
});

test('the reviewer-input object contains no defect label, location or correction', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-export-input-');
  const introduceAt = '2026-06-01T00:00:00Z';
  const fixAt = '2026-06-04T00:00:00Z';
  commit('chore: seed', '2026-05-31T00:00:00Z', { 'x.txt': 'a\n' });
  const introducingSha = commit('feat: bad (#1)', introduceAt, { 'x.txt': 'a\nbad\n' });
  const fixingSha = commit('fix: good (#2)', fixAt, { 'x.txt': 'a\ngood\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const result = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 1,
        fixingPr: 2,
        path: 'x.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  const bankCase = JSON.parse(
    readFileSync(join(out, 'cases', `${result.exported[0].id}.json`), 'utf8'),
  );
  for (const key of ['defect', 'location', 'correction', 'labels', 'answer', 'knownCorrection'])
    assert.equal(key in bankCase.reviewerInput, false);
  assert.ok(typeof bankCase.reviewerInput.diff === 'string');
  assert.ok(bankCase.reviewerInput.diff.includes('bad'));
  assert.ok(typeof bankCase.answer.correction === 'string');
  assert.ok(Array.isArray(bankCase.answer.labels));
});

test('validate-cases CLI accepts the empty bank and refuses a leaking reviewer-input case', (t) => {
  const empty = spawnSync(
    process.execPath,
    [cli, 'validate-cases', join(bankRoot, 'cases')],
    { encoding: 'utf8' },
  );
  assert.equal(empty.status, 0, empty.stderr);
  const { cwd, git, commit } = fixture(t, 'escape-validate-cli-');
  const introduceAt = '2026-05-01T00:00:00Z';
  const fixAt = '2026-05-03T00:00:00Z';
  commit('chore: seed', '2026-04-30T00:00:00Z', { 'y.txt': 'a\n' });
  const introducingSha = commit('feat: leak (#3)', introduceAt, { 'y.txt': 'a\nleak\n' });
  const fixingSha = commit('fix: seal (#4)', fixAt, { 'y.txt': 'a\nseal\n' });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const result = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 3,
        fixingPr: 4,
        path: 'y.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  const casePath = join(out, 'cases', `${result.exported[0].id}.json`);
  const bankCase = JSON.parse(readFileSync(casePath, 'utf8'));
  bankCase.reviewerInput.correction = 'do not leak';
  writeFileSync(casePath, `${JSON.stringify(bankCase, null, 2)}\n`);
  const leaking = spawnSync(
    process.execPath,
    [cli, 'validate-cases', join(out, 'cases'), '--cwd', cwd],
    { encoding: 'utf8' },
  );
  assert.notEqual(leaking.status, 0);
  assert.match(`${leaking.stderr}\n${leaking.stdout}`, /reviewerInput|correction|leak/i);
});

test('export maps fixing-parent line ranges back through intervening inserts to the introducing tree', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-map-intervening-');
  commit('chore: seed', '2026-04-01T00:00:00Z', { 'drift.txt': 'alpha\n' });
  const introducingSha = commit('feat: land bug (#40)', '2026-04-02T00:00:00Z', {
    'drift.txt': 'alpha\nBUG\nomega\n',
  });
  commit('chore: insert above bug', '2026-04-03T00:00:00Z', {
    'drift.txt': 'alpha\nINSERT\nBUG\nomega\n',
  });
  const fixingSha = commit('fix: repair drifted bug (#41)', '2026-04-04T00:00:00Z', {
    'drift.txt': 'alpha\nINSERT\nGOOD\nomega\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const result = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 40,
        fixingPr: 41,
        path: 'drift.txt',
        start: 3,
        end: 3,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(result.exported.length, 1, JSON.stringify(result.candidates));
  const bankCase = JSON.parse(
    readFileSync(join(out, 'cases', `${result.exported[0].id}.json`), 'utf8'),
  );
  assert.equal(bankCase.answer.defect.path, 'drift.txt');
  assert.equal(bankCase.answer.defect.startLine, 2);
  assert.equal(bankCase.answer.defect.endLine, 2);
  assert.ok(result.exported[0].id.includes('L2-2'));
});

test('export maps a renamed path at the fixing parent back to the introducing path and lines', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-map-rename-');
  commit('chore: seed', '2026-03-01T00:00:00Z', { 'old/name.txt': 'keep\n' });
  const introducingSha = commit('feat: bug in old path (#50)', '2026-03-02T00:00:00Z', {
    'old/name.txt': 'keep\nbad\n',
  });
  mkdirSync(join(cwd, 'new'), { recursive: true });
  git(['mv', 'old/name.txt', 'new/name.txt']);
  git(['commit', '-q', '-m', 'refactor: rename path'], {
    GIT_AUTHOR_DATE: '2026-03-03T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-03-03T00:00:00Z',
  });
  writeFileSync(join(cwd, 'new/name.txt'), 'keep\ngood\n');
  git(['add', '--', 'new/name.txt']);
  git(['commit', '-q', '-m', 'fix: repair after rename (#51)'], {
    GIT_AUTHOR_DATE: '2026-03-04T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-03-04T00:00:00Z',
  });
  const fixingSha = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const result = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 50,
        fixingPr: 51,
        path: 'new/name.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(result.exported.length, 1, JSON.stringify(result.candidates));
  const bankCase = JSON.parse(
    readFileSync(join(out, 'cases', `${result.exported[0].id}.json`), 'utf8'),
  );
  assert.equal(bankCase.answer.defect.path, 'old/name.txt');
  assert.equal(bankCase.answer.defect.startLine, 2);
  assert.equal(bankCase.answer.defect.endLine, 2);
});

test('newline-terminated blobs do not admit an extra phantom line in export or validate', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-linecount-');
  commit('chore: seed', '2026-02-01T00:00:00Z', { 'count.txt': 'one\n' });
  const introducingSha = commit('feat: two lines (#60)', '2026-02-02T00:00:00Z', {
    'count.txt': 'one\ntwo\n',
  });
  const fixingSha = commit('fix: touch two (#61)', '2026-02-03T00:00:00Z', {
    'count.txt': 'one\ntwo-fixed\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const phantom = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 60,
        fixingPr: 61,
        path: 'count.txt',
        start: 3,
        end: 3,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(phantom.exported.length, 0);
  assert.ok(
    phantom.candidates.some((entry) => /line|range|map/i.test(entry.ineligibleReason)),
  );
  const good = exportCases({
    traces: [
      resolvedTrace({
        introducingSha,
        fixingSha,
        originalPr: 60,
        fixingPr: 61,
        path: 'count.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(good.exported.length, 1);
  const casePath = join(out, 'cases', `${good.exported[0].id}.json`);
  const bankCase = JSON.parse(readFileSync(casePath, 'utf8'));
  bankCase.answer.defect.startLine = 3;
  bankCase.answer.defect.endLine = 3;
  writeFileSync(casePath, `${JSON.stringify(bankCase, null, 2)}\n`);
  const validation = validateCases(join(out, 'cases'), { cwd });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => /line|range|blob/i.test(error)));
});

test('successive exports preserve existing cases and only upsert matching identities', (t) => {
  const { cwd, git, commit } = fixture(t, 'escape-preserve-');
  commit('chore: seed', '2026-01-01T00:00:00Z', {
    'a.txt': 'a\n',
    'b.txt': 'b\n',
  });
  const introA = commit('feat: defect a (#70)', '2026-01-02T00:00:00Z', {
    'a.txt': 'a\nbad-a\n',
    'b.txt': 'b\n',
  });
  const introB = commit('feat: defect b (#71)', '2026-01-03T00:00:00Z', {
    'a.txt': 'a\nbad-a\n',
    'b.txt': 'b\nbad-b\n',
  });
  const fixA = commit('fix: repair a (#72)', '2026-01-04T00:00:00Z', {
    'a.txt': 'a\ngood-a\n',
    'b.txt': 'b\nbad-b\n',
  });
  const fixB = commit('fix: repair b (#73)', '2026-01-05T00:00:00Z', {
    'a.txt': 'a\ngood-a\n',
    'b.txt': 'b\ngood-b\n',
  });
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const out = join(cwd, 'review');
  const first = exportCases({
    traces: [
      resolvedTrace({
        introducingSha: introA,
        fixingSha: fixA,
        originalPr: 70,
        fixingPr: 72,
        path: 'a.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(first.exported.length, 1);
  const firstId = first.exported[0].id;
  const firstBytes = readFileSync(join(out, 'cases', `${firstId}.json`));
  const second = exportCases({
    traces: [
      {
        followUpSha: fixB,
        fixingSha: fixB,
        followUpTimestamp: '2026-01-05T00:00:00.000Z',
        fixingPr: 73,
        introducingSha: null,
        introducingMergedAt: null,
        originalPr: null,
        method: null,
        status: 'unresolved',
        unresolvedReason: 'unavailable-pr-metadata',
        withinEscapeWindow: null,
        evidence: {
          paths: ['b.txt'],
          files: [],
          references: [],
          unvalidatedReferences: [],
          introducingCandidates: [],
        },
      },
    ],
    outDir: out,
    cwd,
  });
  assert.equal(second.exported.length, 0);
  assert.ok(second.candidates.length >= 1);
  assert.deepEqual(readFileSync(join(out, 'cases', `${firstId}.json`)), firstBytes);
  const third = exportCases({
    traces: [
      resolvedTrace({
        introducingSha: introB,
        fixingSha: fixB,
        originalPr: 71,
        fixingPr: 73,
        path: 'b.txt',
        start: 2,
        end: 2,
      }),
    ],
    outDir: out,
    cwd,
  });
  assert.equal(third.exported.length, 1);
  const names = readdirSync(join(out, 'cases')).filter((name) => name.endsWith('.json')).sort();
  assert.equal(names.length, 2);
  assert.ok(names.includes(`${firstId}.json`));
  assert.ok(names.includes(`${third.exported[0].id}.json`));
  assert.deepEqual(readFileSync(join(out, 'cases', `${firstId}.json`)), firstBytes);
});
