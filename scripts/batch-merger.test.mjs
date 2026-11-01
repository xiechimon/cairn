import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/batch-merger.mjs');
const policy = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const gatePaths = readFileSync('packages/shared/merge-gate-paths.json', 'utf8');
const head = 'a'.repeat(40);
const required = [
  'check',
  'pack-smoke',
  'e2e-gate',
  'pr-evidence',
  'gates',
  'dead-class-gate',
  'ops-backup-test',
];
const skippable = ['dead-class-gate', 'ops-backup-test'];
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
const defaultComments = [
  {
    id: 1,
    user: { login: 'cairnwright[bot]' },
    body: `<!-- review-gate:${head} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.`,
  },
];
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'batch-merger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = {
    policy,
    gatePaths,
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
const d = JSON.parse(fs.readFileSync(process.env.DATA));
const p = args[1];
const write = args.includes('--method') && p !== 'graphql';
const input = write && args.includes('--input') ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(process.env.CALLS, JSON.stringify(input === null ? args : [...args, input])+'\\n');
if(write) { if(d.writeError) process.exit(1); console.log('{}'); process.exit(0); }
if(args[0] === 'pr') process.exit(0);
if(p === 'graphql') { console.log(JSON.stringify({data:{disablePullRequestAutoMerge:{pullRequest:{number:1}}}})); }

else if(p.includes('/issues?')) { if(d.markerError) process.exit(1); const countFile = process.env.DATA+'.count'; const count = fs.existsSync(countFile) ? Number(fs.readFileSync(countFile,'utf8')) : 0; fs.writeFileSync(countFile,String(count+1)); console.log(JSON.stringify([d.pauseOnSecondLookup && count > 0 ? [{number:4}] : d.issues ?? []])); }
else if(p.includes('/pulls?')) { if(p.includes('state=closed')) { if(d.closedError) process.exit(1); const page = Number(new URL('https://api/'+p).searchParams.get('page') ?? 1); console.log(JSON.stringify(page === 1 ? (d.closed ?? []).map(pr=>({...pr,updated_at:pr.updated_at ?? new Date().toISOString()})) : [])); } else console.log(JSON.stringify([d.pulls])); }
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
if (args[0] === 'show') process.stdout.write(args[1].endsWith('merge-gate-paths.json') ? d.gatePaths : d.policy);
else if (args.includes('--numstat')) process.stdout.write(d.numstatByHead?.[args.at(-1).split('...')[1]] ?? d.numstat);
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
  assert.deepEqual(
    calls.filter((args) => args[0] === 'pr' && args[1] === 'merge'),
    [],
  );
  assert.deepEqual(
    calls.filter(
      (args) =>
        args.includes('--method') &&
        args[1].endsWith('/comments') &&
        JSON.parse(args.at(-1)).body.includes('@mergifyio'),
    ),
    [],
  );
  return {
    result,
    calls,
    queues: result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((decision) => decision.action === 'auto-queue'),
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
  ['recovery label', { pulls: [{ ...pull(), labels: [{ name: 'cairn-recovery' }] }] }],
  ['draft', { pulls: [{ ...pull(), draft: true }] }],
  ['other base', { pulls: [{ ...pull(), base: { ref: 'release' } }] }],
  ['decision label', { pulls: [{ ...pull(), labels: [{ name: 'needs-decision' }] }] }],
  ['head changed', { fresh: { ...pull(), head: { ref: 'B1/work', sha: 'b'.repeat(40) } } }],
])
  test(`${name} prevents queueing`, (t) => {
    const f = fixture(t, data);
    assert.equal(
      f.result.status,
      name === 'marker error' ? 1 : 0,
      f.result.stdout + f.result.stderr,
    );
    assert.equal(f.queues.length, 0);
  });
