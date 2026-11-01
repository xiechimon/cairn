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
    if (args[0] === 'pr') {
      assert.deepEqual(args.slice(0, 2), ['pr', 'view']);
      assert.ok(args.includes('closingIssuesReferences,commits'));
      const pull = state.pulls.find((pull) => String(pull.number) === args[2]);
      assert.ok(pull);
      return JSON.stringify({
        closingIssuesReferences: pull.closingIssuesReferences ?? [],
        commits: pull.commits ?? [],
      });
    }
    assert.equal(args[0], 'api');
    const path = args[1];
    if (args.includes('PATCH')) {
      assert.ok(state.plan);
      await state.patchProbe?.();
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

test('transfers labels, preserves all lane list bytes and reports an idempotent second run', async (t) => {
  const w = world(t);
  const before = Buffer.from('7\r\n17\r\n\r\n117\n17\nlast\xff', 'latin1');
  writeFileSync(join(w.dir, 'pending'), before);
  writeFileSync(join(w.dir, 'mine'), '17');
  writeFileSync(join(w.dir, 'hold'), '9\n17\n');
  writeFileSync(join(w.dir, 'never'), '3\n');
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
  assert.deepEqual(readFileSync(join(w.dir, 'pending')), before);
  assert.equal(readFileSync(join(w.dir, 'mine'), 'utf8'), '17');
  assert.equal(readFileSync(join(w.dir, 'hold'), 'utf8'), '9\n17\n');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '3\n17\n');
  assert.equal(first.agent, 'orb-builder');
  assert.equal(first.lock.timeoutSeconds, 900);
  assert.deepEqual(first.lists, { never: 'appended', pending: true, mine: true, hold: true });
  const second = await w.run({ agent: 'orb-builder' });
  assert.equal(second.changes, 0);
  assert.equal(second.lists.never, 'already');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '3\n17\n');
  assert.equal(w.state.writes.length, 1);
  assert.deepEqual(readdirSync(w.dir).sort(), ['hold', 'lock2', 'mine', 'never', 'pending']);
});

