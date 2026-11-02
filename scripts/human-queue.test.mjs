import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/human-queue.mjs');
const policy = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const gatePaths = readFileSync('packages/shared/merge-gate-paths.json', 'utf8');
const hour = 3_600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const sha = (c) => c.repeat(40);

const pull = (number, { created = hour, labels = [], head = sha('a') } = {}) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/owner/repo/pull/${number}`,
  created_at: ago(created),
  head: { sha: head },
  labels: labels.map((name) => ({ name })),
});

function run(t, { pulls, files = {}, comments = {}, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'human-queue-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'data'), JSON.stringify({ policy, gatePaths, pulls, files, comments }));
  writeFileSync(
    join(dir, 'gh'),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
const d = JSON.parse(fs.readFileSync(process.env.DATA));
if (args[0] === 'repo' && args[1] === 'view') { console.log('owner/repo'); process.exit(0); }
if (args[0] !== 'api' || !args.includes('--paginate')) process.exit(2);
const p = args[1];
const number = (re) => String(Number(re.exec(p)[1]));
if (p.startsWith('repos/owner/repo/pulls?state=open')) console.log(JSON.stringify([d.pulls]));
else if (/pulls\\/\\d+\\/files/.test(p)) console.log(JSON.stringify([d.files[number(/pulls\\/(\\d+)\\//)] ?? []]));
else if (/issues\\/\\d+\\/comments/.test(p)) console.log(JSON.stringify([d.comments[number(/issues\\/(\\d+)\\//)] ?? []]));
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
if (args[0] !== 'show') process.exit(2);
process.stdout.write(args[1].endsWith('merge-gate-paths.json') ? d.gatePaths : d.policy);
`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_REPOSITORY: 'owner/repo',
      DATA: join(dir, 'data'),
      CALLS: join(dir, 'calls'),
      ...env,
    },
  });
  let calls = [];
  try {
    calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
  } catch {}
  return { result, calls };
}

const listed = (stdout) => [...stdout.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));

test('a PR touching a human-queue path is listed with its age and reason', (t) => {
  const { result } = run(t, {
    pulls: [pull(7, { created: 51 * hour + 60_000 })],
    files: { 7: [{ filename: 'apps/server/src/services/secrets.ts' }] },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^#7 {2}2d 3h {2}PR 7$/m);
  assert.match(result.stdout, /https:\/\/github\.com\/owner\/repo\/pull\/7/);
  assert.match(
    result.stdout,
    /- human queue \(credentials\): apps\/server\/src\/services\/secrets\.ts/,
  );
});

test('a rename away from a human-queue path is listed', (t) => {
  const { result } = run(t, {
    pulls: [pull(3)],
    files: {
      3: [
        {
          filename: 'apps/server/src/services/vault.ts',
          previous_filename: 'apps/server/src/services/credentials.ts',
        },
      ],
    },
  });
  assert.deepEqual(listed(result.stdout), [3]);
  assert.match(
    result.stdout,
    /human queue \(credentials\): apps\/server\/src\/services\/credentials\.ts/,
  );
});

test('an owner-route PR is listed with the reasons the batch merger marked on its head', (t) => {
  const head = sha('c');
  const { result } = run(t, {
    pulls: [pull(9, { labels: ['owner-route'], head, created: 5 * 60_000 })],
    files: { 9: [{ filename: 'docs/adr/0030-x.md' }] },
    comments: {
      9: [
        {
          body: `<!-- batch-merger-owner-route:${sha('d')} -->\nOwner route\n\n- stale reason`,
        },
        {
          body: `<!-- batch-merger-owner-route:${head} -->\n**Batch merger: owner route**\n\n- protected paths: docs/adr/0030-x.md`,
        },
      ],
    },
  });
  assert.match(result.stdout, /^#9 {2}5m {2}PR 9$/m);
  assert.match(result.stdout, /- protected paths: docs\/adr\/0030-x\.md/);
  assert.doesNotMatch(result.stdout, /stale reason/);
});

test('an owner-route PR without a marked comment still names the label', (t) => {
  const { result } = run(t, { pulls: [pull(4, { labels: ['owner-route'] })] });
  assert.deepEqual(listed(result.stdout), [4]);
  assert.match(result.stdout, /- owner-route label/);
});

test('an unrelated PR is not listed and the oldest queued PR comes first', (t) => {
  const { result } = run(t, {
    pulls: [pull(1), pull(2, { created: 30 * hour }), pull(5, { created: 2 * hour })],
    files: {
      1: [{ filename: 'apps/web/src/page.ts' }],
      2: [{ filename: 'apps/server/drizzle/0050_x.sql' }],
      5: [{ filename: 'apps/server/src/services/mcp-face.ts' }],
    },
  });
  assert.deepEqual(listed(result.stdout), [2, 5]);
  assert.match(result.stdout, /^#2 {2}1d 6h /m);
});

test('an empty queue says so', (t) => {
  const { result } = run(t, {
    pulls: [pull(1)],
    files: { 1: [{ filename: 'apps/web/src/page.ts' }] },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /human queue: empty/);
});

test('control characters in a title or file name are escaped, not printed', (t) => {
  const { result } = run(t, {
    pulls: [{ ...pull(8), title: 'Fix\u001b[2Jcleared' }],
    files: { 8: [{ filename: 'scripts/ops/x\u001b]0;y.sh' }] },
  });
  assert.ok(!result.stdout.includes(String.fromCharCode(27)));
  assert.match(result.stdout, /Fix\\u001b\[2Jcleared/);
  assert.match(result.stdout, /scripts\/ops\/x\\u001b\]0;y\.sh/);
});

test('the listing only reads from GitHub', (t) => {
  const { calls } = run(t, {
    pulls: [pull(7, { labels: ['owner-route'] })],
    files: { 7: [{ filename: 'apps/server/src/services/secrets.ts' }] },
  });
  assert.ok(calls.length > 0);
  for (const args of calls) {
    assert.ok(!args.includes('--method') && !args.includes('-X') && !args.includes('--input'));
    assert.ok(args[0] === 'api' || (args[0] === 'repo' && args[1] === 'view'));
  }
});

test('the repository comes from gh when GITHUB_REPOSITORY is unset', (t) => {
  const { result } = run(t, {
    pulls: [pull(7)],
    files: { 7: [{ filename: 'apps/server/src/services/secrets.ts' }] },
    env: { GITHUB_REPOSITORY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(listed(result.stdout), [7]);
});