test('armed batch auto-merge is disarmed even while paused', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), auto_merge: {} }], issues: [{ number: 4 }] });
  assert.ok(f.calls.some((args) => args.includes('pullRequestId=pr1')));
  assert.equal(f.queues.length, 0);
});
test('all green leaves every eligible head to Mergify without writing or merging', (t) => {
  const f = fixture(t, { pulls: [pull(), pull(2)] });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.deepEqual(
    f.queues.map((decision) => decision.pr),
    [1, 2],
  );
  const methodWrites = f.calls.filter((args) => args.includes('--method'));
  assert.equal(methodWrites.length, 2);
  for (const args of methodWrites)
    assert.deepEqual(JSON.parse(args.at(-1)), { labels: ['queue-admit'] });
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
  assert.ok(!f.calls.some((args) => args.includes('graphql') || args.includes('POST')));
  assert.match(f.result.stdout, /would-disarm/);
  assert.equal(f.queues.length, 1);
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
  assert.equal(fixture(t, { checks }).queues.length, 0);
});
const completed = (name, id, conclusion) => ({
  name,
  id,
  head_sha: head,
  status: 'completed',
  conclusion,
  app: { slug: 'github-actions' },
});
test('a red gates run blocks an otherwise green batch', (t) => {
  const checks = required.map((name, id) =>
    completed(name, id, name === 'gates' ? 'failure' : 'success'),
  );
  assert.equal(fixture(t, { checks }).queues.length, 0);
});
test('a docs-only batch with the code-only jobs skipped still merges', (t) => {
  const checks = required.map((name, id) =>
    completed(name, id, skippable.includes(name) ? 'skipped' : 'success'),
  );
  assert.equal(fixture(t, { checks }).queues.length, 1);
});
test('gates skipped is treated like the other must-be-green jobs', (t) => {
  const checks = required.map((name, id) =>
    completed(name, id, name === 'gates' ? 'skipped' : 'success'),
  );
  assert.equal(fixture(t, { checks }).queues.length, 1);
});
test('neutral, cancelled and timed out must-be-green runs block', (t) => {
  for (const conclusion of ['neutral', 'cancelled', 'timed_out']) {
    const checks = required.map((name, id) =>
      completed(name, id, name === 'ops-backup-test' ? conclusion : 'success'),
    );
    assert.equal(fixture(t, { checks }).queues.length, 0);
  }
});
test('a skipped required check still blocks a batch', (t) => {
  const checks = required.map((name, id) =>
    completed(name, id, name === 'pack-smoke' ? 'skipped' : 'success'),
  );
  assert.equal(fixture(t, { checks }).queues.length, 0);
});
test('a missing gates run blocks an otherwise green batch', (t) => {
  const checks = required
    .filter((name) => name !== 'gates')
    .map((name, id) => completed(name, id, 'success'));
  assert.equal(fixture(t, { checks }).queues.length, 0);
});
test('a pause arriving during final validation prevents queueing', (t) => {
  const f = fixture(t, { pauseOnSecondLookup: true });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(f.queues.length, 0);
  assert.match(f.result.stdout, /autonomy-paused/);
});
test('a check API error fails closed', (t) => {
  const f = fixture(t, { checkError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.queues.length, 0);
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
  assert.equal(fixture(t, { checks }).queues.length, 0);
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
  assert.equal(f.queues.length, 0);
});
test('the latest review for this head blocks an older pass', (t) => {
  const comments = ['PASS', 'BLOCK'].map((verdict, id) => ({
    id,
    user: { login: 'cairnwright[bot]' },
    body: `<!-- review-gate:${head} -->\n**Independent review gate: ${verdict}** for \`${head.slice(0, 8)}\`.`,
  }));
  assert.equal(fixture(t, { comments }).queues.length, 0);
});
test('mergify-config exports the admit label the merger writes', async () => {
  const { admitLabel } = await import('./mergify-config.mjs');
  assert.equal(admitLabel, 'queue-admit');
  assert.match(readFileSync('.mergify.yml', 'utf8'), /- label = queue-admit/);
});
const today = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const mergedBatch = (number, mergedAt = today, ref = 'B1/done') => ({
  number,
  head: { ref, sha: 'd'.repeat(40), repo: { full_name: 'owner/repo' } },
  labels: [],
  merged_at: mergedAt,
});
const admitAdds = (f) =>
  writes(f).filter(
    (args) => args[1].endsWith('/labels') && JSON.parse(args.at(-1)).labels.includes('queue-admit'),
  );
const decisions = (f) =>
  f.result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const capped = (f) =>
  decisions(f)
    .filter((decision) => decision.action === 'skip' && decision.reasons.includes('daily-cap'))
    .map((decision) => decision.pr);
const admitted = (number = 1) => ({
  ...pull(number),
  labels: [{ name: 'review-gate' }, { name: 'queue-admit' }],
});
test('the cap admits up to the remaining room and leaves the rest unadmitted', (t) => {
  const f = fixture(t, {
    args: ['--daily-cap', '2'],
    pulls: [pull(1), pull(2)],
    closed: [mergedBatch(50)],
  });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.deepEqual(
    f.queues.map((decision) => decision.pr),
    [1],
  );
  assert.deepEqual(capped(f), [2]);
  const adds = admitAdds(f);
  assert.equal(adds.length, 1);
  assert.equal(adds[0][1], 'repos/owner/repo/issues/1/labels');
});
test('a zero cap admits no batch PR, so none can enter the queue', (t) => {
  const f = fixture(t, { args: ['--daily-cap', '0'], pulls: [pull(1), pull(2)] });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(f.queues.length, 0);
  assert.deepEqual(capped(f), [1, 2]);
  assert.equal(writes(f).length, 0);
});
test('an eligible batch PR the merger has not admitted cannot match the queue rule', () => {
  const config = readFileSync('.mergify.yml', 'utf8');
  for (const rule of config.split('merge_protections_settings:')[0].split('\n  - name: ').slice(1))
    assert.match(rule, / {6}- or:\n {10}- -head ~= \^B\[0-9\]\+\/\n {10}- label = queue-admit\n/);
});
test('an admitted PR keeps its admission without another write and counts against the cap', (t) => {
  const f = fixture(t, { args: ['--daily-cap', '1'], pulls: [admitted(1), pull(2)] });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(writes(f).length, 0);
  assert.deepEqual(
    f.queues.map((decision) => decision.pr),
    [1],
  );
  assert.deepEqual(capped(f), [2]);
});
test('batch PRs merged yesterday do not count against today', (t) => {
  const f = fixture(t, {
    args: ['--daily-cap', '1'],
    closed: [mergedBatch(50, `${yesterday}T23:00:00Z`)],
  });
  assert.equal(f.queues.length, 1, f.result.stdout + f.result.stderr);
  assert.equal(admitAdds(f).length, 1);
});
test('closed unmerged, non-batch and fork PRs do not count', (t) => {
  const f = fixture(t, {
    args: ['--daily-cap', '1'],
    closed: [
      { ...mergedBatch(50), merged_at: null },
      mergedBatch(51, today, 'feature/x'),
      { ...mergedBatch(52), head: { ...mergedBatch(52).head, repo: { full_name: 'fork/repo' } } },
    ],
  });
  assert.equal(f.queues.length, 1, f.result.stdout + f.result.stderr);
});
test('an open admitted batch PR that is not eligible still counts as an admission', (t) => {
  const other = {
    ...admitted(9),
    head: { ...pull().head, ref: 'B2/other', sha: 'e'.repeat(40) },
  };
  const f = fixture(t, { args: ['--daily-cap', '1'], pulls: [other, pull(1)] });
  assert.deepEqual(capped(f), [1]);
  assert.equal(admitAdds(f).length, 0);
});
test('a failed admit write is an error and does not queue', (t) => {
  const f = fixture(t, { args: ['--daily-cap', '1'], pulls: [pull(1)], writeError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.queues.length, 0);
  assert.match(f.result.stdout, /"action":"error"/);
});
test('a closed-PR lookup failure is an error and admits nothing', (t) => {
  const f = fixture(t, { pulls: [pull(1)], closedError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.queues.length, 0);
  assert.equal(writes(f).length, 0);
});
test('dry-run reports admissions without writing', (t) => {
  const f = fixture(t, { args: ['--dry-run', '--daily-cap', '1'], pulls: [pull(1), pull(2)] });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(writes(f).length, 0);
  assert.match(f.result.stdout, /would-admit/);
  assert.deepEqual(capped(f), [2]);
});

for (const carried of [false, true])
  test(`real review-gate PASS authorizes merging (carried over: ${carried})`, (t) => {
    const body = carried
      ? `<!-- review-gate:${head} -->\n**Independent review gate: PASS** (carried over) for \`${head.slice(0, 8)}\`: same patch as the reviewed head \`bbbbbbbb\`; only the base moved.\n<!-- review-gate-patch:patch -->`
      : `<!-- review-gate:${head} -->\n**Independent review gate: PASS** for \`${head.slice(0, 8)}\`.\n<!-- review-gate-patch:patch -->`;
    const f = fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] });
    assert.equal(f.queues.length, 1, f.result.stdout + f.result.stderr);
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
  assert.equal(f.queues.length, 0);
});
test('multi-digit batches are eligible', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), head: { ...pull().head, ref: 'B12/work' } }] });
  assert.equal(f.queues.length, 1, f.result.stdout + f.result.stderr);
});
test('a batch without the review label is skipped', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), labels: [] }] });
  assert.equal(f.queues.length, 0);
  const decision = JSON.parse(f.result.stdout.trim());
  assert.equal(decision.action, 'skip');
  assert.ok(decision.reasons.includes('no-review-label'));
});

