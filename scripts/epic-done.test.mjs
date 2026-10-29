import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decideEpic, main, validateManifest } from './epic-done.mjs';

const tip = 'a'.repeat(40);
const closing = 'b'.repeat(40);
const older = 'c'.repeat(40);
const outside = 'd'.repeat(40);
const date = '2026-10-29T12:00:00Z';
const now = new Date('2026-10-29T14:00:00Z');
const connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
const commit = (oid) => ({ oid, committedDate: date });
const manifest = () => ({
  epic: 'E1.0a',
  issues: [1234, 1235],
  requiredChecks: ['check', 'e2e-gate'],
  checks: [
    { name: 'policy', run: ['node', '--test', 'policy.test.mjs'], expectStdoutIncludes: 'pass' },
  ],
  maxHours: 6,
});
const issue = (number) => ({
  number,
  state: 'CLOSED',
  stateReason: 'COMPLETED',
  labels: connection([]),
  timelineItems: connection([
    { closer: { __typename: 'PullRequest', merged: true, mergeCommit: commit(closing) } },
  ]),
  closedByPullRequestsReferences: connection([]),
});
const runRecord = (sha, name, conclusion = 'success', id = 1) => ({
  id,
  head_sha: sha,
  name,
  status: 'completed',
  conclusion,
});
const checkPage = (sha, conclusion = 'success') => ({
  total_count: 2,
  check_runs: [runRecord(sha, 'check', conclusion, 1), runRecord(sha, 'e2e-gate', conclusion, 2)],
});

function harness() {
  const state = {
    manifest: manifest(),
    issues: [issue(1234), issue(1235)],
    head: tip,
    dirty: '',
    remote: tip,
    history: [tip, closing, older],
    mainline: [tip, closing, older],
    descendants: { [closing]: [tip, closing], [tip]: [tip] },
    shallow: 'false',
    checks: { [tip]: [checkPage(tip)], [closing]: [checkPage(closing)] },
    stdout: 'tests pass',
    calls: [],
    output: [],
    intercept: undefined,
    command: undefined,
  };
  const deps = {
    now: () => now,
    write: (text) => state.output.push(text),
    run: (file, args, options) => {
      state.calls.push({ file, args, options });
      const intercepted = state.intercept?.(file, args);
      if (intercepted !== undefined) return intercepted;
      if (file === 'git') {
        if (args[0] === 'cat-file') return '';
        if (args[0] === 'show') return JSON.stringify(state.manifest);
        if (args[0] === 'status')
          return args.includes('--untracked-files=no')
            ? state.dirty.replace(/^\?\? .*\n/gm, '')
            : state.dirty;
        if (args[0] === 'merge-base') return '';
        if (args.includes('--is-shallow-repository')) return state.shallow;
        if (args[0] === 'rev-list') {
          if (args.includes('--topo-order')) return state.history.join('\n');
          if (args.includes('--first-parent')) return state.mainline.join('\n');
          const base = args.at(-1).split('..')[0];
          return state.descendants[base].filter((sha) => sha !== base).join('\n');
        }
        if (args.includes('--show-toplevel')) return '/checkout\n';
        if (args.includes('HEAD')) return `${state.head}\n`;
        if (args[0] === 'rev-parse' && args[2] === 'frozen-v1^{commit}') return `${closing}\n`;
      }
      if (file === 'gh') {
        assert.equal(args[0], 'api');
        if (args[1] === 'graphql') {
          const {
            variables: { number },
          } = JSON.parse(options.input);
          return JSON.stringify({
            data: { repository: { issue: state.issues.find((item) => item.number === number) } },
          });
        }
        const path = args.find((arg) => arg.startsWith('repos/'));
        if (path.endsWith('/git/ref/heads/main'))
          return JSON.stringify({
            ref: 'refs/heads/main',
            object: { type: 'commit', sha: state.remote },
          });
        assert.ok(args.includes('--paginate'));
        assert.ok(args.includes('--slurp'));
        if (path.includes('/check-runs')) {
          const sha = path.split('/commits/')[1].split('/')[0];
          return JSON.stringify(state.checks[sha]);
        }
        if (path.includes('/commits?')) throw new Error('Commit list requests are forbidden');
      }
      if (file === 'node') return state.command ? state.command(file, args, options) : state.stdout;
      throw new Error(`Unexpected runner call: ${file} ${args.join(' ')}`);
    },
  };
  return { state, deps, invoke: (args = []) => main(['E1.0a', ...args], deps) };
}

