import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { prepushPlan } from './prepush.mjs';

const cli = resolve('scripts/escape-eval-loop.mjs');
const introduceAt = '2026-09-20T00:00:00Z';
const fixAt = '2026-09-27T00:00:00Z';
const since = '2026-09-26T00:00:00Z';
const until = '2026-09-28T00:00:00Z';
const head = 'a'.repeat(40);
const prefix = 'repos/xiechimon/cairn';

function fixture(t) {
  const fx = {
    cwd: mkdtempSync(join(tmpdir(), 'escape-eval-loop-')),
    git(args, env = {}) {
      return execFileSync('git', args, {
        cwd: this.cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        stdio: 'pipe',
      }).trim();
    },
    commit(message, date, pathOrFiles) {
      const files =
        typeof pathOrFiles === 'string' ? { [pathOrFiles]: message } : { ...pathOrFiles };
      for (const [path, content] of Object.entries(files)) {
        const absolute = join(this.cwd, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content);
        this.git(['add', '--', path]);
      }
      this.git(['commit', '-q', '-m', message], {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      });
      return this.git(['rev-parse', 'HEAD']);
    },
  };
  t.after(() => rmSync(fx.cwd, { recursive: true, force: true }));
  fx.git(['init', '-q']);
  fx.git(['config', 'user.name', 'Escape loop test']);
  fx.git(['config', 'user.email', 'escape-loop@example.invalid']);
  return fx;
}

function installFakeGh(dir, github) {
  writeFileSync(join(dir, 'responses.json'), JSON.stringify(github));
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.REQUEST_LOG, JSON.stringify(args) + '\\n');
if (args.length !== 2 || args[0] !== 'api') process.exit(90);
const responses = JSON.parse(fs.readFileSync(process.env.RESPONSES));
if (!(args[1] in responses)) process.exit(91);
const response = responses[args[1]];
if (response.error) { process.stderr.write(response.error); process.exit(1); }
process.stdout.write(JSON.stringify(response));
`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
}

function githubFor(originalPr) {
  return {
    [`${prefix}/pulls/${originalPr}`]: {
      number: originalPr,
      merged_at: introduceAt,
      head: { sha: head },
      body: 'ai-reviewed human-reviewed',
      html_url: `https://github.com/xiechimon/cairn/pull/${originalPr}`,
    },
    [`${prefix}/pulls/${originalPr}/reviews?per_page=100&page=1`]: [
      {
        user: { login: 'human-reviewer', type: 'User' },
        state: 'APPROVED',
        submitted_at: '2026-09-19T10:00:00Z',
        commit_id: head,
        html_url: `https://github.com/xiechimon/cairn/pull/${originalPr}#pullrequestreview-human`,
        body: '',
      },
    ],
    [`${prefix}/issues/${originalPr}/comments?per_page=100&page=1`]: [],
  };
}

