import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as transfer from './transfer-to-cairn.mjs';

const { transferToCairn } = transfer;

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
    commands: [],
    plan: null,
    laneExists: false,
    processes: '',
    patchFails: false,
    patchProbe: null,
  };
  const runner = async (args, command = 'gh') => {
    state.commands.push({ command, args });
    if (command === 'ps') return state.processes;
    if (command === 'sh')
      return args.some((arg) => arg.startsWith('command -v flock'))
        ? '/usr/bin/flock'
        : state.laneExists
          ? 'present'
          : '';
    assert.equal(args[0], 'api');
    const path = args[1];
    if (args.includes('PATCH')) {
      assert.ok(state.plan);
      for (const [name, list] of Object.entries(state.plan.lists).filter(
        ([name]) => name === 'pending',
      )) {
        const path = join(state.plan.stateDir, name);
        assert.equal(
          list.after,
          (() => {
            try {
              return readFileSync(path).toString('latin1');
            } catch {
              return '';
            }
          })(),
        );
      }
      state.patchProbe?.();
      if (state.patchFails) throw new Error('patch-failed');
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
      transferToCairn(
        {
          issue: 17,
          stateDir: dir,
          lanesDir: join(dir, 'lanes'),
          repo: 'owner/repo',
          printPlan: (plan) => {
            state.plan = plan;
          },
          ...opts,
        },
        runner,
      ),
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
  assert.equal(first.lock.timeoutSeconds, 900);
  assert.equal(first.lists.pending.changed, true);
  const second = await w.run({ agent: 'orb-builder' });
  assert.equal(second.changes, 0);
  assert.equal(w.state.writes.length, 1);
  assert.deepEqual(readdirSync(w.dir).sort(), ['hold', 'lock2', 'mine', 'never', 'pending']);
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
  assert.deepEqual(readdirSync(join(w.dir, 'missing')), ['lock2', 'never']);
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
      fileURLToPath(new URL('./transfer-to-cairn.mjs', import.meta.url)),
      '17',
      '--dry-run',
      '--repo',
      'owner/repo',
      '--state-dir',
      join(w.dir, 'state'),
      '--lanes-dir',
      join(w.dir, 'lanes'),
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

test('a failed label PATCH restores all lists before releasing lock2', async (t) => {
  const w = world(t);
  const before = { pending: '17\r\n18\n', mine: '7\n17', hold: '17\n9\n' };
  for (const [name, content] of Object.entries(before)) writeFileSync(join(w.dir, name), content);
  const probe = () =>
    spawnSync('python3', [
      '-c',
      `import fcntl, sys
with open(sys.argv[1], 'a') as lock:
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(73)
`,
      join(w.dir, 'lock2'),
    ]);
  w.state.patchProbe = () => {
    assert.equal(probe().status, 73);
    for (const [name, list] of Object.entries(w.state.plan.lists)) {
      assert.equal(readFileSync(join(w.dir, name), 'latin1'), list.after);
    }
  };
  w.state.patchFails = true;
  await assert.rejects(w.run(), /patch-failed/);
  for (const [name, content] of Object.entries(before)) {
    assert.equal(readFileSync(join(w.dir, name), 'latin1'), content);
  }
  assert.equal(w.state.labels.includes('by:cairn'), false);
  assert.deepEqual(readdirSync(w.dir).sort(), ['hold', 'lock2', 'mine', 'pending']);
  assert.equal(probe().status, 0);
});

test('PATCH rollback restores membership while preserving concurrent list appends', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n18\n');
  writeFileSync(join(w.dir, 'mine'), '7\n17');
  w.state.patchProbe = () => {
    for (const name of ['pending', 'mine']) {
      const path = join(w.dir, name);
      writeFileSync(path, `${readFileSync(path, 'latin1')}99\n`, 'latin1');
    }
  };
  w.state.patchFails = true;
  await assert.rejects(w.run(), /patch-failed/);
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n18\n99\n');
  assert.equal(readFileSync(join(w.dir, 'mine'), 'utf8'), '7\n17\n99\n');
  assert.equal(w.state.labels.includes('by:cairn'), false);
});

for (const kind of ['directory', 'process']) {
  test(`refuses an existing lane ${kind} through the runner`, async (t) => {
    const w = world(t);
    w.state.laneExists = kind === 'directory';
    w.state.processes =
      kind === 'process' ? `ai-route run implement -C ${join(w.dir, 'lanes/cairn-17')} prompt` : '';
    await assert.rejects(
      w.run(),
      new RegExp(kind === 'directory' ? 'lane-directory' : 'lane-process'),
    );
    assert.equal(w.state.writes.length, 0);
    assert.deepEqual(readdirSync(w.dir), []);
  });
}

test('re-reads lists under the lock after planning', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n');
  await w.run({
    printPlan: (plan) => {
      w.state.plan = plan;
      writeFileSync(join(w.dir, 'hold'), '99\n');
    },
  });
  assert.equal(readFileSync(join(w.dir, 'hold'), 'utf8'), '99\n');
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '');
});