function expectState(result, state, exitCode, pattern) {
  assert.equal(result.state, state, JSON.stringify(result));
  assert.equal(result.exitCode, exitCode);
  if (pattern) assert.match(result.reasons.join('\n'), pattern);
}

test('complete: closed issues, a clean remote-main tree and one green commit', async () => {
  const { state, invoke } = harness();
  const result = await invoke();
  expectState(result, 'complete', 0, /No time cap/);
  assert.equal(result.checks[0].status, 'passed');
  assert.equal(result.greenSha, tip);
  assert.equal(result.lastClosingSha, closing);
  assert.match(state.output[0], /^state: complete\n/);
  const graphql = JSON.parse(
    state.calls.find(({ args }) => args[1] === 'graphql').options.input,
  ).query;
  for (const field of [
    'stateReason',
    'CLOSED_EVENT',
    'last: 1',
    'merged',
    'mergeCommit',
    'includeClosedPrs: true',
  ])
    assert.ok(graphql.includes(field), field);
  assert.ok(state.calls.some(({ args }) => args.includes(`${tip}:.claude/epics/E1.0a.json`)));
  const execution = state.calls.find(({ file }) => file === 'node');
  assert.deepEqual(execution.args, ['--test', 'policy.test.mjs']);
  assert.equal(execution.options.cwd, '/checkout');
  assert.equal(execution.options.shell, false);
});

test('failure mode 1: API errors and rate limits are unknown, even with pause or fail', async () => {
  for (const message of ['API unavailable', 'rate limit']) {
    const { state, invoke } = harness();
    state.intercept = (file) => {
      if (file === 'gh') throw new Error(message);
    };
    expectState(
      await invoke(['--pause', 'wait', '--fail', 'stop']),
      'unknown',
      2,
      new RegExp(message),
    );
  }
});

test('failure mode 1: malformed or partial GitHub data never completes', async () => {
  const corruptions = [
    (s) => {
      s.intercept = (file) => (file === 'gh' ? '{' : undefined);
    },
    (s) => {
      s.intercept = (file, args) =>
        file === 'gh' && args[1] === 'graphql'
          ? JSON.stringify({ errors: [{ message: 'partial' }], data: {} })
          : undefined;
    },
    (s) => {
      s.issues[0].labels.pageInfo.hasNextPage = true;
    },
    (s) => {
      s.issues[0].closedByPullRequestsReferences.pageInfo.hasNextPage = true;
    },
    (s) => {
      s.issues[0].labels = null;
    },
    (s) => {
      s.issues[0].timelineItems = null;
    },
    (s) => {
      s.issues[0].timelineItems.nodes[0].closer.mergeCommit = null;
    },
    (s) => {
      s.issues[0].number = 999;
    },
    (s) => {
      s.checks[tip][0].total_count = 3;
    },
    (s) => {
      s.checks[tip][0].check_runs[0].head_sha = outside;
    },
    (s) => {
      s.checks[tip] = [];
    },
    (s) => {
      s.checks[tip][0].check_runs.push(s.checks[tip][0].check_runs[0]);
    },
    (s) => {
      s.history = [closing];
    },
    (s) => {
      s.remote = 'bad';
    },
    (s) => {
      s.shallow = 'true';
    },
  ];
  for (const corrupt of corruptions) {
    const { state, invoke } = harness();
    corrupt(state);
    expectState(await invoke(), 'unknown', 2);
  }
});

