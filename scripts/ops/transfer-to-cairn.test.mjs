import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { transferToCairn } from './transfer-to-cairn.mjs';

function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-transfer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const state = {
    labels: [
      'bug',
      'by:pi',
      'by:codex',
      'batch:B2',
      'batch:B12',
      'batch:now',
      'batch:next',
      'batch:later',
      'batch:Backlog',
    ],
    state: 'open',
    pulls: [],
    branches: [],
    writes: [],
  };
  const runner = async (args) => {
    assert.equal(args[0], 'api');
    const path = args[1];
    if (args.includes('PATCH')) {
      state.writes.push(args);
      state.labels = args.filter((a) => a.startsWith('labels[]=')).map((a) => a.slice(9));
      return '{}';
    }
    if (path.includes('/pulls?')) return JSON.stringify([state.pulls]);
    if (path.includes('/git/matching-refs/')) return JSON.stringify(state.branches);
    if (path.endsWith('/issues/17'))
      return JSON.stringify({ state: state.state, labels: state.labels.map((name) => ({ name })) });
    throw new Error(`Unexpected gh call: ${args.join(' ')}`);
  };
  return {
    dir,
    state,
    runner,
    run: (opts = {}) =>
      transferToCairn({ issue: 17, stateDir: dir, repo: 'owner/repo', ...opts }, runner),
  };
}

test('transfers labels, preserves unrelated list bytes and reports an idempotent second run', async (t) => {
  const w = world(t);
  const before = Buffer.from('7\r\n17\r\n\r\n117\n17\nlast\xff', 'latin1');
  writeFileSync(join(w.dir, 'pending'), before);
  writeFileSync(join(w.dir, 'mine'), '17');
  writeFileSync(join(w.dir, 'hold'), '9\n17\n');
  writeFileSync(join(w.dir, 'never'), '3');
  const first = await w.run({ agent: 'orb-builder' });
  assert.deepEqual(first.labelsBefore, [
    'bug',
    'by:pi',
    'by:codex',
    'batch:B2',
    'batch:B12',
    'batch:now',
    'batch:next',
    'batch:later',
    'batch:Backlog',
  ]);
  assert.deepEqual(first.labelsAfter, [
    'bug',
    'batch:Backlog',
    'by:cairn',
    'ready-for-agent',
    'agent:orb-builder',
  ]);
  assert.deepEqual(
    readFileSync(join(w.dir, 'pending')),
    Buffer.from('7\r\n\r\n117\nlast\xff', 'latin1'),
  );
  assert.equal(readFileSync(join(w.dir, 'mine'), 'utf8'), '');
  assert.equal(readFileSync(join(w.dir, 'hold'), 'utf8'), '9\n');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '3\n17\n');
  assert.equal(first.agent, 'orb-builder');
  assert.equal(first.lists.pending.changed, true);
  const second = await w.run({ agent: 'orb-builder' });
  assert.equal(second.changes, 0);
  assert.equal(w.state.writes.length, 1);
  assert.deepEqual(readdirSync(w.dir).sort(), ['hold', 'mine', 'never', 'pending']);
});

test('dry-run returns planned diffs without changing GitHub, lists or a missing directory', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n18\n');
  const planned = await w.run({ dryRun: true });
  assert.equal(planned.lists.pending.before, '17\n18\n');
  assert.equal(planned.lists.pending.after, '18\n');
  assert.ok(planned.changes > 0);
  assert.equal(w.state.writes.length, 0);
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n18\n');
  await w.run({ dryRun: true, stateDir: join(w.dir, 'missing') });
  assert.deepEqual(readdirSync(w.dir), ['pending']);
});

