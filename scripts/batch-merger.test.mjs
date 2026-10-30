import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/batch-merger.mjs');
const policy = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const head = 'a'.repeat(40);
const required = ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence'];
const pull = (number = 1) => ({
  number,
  node_id: `pr${number}`,
  state: 'open',
  title: 'Batch work',
  head: { ref: 'B1/work', sha: head, repo: { full_name: 'owner/repo' } },
  base: { ref: 'main' },
  labels: [{ name: 'review-gate' }],
  draft: false,
  auto_merge: null,
});
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-merger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = {
    policy,
    numstat: '1\t0\tapps/web/src/page.ts\n',
    deleted: '',
    pulls: [pull()],
    checks: required.map((name, id) => ({
      name,
      id,
      head_sha: head,
      status: 'completed',
      conclusion: 'success',
      app: { slug: 'github-actions' },
    })),
    comments: [
      {
        id: 1,
        user: { login: 'cairnwright[bot]' },
        body: `<!-- review-gate:${head} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.`,
      },
    ],
    commits: [{ sha: head, commit: { message: 'Subject\n\ncloses #42' } }],
    ...overrides,
  };
  writeFileSync(join(dir, 'data'), JSON.stringify(data));
  writeFileSync(
    join(dir, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args)+'\\n');
const d = JSON.parse(fs.readFileSync(process.env.DATA));
const p = args[1];
if(args[0] === 'pr') process.exit(d.mergeError ? 1 : 0);
if(p === 'graphql') { console.log(JSON.stringify({data:{disablePullRequestAutoMerge:{pullRequest:{number:1}}}})); }