test('failure mode 2: not-planned, manual and unmerged closures name the issue', async () => {
  for (const closer of [null, { __typename: 'PullRequest', merged: false, mergeCommit: null }]) {
    const { state, invoke } = harness();
    state.issues[0].timelineItems.nodes[0].closer = closer;
    expectState(await invoke(), 'incomplete', 10, /#1234/);
  }
  const { state, invoke } = harness();
  state.issues[0].stateReason = 'NOT_PLANNED';
  expectState(await invoke(), 'incomplete', 10, /#1234.*NOT_PLANNED/);
  state.issues[0].stateReason = 'UNRECOGNIZED';
  expectState(await invoke(), 'incomplete', 10, /#1234.*UNRECOGNIZED/);
});

test('failure mode 3: a merged linked PR does not substitute for an open issue', async () => {
  const { state, invoke } = harness();
  state.issues[0].state = 'OPEN';
  state.issues[0].stateReason = null;
  state.issues[0].closedByPullRequestsReferences = connection([
    { number: 88, state: 'MERGED', labels: connection([]) },
  ]);
  expectState(await invoke(), 'incomplete', 10, /#1234.*open/i);
});

test('failure mode 4: no green main commit since the last closing SHA is incomplete', async () => {
  const { state, invoke } = harness();
  state.checks = { [tip]: [checkPage(tip, 'failure')], [closing]: [checkPage(closing, 'failure')] };
  expectState(await invoke(), 'incomplete', 10, new RegExp(`since ${closing}`));
});

test('failure mode 5: green at the closing commit still completes after later red merges', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'complete', 0);
  assert.equal(result.greenSha, closing);
});

test('required checks must succeed together on one eligible commit', async () => {
  const { state, invoke } = harness();
  state.checks[tip][0].check_runs[0].conclusion = 'failure';
  state.checks[closing][0].check_runs[1].conclusion = 'failure';
  expectState(await invoke(), 'incomplete', 10);
});

test('missing, pending, skipped and neutral required checks do not count as success', async () => {
  for (const conclusion of [
    null,
    undefined,
    'future_conclusion',
    'skipped',
    'neutral',
    'cancelled',
    'timed_out',
    'action_required',
  ]) {
    const { state, invoke } = harness();
    for (const sha of [tip, closing]) {
      state.checks[sha][0].check_runs[0].conclusion = conclusion;
      if (conclusion === null) state.checks[sha][0].check_runs[0].status = 'in_progress';
    }
    expectState(await invoke(), 'incomplete', 10);
  }
  const { state, invoke } = harness();
  for (const sha of [tip, closing]) state.checks[sha] = [{ total_count: 0, check_runs: [] }];
  expectState(await invoke(), 'incomplete', 10);
});

test('failure mode 6: dirty and non-main trees never execute manifest commands', async () => {
  for (const change of [
    (s) => {
      s.dirty = ' M tracked-file\n';
    },
    (s) => {
      s.head = outside;
    },
  ]) {
    const { state, invoke } = harness();
    change(state);
    const result = await invoke();
    expectState(result, 'incomplete', 10, /not run/i);
    assert.equal(result.checks[0].status, 'not-run');
    assert.ok(!state.calls.some(({ file }) => file === 'node'));
  }
});

test('working-tree changes during checks invalidate their result', async () => {
  for (const change of [
    (s) => {
      s.dirty = ' M file\n';
    },
    (s) => {
      s.head = outside;
    },
  ]) {
    const { state, invoke } = harness();
    state.command = () => {
      change(state);
      return 'pass';
    };
    expectState(await invoke(), 'incomplete', 10, /not run/i);
  }
});

test('failure mode 7: frozen manifest comes only from git show at the selected ref', async () => {
  const { state, invoke } = harness();
  expectState(await invoke(['--ref', 'frozen-v1', '--repo', 'octo/repo']), 'complete', 0);
  assert.ok(
    state.calls.some(
      ({ file, args }) =>
        file === 'git' && args[0] === 'show' && args[1] === `${closing}:.claude/epics/E1.0a.json`,
    ),
  );
  assert.ok(
    state.calls
      .filter(({ file }) => file === 'gh')
      .every(
        ({ args, options }) =>
          args.join(' ').includes('octo/repo') ||
          JSON.parse(options.input).variables.owner === 'octo',
      ),
  );
  assert.ok(!state.calls.some(({ file }) => !['git', 'gh', 'node'].includes(file)));
});

test('failure mode 8: invalid manifests fail closed before commands run', async () => {
  const mutations = [
    (m) => {
      m.issues = [];
    },
    (m) => {
      m.checks[0].run = 'echo pass';
    },
    (m) => {
      m.extra = true;
    },
    (m) => {
      m.checks[0].extra = true;
    },
    (m) => {
      m.maxHours = 0;
    },
    (m) => {
      m.maxHours = -1;
    },
    (m) => {
      m.maxHours = '6';
    },
    (m) => {
      m.issues = [0];
    },
    (m) => {
      m.issues = [1, 1];
    },
    (m) => {
      m.checks[0].run = [];
    },
    (m) => {
      m.checks[0].run = ['node', 1];
    },
    (m) => {
      m.checks[0].expectStdoutIncludes = false;
    },
    (m) => {
      m.requiredChecks = ['check', 'check'];
    },
    (m) => {
      m.epic = 'different';
    },
  ];
  for (const mutate of mutations) {
    const { state, invoke } = harness();
    mutate(state.manifest);
    expectState(await invoke(), 'unknown', 2, /manifest/i);
    assert.ok(!state.calls.some(({ file }) => file === 'node'));
  }
  assert.throws(() => validateManifest(null, 'E1.0a'), /manifest/i);
});

test('missing or malformed manifests and git runner failures are unknown', async () => {
  for (const response of ['{', null]) {
    const { state, invoke } = harness();
    state.intercept = (file, args) => {
      if (file === 'git' && args[0] === 'show') {
        if (response === null) throw new Error('manifest missing');
        return response;
      }
    };
    expectState(await invoke(), 'unknown', 2);
  }
  const { state, invoke } = harness();
  state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'status') throw new Error('git failed');
  };
  expectState(await invoke(), 'unknown', 2, /git failed/);
});