for (const name of ['pending', 'mine']) {
  test(`compare-and-swap retries a concurrent append to ${name}`, (t) => {
    const w = world(t);
    const path = join(w.dir, name);
    writeFileSync(path, '17\n');
    let attempts = 0;
    transfer.applyTransferLists(
      { stateDir: w.dir, issue: 17 },
      {
        beforeRename: (target) => {
          if (target === path && attempts++ === 0) writeFileSync(path, '17\n99\n');
        },
      },
    );
    assert.equal(readFileSync(path, 'utf8'), '99\n');
    assert.equal(attempts, 2);
  });
}

test('compare-and-swap stops after three retries with a named error', (t) => {
  const w = world(t);
  const path = join(w.dir, 'pending');
  writeFileSync(path, '17\n');
  let attempts = 0;
  assert.throws(
    () =>
      transfer.applyTransferLists(
        { stateDir: w.dir, issue: 17 },
        {
          beforeRename: (target) => {
            if (target === path) writeFileSync(path, `17\n${++attempts}\n`);
          },
        },
      ),
    /list-cas-exhausted: pending/,
  );
  assert.equal(attempts, 4);
  assert.equal(readFileSync(path, 'utf8'), '17\n4\n');
  assert.equal(
    readdirSync(w.dir).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('real list application uses the macOS fcntl fallback and preserves list bytes', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n18\n');
  const result = await transferToCairn(
    {
      issue: 17,
      stateDir: w.dir,
      lanesDir: join(w.dir, 'lanes'),
      printPlan: (plan) => {
        w.state.plan = plan;
      },
    },
    (args, command = 'gh') => {
      if (command === 'gh') return w.runner(args);
      if (command === 'sh' && args[1].startsWith('command -v flock')) return '';
      return transfer.runGh(args, command);
    },
  );
  assert.equal(result.lock.path, join(w.dir, 'lock2'));
  assert.match(result.lock.macOSFallback, /fcntl.flock/);
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '18\n');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
});

test('a real competing flock causes a named timeout without changing lists', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n');
  const holder = spawn(
    'python3',
    [
      '-u',
      '-c',
      `import fcntl, sys
with open(sys.argv[1], 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    print('locked', flush=True)
    sys.stdin.readline()
`,
      join(w.dir, 'lock2'),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], cwd: w.dir },
  );
  const exited = new Promise((resolve, reject) => {
    holder.once('exit', resolve);
    holder.once('error', reject);
  });
  try {
    await new Promise((resolve, reject) => {
      holder.stdout.once('data', resolve);
      holder.once('error', reject);
      holder.once('exit', () => reject(new Error('lock holder exited before readiness')));
    });
    await assert.rejects(
      transferToCairn(
        {
          issue: 17,
          stateDir: w.dir,
          lanesDir: join(w.dir, 'lanes'),
          lockTimeoutSeconds: 0.05,
          printPlan: (plan) => {
            w.state.plan = plan;
          },
        },
        (args, command = 'gh') => {
          if (command === 'gh') return w.runner(args);
          if (command === 'sh' && args[1].startsWith('command -v flock')) return '';
          return transfer.runGh(args, command);
        },
      ),
      /overnight-lock-timeout.*lock2/,
    );
    assert.equal(w.state.writes.length, 0);
    assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n');
  } finally {
    holder.stdin.end('release\n');
    await exited;
  }
});

test('the real runner refuses a lane directory under the configured lanes root', async (t) => {
  const w = world(t);
  const lanesDir = join(w.dir, 'lanes');
  mkdirSync(join(lanesDir, 'cairn-17'), { recursive: true });
  await assert.rejects(
    transferToCairn({ issue: 17, stateDir: w.dir, lanesDir }, (args, command = 'gh') =>
      command === 'gh' ? w.runner(args) : transfer.runGh(args, command),
    ),
    /lane-directory/,
  );
  assert.equal(w.state.writes.length, 0);
});

test('a similar process lane number does not block transfer', async (t) => {
  const w = world(t);
  w.state.processes = `ai-route run implement -C ${join(w.dir, 'lanes/cairn-170')} prompt`;
  assert.equal((await w.run()).issue, 17);
});

test('revalidates lane ownership after waiting for lock2', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n');
  await assert.rejects(
    w.run({
      printPlan: (plan) => {
        w.state.plan = plan;
        w.state.laneExists = true;
      },
    }),
    /lane-directory/,
  );
  assert.equal(w.state.writes.length, 0);
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n');
});

test('re-reads labels under lock2 to preserve changes made while waiting', async (t) => {
  const w = world(t);
  await w.run({
    printPlan: (plan) => {
      w.state.plan = plan;
      w.state.labels.push('needs-triage');
    },
  });
  assert.equal(w.state.labels.includes('needs-triage'), true);
});
