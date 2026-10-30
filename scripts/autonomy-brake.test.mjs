import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/autonomy-brake.mjs');
function fixture(t, data = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brake-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls');
  writeFileSync(join(dir, 'data'), JSON.stringify(data));
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(args)+'\\n');
const d = JSON.parse(fs.readFileSync(process.env.DATA));
if(args.includes('--input')) fs.appendFileSync(process.env.CALLS, fs.readFileSync(0,'utf8')+'\\n');
const path = args[1];
if (path === 'graphql') {
 if(args.includes('pullRequestId=bad')) process.exit(1);
 console.log(JSON.stringify({data:{disablePullRequestAutoMerge:{pullRequest:{number:1}}}}));
} else if (path.includes('/issues?')) console.log(JSON.stringify([d.issues ?? []]));
else if (path.includes('/actions/workflows/')) console.log(JSON.stringify([{workflow_runs:d.runs ?? []}]));
else if (path.includes('/labels?')) console.log(JSON.stringify([d.labels ?? []]));
else if (path.includes('/pulls?')) console.log(JSON.stringify([d.pulls ?? []]));
else if (path.includes('/check-runs')) console.log(JSON.stringify([{check_runs:d.latestFailure && path.includes(d.main) ? [{id:1,name:'check',conclusion:'success',status:'completed',app:{slug:'github-actions'}},{id:2,name:'check',conclusion:'failure',status:'completed',app:{slug:'github-actions'}}] : [{id:1,name:'check', conclusion: path.includes(d.green) ? 'success':'failure',status:'completed',app:{slug:'github-actions'}}]}]));
else if(path.endsWith('/commits')) console.log(JSON.stringify([d.commits]));
else if(path.includes('/pulls/')) console.log(JSON.stringify(d.pr));
else if(path.includes('/branches/main')) console.log(JSON.stringify({commit:{sha:d.main}}));
else console.log('{}');
`,
    { mode: 0o755 },
  );
  return {
    dir,
    run: (args, cwd = dir) =>
      spawnSync(process.execPath, [script, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'owner/repo',
          CALLS: log,
          DATA: join(dir, 'data'),
        },
      }),
    calls: () => readFileSync(log, 'utf8'),
  };
}
test('status reports an open marker without writes', (t) => {
  const f = fixture(t, { issues: [{ number: 5 }] });
  const r = f.run(['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).paused, true);
  assert.doesNotMatch(f.calls(), /POST/);
});
test('sweep tries every armed PR and fails after a failed disarm', (t) => {
  const f = fixture(t, {
    issues: [{ number: 5 }],
    pulls: [
      { number: 1, node_id: 'bad', auto_merge: {}, head: { sha: 'a'.repeat(40) }, labels: [] },
      { number: 2, node_id: 'good', auto_merge: {}, head: { sha: 'b'.repeat(40) }, labels: [] },
      { number: 3, auto_merge: null, head: { sha: 'c'.repeat(40) }, labels: [] },
    ],
  });
  const r = f.run(['sweep']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /#1.*failed/);
  assert.match(r.stdout, /#2.*disarmed/);
  assert.match(f.calls(), /pullRequestId=good/);
});
for (const mode of [
  'valid',
  'extra file',
  'one byte',
  'latest failure',
  'multiple reverts',
  'green target',
  'no green',
])
  test(`recovery verification: ${mode}`, (t) => {
    const f = fixture(t);
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: f.dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(f.dir, 'file'), 'good\n');
    git('add', 'file');
    git('commit', '-m', 'green');
    const green = git('rev-parse', 'HEAD');
    writeFileSync(join(f.dir, 'file'), 'bad\n');
    git('add', 'file');
    git('commit', '-m', 'bad');
    let main = git('rev-parse', 'HEAD');
    if (mode === 'multiple reverts') {
      const older = main;
      writeFileSync(join(f.dir, 'file'), 'worse\n');
      git('add', 'file');
      git('commit', '-m', 'worse');
      main = git('rev-parse', 'HEAD');
      git('revert', '--no-commit', main, older);
      git(
        'commit',
        '-m',
        `Recovery\n\nThis reverts commit ${older}.\nThis reverts commit ${main}.`,
      );
    } else git('revert', '--no-edit', main);
    if (mode === 'extra file') writeFileSync(join(f.dir, 'extra'), 'extra');
    if (mode === 'one byte') writeFileSync(join(f.dir, 'file'), 'Good\n');
    if (mode === 'extra file' || mode === 'one byte') {
      git('add', 'file', ...(mode === 'extra file' ? ['extra'] : []));
      git('commit', '--amend', '--no-edit');
    }
    const head = git('rev-parse', 'HEAD');
    const message = git('show', '-s', '--format=%B');
    writeFileSync(
      join(f.dir, 'data'),
      JSON.stringify({
        green: mode === 'green target' ? main : mode === 'no green' ? 'none' : green,
        main,
        latestFailure: mode === 'latest failure',
        pr: {
          labels: [{ name: 'cairn-recovery' }],
          base: { ref: 'main', sha: main },
          head: { sha: head },
          commits: 1,
        },
        issues: [{ number: 5 }],
        pulls: [
          {
            number: 7,
            head: { sha: head },
            labels: [{ name: 'cairn-recovery' }],
            auto_merge: null,
          },
        ],
        commits: [{ sha: head, commit: { message } }],
      }),
    );
    const r = f.run(['verify-recovery', '7']);
    assert.equal(
      r.status,
      ['valid', 'latest failure', 'multiple reverts'].includes(mode) ? 0 : 1,
      r.stderr,
    );
    if (mode === 'extra file' || mode === 'one byte')
      assert.match(r.stderr, /Recovery tree differs/);
    if (mode === 'valid') {
      const check = f.run(['check-pr', '7'], f.dir);
      assert.equal(check.status, 0, check.stderr);
      assert.match(f.calls(), /"state":"success"/);
      const sweep = f.run(['sweep'], f.dir);
      assert.equal(sweep.status, 0, sweep.stderr);
    }
  });

for (const paused of [false, true])
  test(`pause reuses marker: ${paused}`, (t) => {
    const f = fixture(t, { issues: paused ? [{ number: 5 }] : [] });
    const r = f.run(['pause', '--reason', 'Failed main SHA: run URL']);
    assert.equal(r.status, 0, r.stderr);
    const calls = f.calls();
    assert.equal(calls.includes('POST'), !paused);
    if (!paused) {
      assert.match(calls, /\/labels/);
      assert.match(calls, /\/issues/);
    }
  });

for (const paused of [true, false])
  test(`sweep publishes required head status and refreshes green checks: paused=${paused}`, (t) => {
    const f = fixture(t, {
      issues: paused ? [{ number: 5 }] : [],
      pulls: [{ number: 7, head: { sha: 'a'.repeat(40) }, auto_merge: null, labels: [] }],
      runs: [{ id: 90, head_sha: 'a'.repeat(40), pull_requests: [{ number: 7 }] }],
    });
    const r = f.run(['sweep']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(f.calls(), /statuses\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    assert.match(f.calls(), /actions\/runs\/90\/rerun/);
    assert.match(f.calls(), /POST/);
    assert.match(f.calls(), new RegExp(`"state":"${paused ? 'failure' : 'success'}"`));
  });
test('a new paused head fails the PR check and publishes a failure status', (t) => {
  const f = fixture(t, {
    issues: [{ number: 5 }],
    pr: { head: { sha: 'a'.repeat(40) }, labels: [] },
  });
  const r = f.run(['check-pr', '7']);
  assert.equal(r.status, 1);
  assert.match(f.calls(), /statuses\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});