test('escape-eval-loop traces the introducing PR, labels review path, reports weekly, and exports a bank case', (t) => {
  const fx = fixture(t);
  fx.commit('chore: seed', '2026-09-19T00:00:00Z', { 'src/token.txt': 'safe\n' });
  const introducingSha = fx.commit('feat: land broken token path (#100)', introduceAt, {
    'src/token.txt': 'safe\nbroken\n',
  });
  const fixingSha = fx.commit('fix: repair regression introduced by #100 (#201)', fixAt, {
    'src/token.txt': 'safe\nfixed\n',
  });
  fx.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  const out = join(fx.cwd, 'out');
  const bankOut = join(fx.cwd, 'bank');
  const respondPath = join(fx.cwd, 'respond.json');
  writeFileSync(
    respondPath,
    JSON.stringify({
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
    }),
  );
  installFakeGh(fx.cwd, githubFor(100));

  const result = spawnSync(
    process.execPath,
    [
      cli,
      '--since',
      since,
      '--until',
      until,
      '--out',
      out,
      '--bank-out',
      bankOut,
      '--respond-file',
      respondPath,
      '--cwd',
      fx.cwd,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fx.cwd}:${process.env.PATH}`,
        RESPONSES: join(fx.cwd, 'responses.json'),
        REQUEST_LOG: join(fx.cwd, 'requests'),
      },
    },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.candidates, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.exported, 1);
  assert.equal(summary.validation.ok, true);

  const candidates = JSON.parse(readFileSync(join(out, 'candidates.json'), 'utf8'));
  assert.equal(candidates[0].fixingPr, 201);
  assert.ok(!('pr' in candidates[0]));
  assert.ok(!('originatingPr' in candidates[0]));

  const traces = JSON.parse(readFileSync(join(out, 'traces.json'), 'utf8'));
  assert.equal(traces[0].originalPr, 100);
  assert.equal(traces[0].fixingPr, 201);
  assert.equal(traces[0].status, 'resolved');
  assert.equal(traces[0].method, 'explicit-reference');

  const weekly = JSON.parse(readFileSync(join(out, 'weekly-report.json'), 'utf8'));
  assert.equal(weekly.events[0].originalPr, 100);
  assert.equal(weekly.events[0].review.path, 'human-only');
  assert.ok(weekly.weeks.some((week) => week.paths['human-only'].distinctPrs >= 1));
  assert.ok(!('escapeRate' in weekly));
  assert.ok(!('rate' in weekly.totals));

  const text = readFileSync(join(out, 'weekly-report.txt'), 'utf8');
  assert.match(text, /human-only/);
  assert.match(text, /Weekly review escapes/);

  const caseFiles = readdirSync(join(bankOut, 'cases')).filter((name) => name.endsWith('.json'));
  assert.equal(caseFiles.length, 1);
  const bankCase = JSON.parse(readFileSync(join(bankOut, 'cases', caseFiles[0]), 'utf8'));
  assert.equal(bankCase.provenance.originalPr, 100);
  assert.equal(bankCase.provenance.fixingPr, 201);
  assert.equal(bankCase.provenance.introducingSha, introducingSha);
  assert.equal(bankCase.provenance.fixingSha, fixingSha);
  assert.ok(!('defect' in bankCase.reviewerInput));

  const requests = readFileSync(join(fx.cwd, 'requests'), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(requests.some((args) => args[1] === `${prefix}/pulls/100`));
  assert.ok(requests.some((args) => args[1] === `${prefix}/pulls/100/reviews?per_page=100&page=1`));
});

test('scoped Cairn fix subjects enter the loop; incidental revert wording does not', (t) => {
  const fx = fixture(t);
  fx.commit('chore: seed', '2026-09-19T00:00:00Z', { 'a.txt': 'a\n' });
  const introducingSha = fx.commit('feat: ship (#50)', introduceAt, { 'a.txt': 'a\nbad\n' });
  const fixingSha = fx.commit('web(1832): fix crash (#1803)\n\nIntroduced by #50.\n', fixAt, {
    'a.txt': 'a\ngood\n',
  });
  fx.commit('docs: explain how to revert (#204)', fixAt, { 'docs.txt': 'revert guidance\n' });
  fx.git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);

  const out = join(fx.cwd, 'out');
  const respondPath = join(fx.cwd, 'respond.json');
  writeFileSync(
    respondPath,
    JSON.stringify({
      pullsByCommit: {
        [introducingSha]: [{ number: 50, merged_at: introduceAt }],
        [fixingSha]: [{ number: 1803, merged_at: fixAt }],
      },
      refs: {
        50: {
          type: 'pull',
          number: 50,
          merged_at: introduceAt,
          merge_commit_sha: introducingSha,
        },
      },
    }),
  );
  installFakeGh(fx.cwd, githubFor(50));

  const result = spawnSync(
    process.execPath,
    [
      cli,
      '--since',
      since,
      '--until',
      until,
      '--out',
      out,
      '--bank-out',
      join(fx.cwd, 'bank'),
      '--respond-file',
      respondPath,
      '--cwd',
      fx.cwd,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fx.cwd}:${process.env.PATH}`,
        RESPONSES: join(fx.cwd, 'responses.json'),
        REQUEST_LOG: join(fx.cwd, 'requests'),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const candidates = JSON.parse(readFileSync(join(out, 'candidates.json'), 'utf8'));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].fixingPr, 1803);
  const traces = JSON.parse(readFileSync(join(out, 'traces.json'), 'utf8'));
  assert.equal(traces[0].originalPr, 50);
  assert.notEqual(traces[0].originalPr, 1803);
});

test('local and CI prepush plans execute escape-eval-loop tests', () => {
  const step = 'node --test scripts/escape-eval-loop.test.mjs';
  for (const mode of ['local', 'ci']) {
    for (const paths of [
      ['apps/server/src/app.ts'],
      ['scripts/escape-eval-loop.mjs'],
      ['scripts/prepush.mjs'],
    ]) {
      assert.ok(
        prepushPlan(paths, mode)
          .map((args) => args.join(' '))
          .includes(step),
        `${mode} ${paths.join(',')}`,
      );
    }
  }
});

test('CLI rejects missing bounds and unknown arguments', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'escape-eval-loop-cli-'));
  try {
    for (const args of [
      [],
      ['--since', since],
      ['--since', since, '--until', until],
      ['--since', since, '--until', until, '--out', join(cwd, 'o'), '--unknown', 'x'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
      assert.notEqual(result.status, 0, args.join(' '));
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