test('a BLOCK quoting a PASS line cannot authorize merging', (t) => {
  const body = `<!-- review-gate:${head} -->\n**Independent review gate: BLOCK** for head.\n\n**Independent review gate: PASS** for quoted head.`;
  assert.equal(
    fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] }).queues.length,
    0,
  );
});
test('a prefixed marker cannot authorize merging', (t) => {
  const body = `quoted\n<!-- review-gate:${head} -->\n**Independent review gate: PASS** for head.`;
  assert.equal(
    fixture(t, { comments: [{ id: 1, user: { login: 'cairnwright[bot]' }, body }] }).queues.length,
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
  assert.equal(f.queues.length, 0);
  assert.match(f.result.stdout, /head-repo-mismatch/);
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
  [
    'security surface beside an oversize patch',
    { numstat: `401\t400\tapps/web/src/page.ts\n1\t0\tapps/server/src/services/secrets.ts\n` },
    'protected paths: apps/server/src/services/secrets.ts',
  ],
])
  test(`owner routing blocks ${name}`, (t) => {
    const f = fixture(t, data);
    assert.equal(f.queues.length, 0);
    assert.match(f.result.stdout, /owner-route/);
    assert.ok(f.result.stdout.includes(reason), f.result.stdout);
  });
for (const data of [{ gitError: true }, { policy: 'invalid policy' }, { numstat: 'invalid' }])
  test('unavailable owner routing fails closed', (t) => {
    const f = fixture(t, data);
    assert.equal(f.queues.length, 0);
    assert.match(f.result.stdout, /owner-routing-unavailable/);
  });
test('a patch whose only overflow is docs/verify evidence stays eligible', (t) => {
  const evidence = Array.from(
    { length: 41 },
    (_, i) => `900\t0\tdocs/verify/2371/run-${i}.txt\n`,
  ).join('');
  assert.equal(
    fixture(t, { numstat: `800\t0\tapps/web/src/page.ts\n${evidence}` }).queues.length,
    1,
  );
});
test('an evidence binary stays eligible', (t) => {
  assert.equal(
    fixture(t, { numstat: '1\t0\tapps/web/src/page.ts\n-\t-\tdocs/verify/2371/shot.png\n' }).queues
      .length,
    1,
  );
});
const manyFiles = (n) =>
  Array.from({ length: n }, (_, i) => `1\t0\tapps/web/src/page${i}.ts\n`).join('');
const withoutSizeSection = (data) => ({
  ...data,
  checks: required.map((name, id) => ({
    name,
    id,
    head_sha: head,
    status: 'completed',
    conclusion: name === 'pr-evidence' ? 'failure' : 'success',
    app: { slug: 'github-actions' },
  })),
});
test('product lines beside evidence over the line limit go to the size review, not the owner', (t) => {
  const f = fixture(t, {
    numstat: '401\t400\tapps/web/src/page.ts\n900\t0\tdocs/verify/2371/run.txt\n',
  });
  assert.equal(f.queues.length, 1, f.result.stdout);
  assert.doesNotMatch(f.result.stdout, /owner-route/);
});
test('product files beside evidence over the file limit go to the size review, not the owner', (t) => {
  const f = fixture(t, { numstat: `${manyFiles(41)}1\t0\tdocs/verify/2371/run.txt\n` });
  assert.equal(f.queues.length, 1, f.result.stdout);
  assert.doesNotMatch(f.result.stdout, /owner-route/);
});
test('an oversize patch without the Size section stays blocked by a red pr-evidence', (t) => {
  const f = fixture(t, withoutSizeSection({ numstat: '401\t400\tapps/web/src/page.ts\n' }));
  assert.equal(f.queues.length, 0);
  assert.ok(f.result.stdout.includes('check:pr-evidence'), f.result.stdout);
});
test('an oversize patch with no passing review comment is not queued', (t) => {
  const f = fixture(t, { numstat: manyFiles(41), comments: [] });
  assert.equal(f.queues.length, 0);
  assert.ok(f.result.stdout.includes('review-not-pass'), f.result.stdout);
});
test('clean product source remains eligible', (t) => {
  assert.equal(fixture(t).queues.length, 1);
});

test('an owner-routed head is labelled and never queued', (t) => {
  const f = fixture(t, { numstat: '1\t0\tdocs/adr/0028.md\n' });
  assert.equal(f.queues.length, 0);
  assert.ok(f.calls.some((args) => args[1] === 'repos/owner/repo/issues/1/labels'));
});

const marker = `<!-- batch-merger-owner-route:${head} -->`;
const ownerRouted = { numstat: '1\t0\tdocs/adr/0028.md\n' };
const writes = (f) => f.calls.filter((args) => args.includes('--method'));
const ownerComments = (f) => writes(f).filter((args) => args[1].endsWith('/issues/1/comments'));
const labelAdds = (f) => writes(f).filter((args) => args[1].endsWith('/issues/1/labels'));
const labelRemovals = (f) => writes(f).filter((args) => args.includes('DELETE'));
const markerComment = (sha = head) => ({
  id: 7,
  user: { login: 'cairnwright[bot]' },
  body: `<!-- batch-merger-owner-route:${sha} -->\nOwner route`,
});
const labelled = [{ name: 'review-gate' }, { name: 'owner-route' }];

test('an owner-routed head gets one marked comment with reasons and the label', (t) => {
  const f = fixture(t, ownerRouted);
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(f.queues.length, 0);
  const comments = ownerComments(f);
  assert.equal(comments.length, 1);
  const payload = JSON.parse(comments[0].at(-1));
  assert.ok(payload.body.startsWith(marker));
  assert.ok(payload.body.includes('protected paths: docs/adr/0028.md'));
  const adds = labelAdds(f);
  assert.equal(adds.length, 1);
  assert.deepEqual(JSON.parse(adds[0].at(-1)), { labels: ['owner-route'] });
});
test('a second pass on the same head does not comment again', (t) => {
  const f = fixture(t, {
    ...ownerRouted,
    comments: [markerComment(), ...defaultComments],
    pulls: [{ ...pull(), labels: labelled }],
  });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(writes(f).length, 0);
  assert.match(f.result.stdout, /owner-route/);
});
test('an already commented head missing the label only gets the label', (t) => {
  const f = fixture(t, { ...ownerRouted, comments: [markerComment(), ...defaultComments] });
  assert.equal(ownerComments(f).length, 0);
  assert.equal(labelAdds(f).length, 1);
});
test('a new head gets a new comment', (t) => {
  const f = fixture(t, {
    ...ownerRouted,
    comments: [markerComment('c'.repeat(40)), ...defaultComments],
    pulls: [{ ...pull(), labels: labelled }],
  });
  assert.equal(ownerComments(f).length, 1);
  assert.equal(labelAdds(f).length, 0);
});
test('a PR that is no longer owner-routed loses the label before queueing', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), labels: labelled }] });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  const removals = labelRemovals(f);
  assert.equal(removals.length, 1);
  assert.ok(removals[0].includes('repos/owner/repo/issues/1/labels/owner-route'));
  assert.equal(f.queues.length, 1);
  const actions = f.result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).action);
  assert.ok(actions.indexOf('unmarked-owner-route') < actions.indexOf('auto-queue'));
});
test('a failed label removal blocks the merge', (t) => {
  const f = fixture(t, { pulls: [{ ...pull(), labels: labelled }], writeError: true });
  assert.equal(f.result.status, 1);
  assert.equal(f.queues.length, 0);
  assert.match(f.result.stdout, /"action":"error"/);
});
test('a PR without the label is not unlabelled', (t) => {
  assert.equal(labelRemovals(fixture(t)).length, 0);
});
test('a failed owner-route comment is an error and never merges', (t) => {
  const f = fixture(t, { ...ownerRouted, writeError: true, pulls: [pull(), pull(2)] });
  assert.equal(f.result.status, 1);
  assert.equal(f.queues.length, 0);
  assert.match(f.result.stdout, /"action":"error"/);
});
test('a human-queue PR is marked owner-route while other ready work is queued', (t) => {
  const other = 'b'.repeat(40);
  const second = { ...pull(2), head: { ...pull(2).head, sha: other } };
  const checksAt = (sha) =>
    required.map((name, id) => ({
      name,
      id: id + (sha === head ? 0 : 100),
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      app: { slug: 'github-actions' },
    }));
  const f = fixture(t, {
    pulls: [pull(), second],
    checks: [...checksAt(head), ...checksAt(other)],
    comments: [
      ...defaultComments,
      {
        id: 2,
        user: { login: 'cairnwright[bot]' },
        body: `<!-- review-gate:${other} -->\n**Independent review gate: PASS** for \`${other.slice(0, 8)}\`.`,
      },
    ],
    numstatByHead: { [head]: '1\t0\tapps/server/src/services/oauth.ts\n' },
  });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.deepEqual(
    f.queues.map((q) => q.pr),
    [2],
  );
  const payload = JSON.parse(ownerComments(f)[0].at(-1));
  assert.ok(payload.body.includes('human queue (credentials): apps/server/src/services/oauth.ts'));
  assert.deepEqual(JSON.parse(labelAdds(f)[0].at(-1)), { labels: ['owner-route'] });
});
test('dry-run reports the owner-route mark without writing', (t) => {
  const f = fixture(t, { ...ownerRouted, args: ['--dry-run'] });
  assert.equal(f.result.status, 0, f.result.stdout + f.result.stderr);
  assert.equal(writes(f).length, 0);
  assert.match(f.result.stdout, /would-mark-owner-route/);
});