test('failure mode 9: missing commands, nonzero exits and missing expected stdout fail checks', async () => {
  for (const failure of [{ code: 'ENOENT' }, { status: 1 }, { status: 7 }]) {
    const { state, invoke } = harness();
    state.command = () => {
      throw Object.assign(new Error('command failed'), failure);
    };
    const result = await invoke();
    expectState(result, 'incomplete', 10, /policy/);
    assert.equal(result.checks[0].status, 'failed');
  }
  const { state, invoke } = harness();
  state.stdout = 'no matching output';
  expectState(await invoke(), 'incomplete', 10, /stdout/i);
});

test('unexpected command errors and malformed command output are unknown', async () => {
  const { state, invoke } = harness();
  state.command = () => {
    throw new Error('unexpected runner failure');
  };
  expectState(await invoke(), 'unknown', 2);
  state.command = () => undefined;
  expectState(await invoke(), 'unknown', 2);
});

test('failure mode 10: no started-at means no cap even when checks fail', async () => {
  const { state, invoke } = harness();
  state.stdout = 'no match';
  expectState(await invoke(), 'incomplete', 10, /No time cap/);
});

test('paused: every human-wait label on issues or open linked PRs takes priority over failure', async () => {
  for (const label of ['needs-decision', 'waits-ian', 'ready-for-human']) {
    for (const onPull of [false, true]) {
      const { state, invoke } = harness();
      state.stdout = 'no match';
      if (onPull)
        state.issues[0].closedByPullRequestsReferences = connection([
          { number: 88, state: 'OPEN', labels: connection([{ name: label }]) },
        ]);
      else state.issues[0].labels = connection([{ name: label }]);
      expectState(await invoke(['--fail', 'stop']), 'paused', 20, new RegExp(label));
    }
  }
});

test('closed linked PR labels do not pause, while explicit pause does', async () => {
  const { state, invoke } = harness();
  state.stdout = 'no match';
  state.issues[0].closedByPullRequestsReferences = connection([
    { number: 88, state: 'CLOSED', labels: connection([{ name: 'needs-decision' }]) },
  ]);
  expectState(await invoke(), 'incomplete', 10);
  expectState(
    await invoke(['--pause', 'quota wait', '--fail', 'stop']),
    'paused',
    20,
    /quota wait/,
  );
});