for (const [reason, pulls, branches] of [
  ['lane-pr', [{ number: 1, head: { ref: 'lane/17' }, body: '' }], []],
  ['closing-pr', [{ number: 2, head: { ref: 'other' }, body: 'Fixes #17' }], []],
  [
    'closing-pr',
    [
      {
        number: 3,
        head: { ref: 'other' },
        body: 'Resolves https://github.com/owner/repo/issues/17',
      },
    ],
    [],
  ],
  ['lane-branch', [], [{ ref: 'refs/heads/lane/17' }]],
]) {
  test(`${reason} blocks before any mutation`, async (t) => {
    const w = world(t);
    w.state.pulls = pulls;
    w.state.branches = branches;
    writeFileSync(join(w.dir, 'pending'), '17\n');
    await assert.rejects(w.run(), new RegExp(reason));
    assert.equal(w.state.writes.length, 0);
    assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n');
    assert.deepEqual(readdirSync(w.dir), ['pending']);
  });
}

test('similar issue numbers and branch names do not block; missing lists are fine', async (t) => {
  const w = world(t);
  w.state.pulls = [{ number: 1, head: { ref: 'lane/170' }, body: 'Fixes #170; refs #17' }];
  w.state.branches = [{ ref: 'refs/heads/lane/170' }];
  const result = await w.run({ stateDir: join(w.dir, 'missing') });
  assert.equal(result.lanes.branch, false);
  assert.equal(readFileSync(join(w.dir, 'missing/never'), 'utf8'), '17\n');
  assert.deepEqual(readdirSync(join(w.dir, 'missing')), ['never']);
});

test('closed issues and failed lane reads refuse without mutation', async (t) => {
  const w = world(t);
  w.state.state = 'closed';
  await assert.rejects(w.run(), /issue-closed/);
  assert.equal(w.state.writes.length, 0);
  w.state.state = 'open';
  await assert.rejects(
    transferToCairn({ issue: 17, stateDir: w.dir }, async () => {
      throw new Error('gh-unavailable');
    }),
    /gh-unavailable/,
  );
  assert.deepEqual(readdirSync(w.dir), []);
});

test('existing never membership is kept byte-for-byte', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'never'), '3\r\n17\r\n19');
  const result = await w.run();
  assert.equal(result.lists.never.changed, false);
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '3\r\n17\r\n19');
});

test('invalid issue and repository input never invokes GitHub', async (t) => {
  const w = world(t);
  const runner = async () => assert.fail('must validate input before GitHub');
  await assert.rejects(transferToCairn({ issue: 0, stateDir: w.dir }, runner), /invalid-issue/);
  await assert.rejects(
    transferToCairn({ issue: 17, repo: '../repo', stateDir: w.dir }, runner),
    /invalid-repo/,
  );
});

test('CLI emits only JSON and runs its gh boundary against a local executable fake', (t) => {
  const w = world(t);
  const callsFile = join(w.dir, 'calls.jsonl');
  writeFileSync(
    join(w.dir, 'gh'),
    `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.GH_FAKE_CALLS, JSON.stringify(args) + '\\n');
const path = args[1];
if (path.endsWith('/issues/17')) console.log(JSON.stringify({ state: 'open', labels: [{name: 'by:pi'}, {name: 'batch:now'}] }));
else if (path.includes('/pulls?')) console.log('[[]]');
else if (path.includes('/git/matching-refs/')) console.log('[]');
else process.exit(1);
`,
    { mode: 0o700 },
  );
  const result = spawnSync(
    process.execPath,
    [
      new URL('./transfer-to-cairn.mjs', import.meta.url).pathname,
      '17',
      '--dry-run',
      '--repo',
      'owner/repo',
      '--state-dir',
      join(w.dir, 'state'),
      '--agent',
      'orb-builder',
    ],
    {
      encoding: 'utf8',
      cwd: '/tmp',
      env: { ...process.env, PATH: `${w.dir}:${process.env.PATH}`, GH_FAKE_CALLS: callsFile },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.issue, 17);
  assert.equal(output.dryRun, true);
  assert.equal(output.agent, 'orb-builder');
  assert.deepEqual(output.labelsAfter, ['by:cairn', 'ready-for-agent', 'agent:orb-builder']);
  const calls = readFileSync(callsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => !args.includes('PATCH')));
  assert.deepEqual(readdirSync(w.dir).sort(), ['calls.jsonl', 'gh']);
});