else if(p.includes('/issues?')) { if(d.markerError) process.exit(1); const countFile = process.env.DATA+'.count'; const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile,'utf8')) : 0; fs.writeFileSync(countFile,String(count+1)); console.log(JSON.stringify([d.pauseOnSecondLookup && count > 0 ? [{number:4}] : d.issues ?? []])); }
else if(p.includes('/pulls?')) { if(p.includes('state=closed')) { if(d.closedError) process.exit(1); console.log(JSON.stringify(d.closedPages?.[Number(new URL('https://api/'+p).searchParams.get('page') ?? 1)-1] ?? (d.closed ?? []).map(pr=>({...pr,updated_at:pr.updated_at ?? new Date().toISOString()})))); } else console.log(JSON.stringify([d.pulls])); }
else if(p.includes('/check-runs')) { if(d.checkError) process.exit(1); console.log(JSON.stringify([{check_runs:d.checks}])); }
else if(p.endsWith('/comments?per_page=100')) console.log(JSON.stringify([d.comments]));
else if(p.endsWith('/commits?per_page=100')) console.log(JSON.stringify([d.commits]));
else if(p.includes('/pulls/')) console.log(JSON.stringify(Number(p.split('/').at(-1)) >= 100 ? d.closed[Number(p.split('/').at(-1))-100] : d.fresh ?? d.pulls.find(pr=>pr.number === Number(p.split('/').at(-1)))));
else process.exit(2);
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, 'git'),
    `#!${process.execPath}
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.env.DATA));
const args = process.argv.slice(2);
if (d.gitError) process.exit(1);
if (args[0] === 'show') process.stdout.write(d.policy);
else if (args.includes('--numstat')) process.stdout.write(d.numstat);
else if (args.includes('--diff-filter=D')) process.stdout.write(d.deleted);
else process.exit(2);
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script, ...(overrides.args ?? [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      DATA: join(dir, 'data'),
      CALLS: join(dir, 'calls'),
    },
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
  } catch {}
  return {
    result,
    calls,
    merges: calls.filter((args) => args[0] === 'pr' && !args.includes('--disable-auto')),
  };
}
for (const [name, data] of [
  ['pause marker', { issues: [{ number: 4 }] }],
  ['marker error', { markerError: true }],
  [
    'red check',
    {
      checks: required.map((name, id) => ({
        name,
        id,
        head_sha: head,
        status: 'completed',
        conclusion: 'failure',
        app: { slug: 'github-actions' },
      })),
    },
  ],
  ['missing check', { checks: [] }],
  [
    'older review',
    {
      comments: [
        {
          id: 1,
          user: { login: 'cairnwright[bot]' },
          body: `<!-- review-gate:${'b'.repeat(40)} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.`,
        },
      ],
    },
  ],
  [
    'cap reached',
    { args: ['--daily-cap', '1'], closed: [{ ...pull(), merged_at: new Date().toISOString() }] },
  ],
  ['recovery label', { pulls: [{ ...pull(), labels: [{ name: 'cairn-recovery' }] }] }],
  ['draft', { pulls: [{ ...pull(), draft: true }] }],
  ['other base', { pulls: [{ ...pull(), base: { ref: 'release' } }] }],
  ['decision label', { pulls: [{ ...pull(), labels: [{ name: 'needs-decision' }] }] }],
  ['head changed', { fresh: { ...pull(), head: { ref: 'B1/work', sha: 'b'.repeat(40) } } }],
])
  test(`${name} prevents merging`, (t) => {
    const f = fixture(t, data);
    assert.equal(
      f.result.status,
      name === 'marker error' ? 1 : 0,
      f.result.stdout + f.result.stderr,
    );
    assert.equal(f.merges.length, 0);
  });
test('armed batch auto-merge is disarmed even while paused', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), auto_merge: {} }], issues: [{ number: 4 }] });
  assert.ok(f.calls.some((args) => args.includes('pullRequestId=pr1')));
  assert.equal(f.merges.length, 0);
});
test('all green merges exactly one current head and preserves commit bodies', (t) => {
  const f = fixture(t, { pulls: [pull(), pull(2)] });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.merges.length, 1);
  const args = f.merges[0];
  assert.equal(args[args.indexOf('--match-head-commit') + 1], head);
  assert.equal(args[args.indexOf('--subject') + 1], 'Batch work (#1)');
  assert.equal(args[args.indexOf('--body') + 1], 'closes #42');
  assert.ok(f.calls.filter((args) => args[1]?.includes('/issues?')).length >= 2);
});
test('non-batch branches are ignored entirely', (t) => {
  const f = fixture(t, {
    pulls: ['feature/work', 'B/work'].map((ref) => ({
      ...pull(),
      head: { ref, sha: head },
      auto_merge: {},
    })),
  });
  assert.equal(f.calls.length, 1);
});
test('dry-run writes nothing', (t) => {
  const f = fixture(t, { args: ['--dry-run'], pulls: [{ ...pull(), auto_merge: {} }] });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.merges.length, 0);
  assert.ok(!f.calls.some((args) => args.includes('graphql') || args.includes('POST')));
  assert.match(f.result.stdout, /would-merge/);
});
test('latest required run wins over an older success', (t) => {
  const checks = required.map((name, id) => ({
    name,
    id,
    head_sha: head,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
  }));
  checks.push({ ...checks[0], id: 100, conclusion: 'failure' });
  assert.equal(fixture(t, { checks }).merges.length, 0);
});
test('a pause arriving during final validation prevents merging', (t) => {
  const f = fixture(t, { pauseOnSecondLookup: true });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.merges.length, 0);
  assert.match(f.result.stdout, /autonomy-paused/);
});
test('a check API error fails closed', (t) => {
  const f = fixture(t, { checkError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.merges.length, 0);
});
test('checks from another app cannot authorize a merge', (t) => {
  const checks = required.map((name, id) => ({
    name,
    id,
    head_sha: head,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'other-app' },
  }));
  assert.equal(fixture(t, { checks }).merges.length, 0);
});
test('an untrusted review author cannot authorize a merge', (t) => {
  const f = fixture(t, {
    comments: [
      {
        id: 1,
        user: { login: 'other-user' },
        body: `<!-- review-gate:${head} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.`,
      },
    ],
  });
  assert.equal(f.merges.length, 0);
});
test('the latest review for this head blocks an older pass', (t) => {
  const comments = ['PASS', 'BLOCK'].map((verdict, id) => ({
    id,
    user: { login: 'cairnwright[bot]' },
    body: `<!-- review-gate:${head} -->\n**Independent review gate: ${verdict}** for \`${head.slice(0, 8)}\`.`,
  }));
  assert.equal(fixture(t, { comments }).merges.length, 0);
});
test('a failed merge is not retried on another PR', (t) => {
  const f = fixture(t, { mergeError: true, pulls: [pull(), pull(2)] });
  assert.equal(f.result.status, 1);
  assert.equal(f.merges.length, 1);
});
test('merged non-batch and previous-day PRs do not consume the cap', (t) => {
  const f = fixture(t, {
    args: ['--daily-cap', '1'],
    closed: [
      { ...pull(), merged_at: '2000-01-01T00:00:00Z' },
      { ...pull(), head: { ref: 'feature/work' }, merged_at: new Date().toISOString() },
    ],
  });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.merges.length, 1);
});

test('closed PR lookup errors fail closed', (t) => {
  const f = fixture(t, { closedError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.merges.length, 0);
});

for (const carried of [false, true])
  test(`real review-gate PASS authorizes merging (carried over: ${carried})`, (t) => {
    const body = carried
      ? `<!-- review-gate:${head} -->\n**Independent review gate: PASS** (carried over) for \`${head.slice(0, 8)}\`: same patch as the reviewed head \`bbbbbbbb\`; only the base moved.\n<!-- review-gate-patch:patch -->`
      : `<!-- review-gate:${head} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.\n<!-- review-gate-patch:patch -->`;
    const f = fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] });
    assert.equal(f.merges.length, 1, f.result.stdout + f.result.stderr);
  });