test('failed: explicit failure and elapsed maxHours apply only when not complete or paused', async () => {
  const { state, invoke } = harness();
  state.stdout = 'no match';
  expectState(
    await invoke(['--fail', 'frozen criteria cannot pass']),
    'failed',
    30,
    /frozen criteria/,
  );
  expectState(await invoke(['--started-at', '2026-10-29T08:00:00Z']), 'failed', 30, /6 hours/);
  expectState(await invoke(['--started-at', '2026-10-29T08:00:01Z']), 'incomplete', 10);
  expectState(
    await invoke(['--started-at', '2026-10-29T08:00:00Z', '--pause', 'human']),
    'paused',
    20,
  );
  state.stdout = 'pass';
  expectState(
    await invoke(['--fail', 'stop', '--pause', 'wait', '--started-at', '2026-10-29T00:00:00Z']),
    'complete',
    0,
  );
});

test('commit closers must belong to main; the latest of multiple closing changes sets the boundary', async () => {
  const { state, invoke } = harness();
  state.issues[0].timelineItems.nodes[0].closer = { __typename: 'Commit', ...commit(outside) };
  expectState(await invoke(), 'incomplete', 10, /#1234.*main/);
  state.issues[0].timelineItems.nodes[0].closer.oid = tip;
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'incomplete', 10, new RegExp(`since ${tip}`));
  assert.equal(result.lastClosingSha, tip);
});

test('all REST pages are consumed and incomplete check pages cannot masquerade as green', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [
    { total_count: 2, check_runs: [runRecord(tip, 'check', 'success', 1)] },
    { total_count: 2, check_runs: [runRecord(tip, 'e2e-gate', 'success', 2)] },
  ];
  expectState(await invoke(), 'complete', 0);
  state.checks[tip].pop();
  expectState(await invoke(), 'unknown', 2);
});

test('invalid CLI arguments fail before any runner executes', async () => {
  for (const args of [
    [],
    ['../escape'],
    ['E1.0a', '--bogus'],
    ['E1.0a', '--repo', 'bad'],
    ['E1.0a', '--ref', '-bad'],
    ['E1.0a', '--started-at', 'yesterday'],
    ['E1.0a', '--pause', ''],
    ['E1.0a', 'extra'],
  ]) {
    const { state, deps } = harness();
    expectState(await main(args, deps), 'unknown', 2);
    assert.equal(state.calls.length, 0);
  }
});

test('JSON output contains the same decision and the pure decision does not mutate facts', async () => {
  const { state, invoke } = harness();
  const result = await invoke(['--json']);
  assert.deepEqual(JSON.parse(state.output[0]), result);
  const facts = structuredClone(result.facts);
  assert.deepEqual(decideEpic(facts), {
    state: result.state,
    exitCode: result.exitCode,
    reasons: result.reasons,
    greenSha: result.greenSha,
    lastClosingSha: result.lastClosingSha,
  });
  assert.deepEqual(facts, result.facts);
  expectState(decideEpic({}), 'unknown', 2);
});