test('dry-run returns planned diffs without changing GitHub, lists or a missing directory', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'pending'), '17\n18\n');
  const planned = await w.run({ dryRun: true });
  assert.deepEqual(planned.lists, { never: 'appended', pending: true, mine: false, hold: false });
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
  [
    'closing-pr-commit: #4',
    [
      {
        number: 4,
        head: { ref: 'other' },
        commits: [{ messageHeadline: 'Implement transfer', messageBody: 'closes #17' }],
      },
    ],
    [],
  ],
  [
    'closing-pr-reference: #5',
    [
      {
        number: 5,
        head: { ref: 'other' },
        closingIssuesReferences: [{ number: 17, url: 'https://github.com/owner/repo/issues/17' }],
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
  w.state.pulls = [
    {
      number: 1,
      head: { ref: 'lane/170' },
      body: 'Fixes #170; refs #17',
      commits: [{ messageHeadline: 'Fix #170', messageBody: 'refs #17' }],
      closingIssuesReferences: [{ number: 17, url: 'https://github.com/other/repo/issues/17' }],
    },
    {
      number: 2,
      head: { ref: 'unrelated' },
      commits: [{ messageHeadline: 'Implement #18', messageBody: 'closes #18' }],
    },
  ];
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
  assert.equal(result.lists.never, 'already');
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

for (const mode of ['dry-run', 'apply', 'patch-failure', 'closing-commit', 'closing-reference']) {
  test(`CLI ${mode} exercises the gh boundary with an executable fake`, (t) => {
    const w = world(t);
    const callsFile = join(w.dir, 'calls.jsonl');
    const stateDir = join(w.dir, 'state');
    mkdirSync(stateDir);
    writeFileSync(join(stateDir, 'pending'), '17\n18\n');
    writeFileSync(
      join(w.dir, 'gh'),
      `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.GH_FAKE_CALLS, JSON.stringify(args) + '\\n');
const path = args[1];
const mode = process.env.GH_FAKE_MODE;
if (args.includes('PATCH')) {
  if (mode === 'patch-failure') { console.error('patch-failed'); process.exit(1); }
  console.log('{}');
} else if (args[0] === 'pr') {
  console.log(JSON.stringify({
    commits: [{ messageHeadline: 'Implement transfer', messageBody: mode === 'closing-commit' ? 'closes #17' : 'closes #18' }],
    closingIssuesReferences: [{ number: 17, url: mode === 'closing-reference' ? 'https://github.com/owner/repo/issues/17' : 'https://github.com/other/repo/issues/17' }]
  }));
} else if (path.endsWith('/issues/17')) console.log(JSON.stringify({ state: 'open', labels: [{name: 'by:pi'}, {name: 'batch:now'}] }));
else if (path.includes('/pulls?')) console.log('[[{"number":61,"head":{"ref":"other"},"title":"Implement transfer","body":""}]]');
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
        ...(mode === 'dry-run' ? ['--dry-run'] : []),
        '--repo',
        'owner/repo',
        '--state-dir',
        stateDir,
        '--lanes-dir',
        join(w.dir, 'lanes'),
        '--agent',
        'orb-builder',
      ],
      {
        encoding: 'utf8',
        cwd: '/tmp',
        env: {
          ...process.env,
          PATH: `${w.dir}:${process.env.PATH}`,
          GH_FAKE_CALLS: callsFile,
          GH_FAKE_MODE: mode,
        },
      },
    );
    const blocked = mode.startsWith('closing-');
    assert.equal(result.status, blocked || mode === 'patch-failure' ? 1 : 0, result.stderr);
    if (blocked) {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, new RegExp(`closing-pr-${mode.slice(8)}: #61`));
    } else {
      const output = JSON.parse(result.stdout);
      assert.equal(output.issue, 17);
      assert.equal(output.dryRun, mode === 'dry-run');
      assert.equal(output.agent, 'orb-builder');
      assert.deepEqual(output.labelsAfter, ['by:cairn', 'ready-for-agent', 'agent:orb-builder']);
      assert.deepEqual(output.lists, {
        never: 'appended',
        pending: true,
        mine: false,
        hold: false,
      });
      if (mode === 'patch-failure')
        assert.match(result.stderr, /patch-failed[\s\S]*never: appended.*rerun/);
      else assert.equal(result.stderr, '');
    }
    const calls = readFileSync(callsFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, blocked || mode === 'dry-run' ? 4 : 9);
    assert.equal(
      calls.filter((args) => args.includes('PATCH')).length,
      blocked || mode === 'dry-run' ? 0 : 1,
    );
    assert.deepEqual(
      calls.find((args) => args[0] === 'pr'),
      ['pr', 'view', '61', '--repo', 'owner/repo', '--json', 'closingIssuesReferences,commits'],
    );
    assert.equal(readFileSync(join(stateDir, 'pending'), 'utf8'), '17\n18\n');
    if (blocked || mode === 'dry-run') assert.deepEqual(readdirSync(stateDir), ['pending']);
    else {
      assert.equal(readFileSync(join(stateDir, 'never'), 'utf8'), '17\n');
      assert.deepEqual(readdirSync(stateDir).sort(), ['lock2', 'never', 'pending']);
    }
  });
}

test('a failed label PATCH retains never, reports the redo and releases lock2', async (t) => {
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
    assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
  };
  w.state.patchFails = true;
  await assert.rejects(w.run(), /patch-failed.*never: appended.*rerun/);
  for (const [name, content] of Object.entries(before)) {
    assert.equal(readFileSync(join(w.dir, name), 'latin1'), content);
  }
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
  assert.equal(w.state.labels.includes('by:cairn'), false);
  assert.equal(probe().status, 0);
  w.state.patchFails = false;
  const redo = await w.run();
  assert.equal(redo.lists.never, 'already');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
  assert.equal(w.state.labels.includes('by:cairn'), true);
});

for (const patchFails of [false, true]) {
  test(`a spawned pending writer survives transfer with PATCH failure ${patchFails}`, async (t) => {
    const w = world(t);
    const path = join(w.dir, 'pending');
    writeFileSync(path, '17\n18\n');
    w.state.patchFails = patchFails;
    const writer = spawn(
      process.execPath,
      [
        '-e',
        `
const { appendFileSync } = require('node:fs');
let count = 0;
const append = () => {
  appendFileSync(process.argv[1], '99\\n');
  count += 1;
  setImmediate(append);
};
process.stdin.once('data', () => {
  process.stdout.write(String(count));
  process.exit(0);
});
process.stderr.write('ready');
append();
`,
        path,
      ],
      { cwd: w.dir, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let count = '';
    writer.stdout.on('data', (data) => {
      count += data;
    });
    const exited = new Promise((resolve, reject) => {
      writer.once('error', reject);
      writer.once('close', resolve);
    });
    try {
      await new Promise((resolve, reject) => {
        writer.stderr.once('data', resolve);
        writer.once('error', reject);
        writer.once('exit', () => reject(new Error('pending writer exited before readiness')));
      });
      if (patchFails) await assert.rejects(w.run(), /patch-failed/);
      else await w.run();
    } finally {
      writer.stdin.end('stop');
      assert.equal(await exited, 0);
    }
    assert.ok(Number(count) > 0);
    assert.equal(readFileSync(path, 'utf8'), `17\n18\n${'99\n'.repeat(Number(count))}`);
    assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
  });
}

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
  const result = await w.run({
    printPlan: (plan) => {
      w.state.plan = plan;
      writeFileSync(join(w.dir, 'hold'), '17\n99\n');
    },
  });
  assert.equal(result.lists.hold, true);
  assert.equal(readFileSync(join(w.dir, 'hold'), 'utf8'), '17\n99\n');
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n');
});

test('an unterminated never list refuses an unsafe append without mutation', async (t) => {
  const w = world(t);
  writeFileSync(join(w.dir, 'never'), '3');
  await assert.rejects(w.run(), /never-missing-newline/);
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '3');
  assert.equal(w.state.writes.length, 0);
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
  assert.equal(readFileSync(join(w.dir, 'pending'), 'utf8'), '17\n18\n');
  assert.equal(readFileSync(join(w.dir, 'never'), 'utf8'), '17\n');
});

test('a real competing flock causes a named timeout without changing lists', async (t) => {
  const w = world(t);
  const before = { pending: '17\n', mine: '17', hold: '17\r\n', never: '3\n' };
  for (const [name, content] of Object.entries(before)) writeFileSync(join(w.dir, name), content);
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
    for (const [name, content] of Object.entries(before)) {
      assert.equal(readFileSync(join(w.dir, name), 'latin1'), content);
    }
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