test('legacy verdict text does not authorize merging', (t) => {
  const f = fixture(t, {
    comments: [
      {
        id: 1,
        user: { login: 'cairnwright[bot]' },
        body: `<!-- review-gate:${head} -->\nVERDICT: pass`,
      },
    ],
  });
  assert.equal(f.merges.length, 0);
});
test('multi-digit batches are eligible', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), head: { ...pull().head, ref: 'B12/work' } }] });
  assert.equal(f.merges.length, 1, f.result.stdout + f.result.stderr);
});
test('multi-digit merged batches consume the cap', (t) => {
  const f = fixture(t, {
    args: ['--daily-cap', '1'],
    closed: [
      { ...pull(), head: { ...pull().head, ref: 'B12/work' }, merged_at: new Date().toISOString() },
    ],
  });
  assert.equal(f.merges.length, 0);
  assert.match(f.result.stdout, /daily-cap/);
});
test('a batch without the review label is skipped', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), labels: [] }] });
  assert.equal(f.merges.length, 0);
  const decision = JSON.parse(f.result.stdout.trim());
  assert.equal(decision.action, 'skip');
  assert.ok(decision.reasons.includes('no-review-label'));
});

test('a BLOCK quoting a PASS line cannot authorize merging', (t) => {
  const body = `<!-- review-gate:${head} -->\n**Independent review gate: BLOCK** for head.\n\n**Independent review gate: PASS** for quoted head.`;
  assert.equal(
    fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] }).merges.length,
    0,
  );
});
test('a prefixed marker cannot authorize merging', (t) => {
  const body = `quoted\n<!-- review-gate:${head} -->\n**Independent review gate: PASS** for head.`;
  assert.equal(
    fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] }).merges.length,
    0,
  );
});
test('fork batch branches are ignored before disarming', (t) => {
  const f = fixture(t, {
    pulls: [
      {
        ...pull(),
        head: { ...pull().head, ref: 'B1/x', repo: { full_name: 'fork/repo' } },
        auto_merge: {},
      },
    ],
  });
  assert.equal(f.calls.length, 1);
});
test('a fresh fork head fails eligibility', (t) => {
  const f = fixture(t, {
    fresh: { ...pull(), head: { ...pull().head, ref: 'B1/x', repo: { full_name: 'fork/repo' } } },
  });
  assert.equal(f.merges.length, 0);
  assert.match(f.result.stdout, /head-repo-mismatch/);
});
test('closed PR pages count recent merges and stop at an older update', (t) => {
  const today = new Date().toISOString();
  const recent = { ...pull(), updated_at: today, merged_at: today };
  const f = fixture(t, {
    args: ['--daily-cap', '101'],
    closedPages: [
      Array.from({ length: 100 }, () => recent),
      Array.from({ length: 100 }, (_, index) =>
        index === 0 ? recent : { ...pull(), updated_at: '2000-01-01T00:00:00Z', merged_at: null },
      ),
    ],
  });
  assert.equal(f.merges.length, 0);
  assert.match(f.result.stdout, /daily-cap/);
  const paths = f.calls.map((args) => args[1]);
  assert.ok(paths.some((path) => path?.includes('state=closed&sort=updated&direction=desc')));
  assert.ok(paths.some((path) => path?.endsWith('page=2')));
  assert.ok(!paths.some((path) => path?.endsWith('page=3') || path?.startsWith('search/')));
});

for (const [name, data, reason] of [
  ['protected path', { numstat: '1\t0\tdocs/adr/0028.md\n' }, 'protected paths'],
  ['outside set', { numstat: '1\t0\tREADME.md\n' }, 'outside the auto-merge set'],
  [
    'deleted test',
    { numstat: '0\t1\tapps/web/src/page.test.ts\n', deleted: 'apps/web/src/page.test.ts\n' },
    'deleted test files',
  ],
  [
    'binary source',
    { numstat: '-\t-\tapps/web/src/page.ts\n' },
    'binary files outside docs/verify',
  ],
  ['line limit', { numstat: '401\t400\tapps/web/src/page.ts\n' }, '801 lines changed'],
  [
    'file limit',
    { numstat: Array.from({ length: 41 }, (_, i) => `1\t0\tapps/web/src/page${i}.ts\n`).join('') },
    '41 files changed',
  ],
])
  test(`owner routing blocks ${name}`, (t) => {
    const f = fixture(t, data);
    assert.equal(f.merges.length, 0);
    assert.match(f.result.stdout, /owner-route/);
    assert.ok(f.result.stdout.includes(reason), f.result.stdout);
  });
for (const data of [{ gitError: true }, { policy: 'invalid policy' }, { numstat: 'invalid' }])
  test('unavailable owner routing fails closed', (t) => {
    const f = fixture(t, data);
    assert.equal(f.merges.length, 0);
    assert.match(f.result.stdout, /owner-routing-unavailable/);
  });
test('clean product source remains eligible', (t) => {
  assert.equal(fixture(t).merges.length, 1);
});