test('import has no CLI effects and the actual CLI guard emits unknown without network', () => {
  const path = new URL('./epic-done.mjs', import.meta.url).pathname;
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import ${JSON.stringify(path)}`],
    { encoding: 'utf8', env: { ...process.env, PATH: '' } },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.equal(imported.stderr, '');
  const cli = spawnSync(process.execPath, [path, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.equal(cli.status, 2);
  assert.equal(JSON.parse(cli.stdout).state, 'unknown');
});

test('CI includes this test and ownership covers the checker and frozen manifests', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(
    workflow,
    /node --test scripts\/prepush\.test\.mjs scripts\/heavy-slots\.test\.mjs[^\n]*scripts\/epic-done\.test\.mjs/,
  );
  const owners = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
  assert.match(owners, /^\/scripts\/epic-done\.mjs @xiechimon$/m);
  assert.match(owners, /^\/\.claude\/epics\/ @xiechimon$/m);
});

test('green side-branch commits cannot establish a green main after closure', async () => {
  const { state, invoke } = harness();
  state.history = [tip, outside, closing, older];
  state.checks[tip] = [checkPage(tip, 'failure')];
  state.checks[closing] = [checkPage(closing, 'failure')];
  state.checks[outside] = [checkPage(outside)];
  expectState(await invoke(), 'incomplete', 10);
});

test('parallel closing changes require a green main descendant of both changes', async () => {
  const { state, invoke } = harness();
  state.issues[1].timelineItems.nodes[0].closer.mergeCommit.oid = outside;
  state.history = [tip, outside, closing, older];
  state.mainline = [tip, closing, older];
  state.descendants[outside] = [tip, outside];
  state.checks[tip] = [checkPage(tip, 'failure')];
  state.checks[outside] = [checkPage(outside)];
  expectState(await invoke(), 'incomplete', 10);
});

test('non-Error runner throws still produce unknown', async () => {
  for (const thrown of [null, 'runner failed']) {
    const { state, invoke } = harness();
    state.intercept = () => {
      throw thrown;
    };
    expectState(await invoke(), 'unknown', 2);
  }
});

test('check-run requests stop at the first green commit, newest first', async () => {
  for (const newestGreen of [true, false]) {
    const { state, invoke } = harness();
    if (!newestGreen) state.checks[tip] = [checkPage(tip, 'failure')];
    expectState(await invoke(), 'complete', 0);
    const calls = state.calls.filter(({ args }) => args.some((arg) => arg.includes('/check-runs')));
    assert.equal(calls.length, newestGreen ? 1 : 2);
    assert.ok(calls[0].args.some((arg) => arg.includes(`/commits/${tip}/`)));
    if (!newestGreen) assert.ok(calls[1].args.some((arg) => arg.includes(`/commits/${closing}/`)));
    assert.ok(!state.calls.some(({ args }) => args.some((arg) => arg.includes('/commits?'))));
  }
});

test('at most 30 eligible commits are examined, including a green thirtieth commit', async () => {
  for (const greenIndex of [29, 30, -1]) {
    const { state, invoke } = harness();
    const middle = Array.from({ length: 35 }, (_, index) =>
      (index + 1).toString(16).padStart(40, '0'),
    );
    state.history = [tip, ...middle, closing, older];
    state.mainline = [...state.history];
    state.descendants[closing] = state.history.slice(0, -1);
    state.checks = Object.fromEntries(
      state.history.map((sha, index) => [
        sha,
        [checkPage(sha, index === greenIndex ? 'success' : 'failure')],
      ]),
    );
    const result = await invoke();
    expectState(result, greenIndex === 29 ? 'complete' : 'incomplete', greenIndex === 29 ? 0 : 10);
    const calls = state.calls.filter(({ args }) => args.some((arg) => arg.includes('/check-runs')));
    assert.equal(calls.length, 30);
    assert.deepEqual(
      result.facts.commits.map(({ sha }) => sha),
      state.history.slice(0, 30),
    );
  }
});

test('no green commit reports missing and unsuccessful required checks on the newest commit', async () => {
  const { state, invoke } = harness();
  state.manifest.requiredChecks = ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence'];
  for (const sha of [tip, closing]) {
    state.checks[sha] = [
      {
        total_count: 3,
        check_runs: [
          runRecord(sha, 'check', 'failure', 1),
          runRecord(sha, 'pack-smoke', 'success', 2),
          { ...runRecord(sha, 'e2e-gate', null, 3), status: 'in_progress' },
        ],
      },
    ];
  }
  const result = await invoke();
  expectState(result, 'incomplete', 10);
  const reasons = result.reasons.join('\n');
  assert.match(reasons, new RegExp(`required check "pr-evidence" has no run on ${tip}`));
  assert.match(reasons, new RegExp(`required check "check" is not successful on ${tip}`));
  assert.match(reasons, new RegExp(`required check "e2e-gate" is not successful on ${tip}`));
  assert.doesNotMatch(reasons, /required check "pack-smoke"/);
  assert.doesNotMatch(reasons, new RegExp(`required check .* on ${closing}`));
});

test('remote main movement after the first read does not invalidate local checks', async () => {
  const { state, invoke } = harness();
  state.command = () => {
    state.remote = outside;
    return 'pass';
  };
  const result = await invoke();
  expectState(result, 'complete', 0);
  assert.equal(result.checks[0].status, 'passed');
  assert.equal(
    state.calls.filter(({ args }) => args.some((arg) => arg.endsWith('/git/ref/heads/main')))
      .length,
    1,
  );
});

test('each command receives a 900 second timeout and a timeout fails that check', async () => {
  const { state, invoke } = harness();
  state.manifest.checks.push({ name: 'second', run: ['node', '--version'] });
  state.command = () => {
    throw Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT', status: null });
  };
  const result = await invoke();
  expectState(result, 'incomplete', 10, /timed out.*900 seconds/i);
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ['failed', 'failed'],
  );
  const calls = state.calls.filter(({ file }) => file === 'node');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.timeout === 900_000));
});

test('a remote main SHA missing locally stays unknown and requests an explicit fetch', async () => {
  const { state, invoke } = harness();
  state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'cat-file') throw new Error('missing object');
  };
  expectState(await invoke(), 'unknown', 2, /git fetch origin main/);
  assert.ok(!state.calls.some(({ args }) => args[0] === 'fetch'));
});

test('only completed success is green, regardless of future GitHub status values', async () => {
  for (const status of ['future_status', undefined, 'in_progress']) {
    const { state, invoke } = harness();
    for (const sha of [tip, closing]) state.checks[sha][0].check_runs[0].status = status;
    expectState(await invoke(), 'incomplete', 10, /required check "check" is not successful/);
  }
});

test('partial or reordered examined commits cannot establish completion', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'complete', 0);
  for (const commits of [
    [],
    result.facts.commits.slice(0, 1),
    [...result.facts.commits].reverse(),
  ]) {
    expectState(decideEpic({ ...result.facts, commits }), 'unknown', 2);
  }
});

test('empty required checks cannot establish completion without CI evidence', async () => {
  const { state, invoke } = harness();
  state.manifest.requiredChecks = [];
  state.checks[tip] = [{ total_count: 0, check_runs: [] }];
  assert.throws(() => validateManifest(state.manifest, 'E1.0a'), /manifest/i);
  expectState(await invoke(), 'unknown', 2, /manifest/i);
  assert.ok(!state.calls.some(({ file }) => file === 'node'));
});

test('untracked files before and during checks preserve every check result', async () => {
  const { state, invoke } = harness();
  state.dirty = '?? existing-cache\n';
  state.manifest.checks.push({ name: 'report', run: ['node', '--version'] });
  state.command = () => {
    state.dirty += '?? generated-report\n';
    return 'pass';
  };
  const result = await invoke();
  expectState(result, 'complete', 0);
  assert.deepEqual(
    result.checks.map(({ status }) => status),
    ['passed', 'passed'],
  );
  assert.ok(
    state.calls
      .filter(({ args }) => args[0] === 'status')
      .every(({ args }) => args.includes('--untracked-files=no')),
  );
});

test('default manifest is pinned to the GitHub main SHA before it is read', async () => {
  const { state, invoke } = harness();
  state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'show' && args[1].startsWith('origin/main:'))
      return JSON.stringify({ ...state.manifest, epic: 'stale-local-main' });
  };
  expectState(await invoke(), 'complete', 0);
  const remoteIndex = state.calls.findIndex(({ args }) => args[1]?.endsWith('/git/ref/heads/main'));
  const manifestIndex = state.calls.findIndex(({ args }) => args[0] === 'show');
  assert.ok(remoteIndex >= 0 && remoteIndex < manifestIndex);
  assert.equal(state.calls[manifestIndex].args[1], `${tip}:.claude/epics/E1.0a.json`);
});

test('explicit manifest refs must resolve to ancestors of remote main', async () => {
  for (const failure of ['branch', 'missing', 'malformed', 'ancestry-error']) {
    const { state, invoke } = harness();
    state.intercept = (file, args) => {
      if (file !== 'git') return;
      if (args[0] === 'rev-parse' && args[2] === 'edited-manifest^{commit}') {
        if (failure === 'missing') throw new Error('unknown revision');
        return failure === 'malformed' ? 'not-a-sha' : `${outside}\n`;
      }
      if (args[0] === 'merge-base')
        throw Object.assign(new Error('ancestry rejected'), {
          status: failure === 'branch' ? 1 : 128,
        });
    };
    expectState(await invoke(['--ref', 'edited-manifest']), 'unknown', 2, /edited-manifest/);
    assert.ok(!state.calls.some(({ args }) => args[0] === 'show'));
    assert.ok(!state.calls.some(({ file }) => file === 'node'));
  }
  const { state, invoke } = harness();
  expectState(await invoke(['--ref', 'frozen-v1']), 'complete', 0);
  assert.ok(
    state.calls.some(({ args }) => args.join(' ') === `merge-base --is-ancestor ${closing} ${tip}`),
  );
});

test('history and descendant membership do not perform repeated array scans', async () => {
  const { invoke } = harness();
  const { facts } = await invoke();
  const rejectScan = () => {
    throw new Error('Linear membership scan');
  };
  facts.history.includes = rejectScan;
  facts.descendants[closing].includes = rejectScan;
  expectState(decideEpic(facts), 'complete', 0);
});

test('finding the latest closure reads issue SHAs independently of history length', async () => {
  const { invoke } = harness();
  const { facts } = await invoke();
  const middle = Array.from({ length: 1000 }, (_, index) =>
    (index + 1).toString(16).padStart(40, '0'),
  );
  facts.history = [tip, ...middle, closing, older];
  facts.mainline = [...facts.history];
  facts.descendants[closing] = facts.history.slice(0, -1);
  let reads = 0;
  for (const item of facts.issues)
    Object.defineProperty(item, 'closingSha', {
      get() {
        reads++;
        return closing;
      },
    });
  expectState(decideEpic(facts), 'complete', 0);
  assert.ok(reads < 50, `Read closing SHAs ${reads} times`);
});

test('last closing events need nodes and bounded length without forward pageInfo', async () => {
  const { state, invoke } = harness();
  for (const item of state.issues) delete item.timelineItems.pageInfo;
  expectState(await invoke(), 'complete', 0);
  const graphql = JSON.parse(
    state.calls.find(({ args }) => args[1] === 'graphql').options.input,
  ).query;
  const closingConnection = graphql
    .split('timelineItems')[1]
    .split('closedByPullRequestsReferences')[0];
  assert.doesNotMatch(closingConnection, /pageInfo/);
  for (const events of [undefined, [], [state.issues[0].timelineItems.nodes[0], {}]]) {
    state.issues[0].timelineItems = { nodes: events };
    expectState(await invoke(), 'unknown', 2, /closing event/i);
  }
});

test('git and gh capture stderr and include it in unknown reasons', async () => {
  for (const command of ['git', 'gh']) {
    const { state, invoke } = harness();
    state.intercept = (file) => {
      if (file === command)
        throw Object.assign(new Error('runner failed'), {
          status: 128,
          stderr: Buffer.from(`${command} diagnostic`),
        });
    };
    expectState(await invoke(), 'unknown', 2, new RegExp(`${command} diagnostic`));
    assert.deepEqual(state.calls.find(({ file }) => file === command).options.stdio, [
      'pipe',
      'pipe',
      'pipe',
    ]);
    assert.match(state.output[0], /^state: unknown\n/);
  }
});

test('manifest check failures capture stderr tails including timeouts', async () => {
  for (const timedOut of [false, true]) {
    const { state, invoke } = harness();
    state.command = () => {
      throw Object.assign(new Error('command failed'), {
        status: timedOut ? null : 1,
        code: timedOut ? 'ETIMEDOUT' : undefined,
        stderr: `${'x'.repeat(4000)}\ncheck diagnostic tail`,
      });
    };
    const result = await invoke();
    expectState(result, 'incomplete', 10, /check diagnostic tail/);
    assert.ok(result.checks[0].reason.length < 2200);
    assert.deepEqual(state.calls.find(({ file }) => file === 'node').options.stdio, [
      'pipe',
      'pipe',
      'pipe',
    ]);
  }
});

test('the checker stays within 400 lines', () => {
  const source = readFileSync(new URL('./epic-done.mjs', import.meta.url), 'utf8');
  assert.ok(source.trimEnd().split('\n').length <= 400);
});
