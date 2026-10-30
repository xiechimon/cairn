import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { after, test } from 'node:test';

const stateRoot = mkdtempSync(join(tmpdir(), 'epic-state-tests-'));
let stateIndex = 0;
after(() => rmSync(stateRoot, { recursive: true, force: true }));

import { decideEpic, main, validateManifest } from './epic-done.mjs';
import { selfTests } from './prepush.mjs';

const tip = 'a'.repeat(40);
const closing = 'b'.repeat(40);
const older = 'c'.repeat(40);
const outside = 'd'.repeat(40);
const date = '2026-10-29T12:00:00Z';
const now = new Date('2026-10-29T14:00:00Z');
const connection = (nodes) => ({ nodes, pageInfo: { hasNextPage: false } });
const commit = (oid) => ({ oid, committedDate: date });
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
    manifest: {
      epic: 'E1.0a',
      issues: [1234, 1235],
      requiredChecks: ['check', 'e2e-gate'],
      checks: [
        {
          name: 'policy',
          run: ['node', '--test', 'policy.test.mjs'],
          expectStdoutIncludes: 'pass',
        },
      ],
      maxHours: 6,
    },
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
      const intercepted = state.intercept?.(file, args, options);
      if (intercepted !== undefined) return intercepted;
      if (file === 'git') {
        if (args.includes('worktree')) return '';
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
        if (args.includes('HEAD')) return `${options.cwd === '/checkout' ? state.head : tip}\n`;
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
  return {
    state,
    deps,
    invoke: (args = []) =>
      main(['E1.0a', '--state', join(stateRoot, String(++stateIndex)), ...args], deps),
  };
}

function expectState(result, state, exitCode, pattern) {
  assert.equal(result.state, state, JSON.stringify(result));
  assert.equal(result.exitCode, exitCode);
  if (pattern) assert.match(result.reasons.join('\n'), pattern);
}

function realHarness(t) {
  const fixture = harness();
  const { state, deps } = fixture;
  const root = mkdtempSync(join(tmpdir(), 'epic-done-repo-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  t.after(() => {
    for (const { args } of state.calls.filter(({ args }) => args.includes('--detach'))) {
      const path = args[args.indexOf('--detach') + 1];
      spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: root });
      rmSync(dirname(path), { recursive: true, force: true });
    }
    rmSync(root, { recursive: true, force: true });
  });
  git(['init', '-q', '-b', 'main']);
  state.manifest.checks = [{ name: 'tracked', run: ['test', '-f', 'tracked.txt'] }];
  mkdirSync(join(root, '.claude/epics'), { recursive: true });
  writeFileSync(join(root, '.claude/epics/E1.0a.json'), JSON.stringify(state.manifest));
  writeFileSync(join(root, '.gitignore'), 'ignored-artifact.json\n');
  writeFileSync(join(root, 'tracked.txt'), 'main');
  git(['add', '.claude/epics/E1.0a.json', '.gitignore', 'tracked.txt']);
  const commitArgs = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Main fixture',
  ];
  git(commitArgs);
  const mainSha = git(['rev-parse', 'HEAD']).trim();
  state.remote = mainSha;
  state.checks = { [mainSha]: [checkPage(mainSha)] };
  for (const item of state.issues) item.timelineItems.nodes[0].closer.mergeCommit.oid = mainSha;
  git(['switch', '-qc', 'feature']);
  git([...commitArgs, '--allow-empty']);
  const stub = deps.run;
  deps.run = (file, args, options) => {
    if (file === 'gh') return stub(file, args, options);
    state.calls.push({ file, args, options });
    const intercepted = state.intercept?.(file, args, options);
    if (intercepted !== undefined) return intercepted;
    if (file !== 'git' && state.command) return state.command(file, args, options);
    return execFileSync(file, args, { ...options, cwd: options.cwd ?? root });
  };
  return { ...fixture, root, git, mainSha };
}

for (const artifact of ['required-artifact.json', 'ignored-artifact.json']) {
  test(`caller-only ${artifact} cannot satisfy frozen checks`, async (t) => {
    const { state, invoke, root, git } = realHarness(t);
    git(['switch', '-q', 'main']);
    writeFileSync(join(root, artifact), '{}');
    state.manifest.checks = [{ name: 'artifact', run: ['test', '-f', artifact] }];
    state.intercept = (file, args) => {
      if (file === 'git' && args[0] === 'show') return JSON.stringify(state.manifest);
    };
    const result = await invoke();
    expectState(result, 'incomplete', 10);
    assert.equal(result.checks[0].status, 'failed');
  });
}

test('tracked caller edits do not affect checks in the detached main tree', async (t) => {
  const { state, invoke, root, mainSha } = realHarness(t);
  writeFileSync(join(root, 'tracked.txt'), 'caller edit');
  state.intercept = (file, args) => {
    if (file === 'git' && args[0] === 'show')
      return JSON.stringify({
        ...state.manifest,
        checks: [{ name: 'content', run: ['cat', 'tracked.txt'], expectStdoutIncludes: 'main' }],
      });
  };
  const result = await invoke();
  expectState(result, 'complete', 0);
  assert.equal(result.facts.mainSha, mainSha);
  assert.equal(result.checks[0].stdout, 'main');
  assert.equal(readFileSync(join(root, 'tracked.txt'), 'utf8'), 'caller edit');
});

for (const outcome of [
  'success',
  'failure',
  'timeout',
  'midway error',
  'wrong HEAD',
  'add error',
]) {
  test(`temporary main worktree is removed after ${outcome}`, async (t) => {
    const { state, invoke, git, mainSha, root } = realHarness(t);
    const before = git(['worktree', 'list', '--porcelain']);
    let commands = 0;
    state.intercept = (file, args, options) => {
      if (file === 'git' && args[0] === 'show')
        return JSON.stringify({
          ...state.manifest,
          checks: [
            { name: 'head', run: ['git', 'rev-parse', 'HEAD'], expectStdoutIncludes: mainSha },
            { name: 'second', run: ['node', '--version'] },
          ],
        });
      if (args.includes('--detach')) {
        assert.deepEqual(args.slice(0, 5), [
          '-c',
          'core.hooksPath=/dev/null',
          'worktree',
          'add',
          '--detach',
        ]);
        assert.ok(isAbsolute(args[5]));
        assert.equal(args[6], mainSha);
        if (outcome === 'add error') {
          execFileSync(file, args, options);
          throw new Error('worktree setup interrupted');
        }
      }
      if (file === 'git' && args.join(' ') === 'rev-parse --verify HEAD' && options.cwd !== root) {
        if (outcome === 'wrong HEAD') return `${outside}\n`;
      }
      if (options.timeout === 900_000) {
        commands++;
        assert.notEqual(options.cwd, root);
        assert.equal(
          execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: options.cwd,
            encoding: 'utf8',
          }).trim(),
          mainSha,
        );
        if (file === 'node') {
          if (outcome === 'midway error') throw new Error('runner interrupted midway');
          if (outcome === 'timeout')
            throw Object.assign(new Error('check ETIMEDOUT'), { code: 'ETIMEDOUT' });
          if (outcome === 'failure') throw Object.assign(new Error('check failed'), { status: 1 });
        }
      }
    };
    const result = await invoke();
    const creation = state.calls.find(({ args }) => args.includes('--detach'));
    assert.ok(creation, 'checker must create a detached worktree');
    const path = creation.args[5];
    assert.equal(git(['worktree', 'list', '--porcelain']), before);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(dirname(path)), false);
    const setupFailed = outcome === 'wrong HEAD' || outcome === 'add error';
    assert.equal(commands, setupFailed ? 0 : 2);
    const unknown = setupFailed || outcome === 'midway error';
    expectState(
      result,
      unknown ? 'unknown' : outcome === 'success' ? 'complete' : 'incomplete',
      unknown ? 2 : outcome === 'success' ? 0 : 10,
    );
    if (!unknown) {
      assert.deepEqual(
        result.checks.map(({ name }) => name),
        ['head', 'second'],
      );
      assert.equal(result.checks[0].stdout.trim(), mainSha);
    }
    const calls = state.calls;
    const verifyIndex = calls.findIndex(({ args }) => args.join(' ') === 'rev-parse --verify HEAD');
    const firstCheckIndex = calls.findIndex(({ options }) => options.timeout === 900_000);
    if (!setupFailed) assert.ok(verifyIndex >= 0 && verifyIndex < firstCheckIndex);
  });
}

test('complete: closed issues, isolated remote-main checks and one green commit', async () => {
  const { state, invoke } = harness();
  const result = await invoke();
  expectState(result, 'complete', 0);
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
  assert.notEqual(execution.options.cwd, '/checkout');
  assert.ok(isAbsolute(execution.options.cwd));
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
  expectState(await invoke(), 'incomplete', 10, new RegExp(tip));
});

test('failure mode 5: older green cannot satisfy latest red main', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'incomplete', 10);
  assert.equal(result.greenSha, null);
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

test('caller edits and feature HEAD do not prevent checks at remote main', async () => {
  const { state, invoke } = harness();
  state.dirty = ' M tracked-file\n';
  state.head = outside;
  state.command = () => {
    state.head = older;
    return 'pass';
  };
  const result = await invoke();
  expectState(result, 'complete', 0);
  assert.equal(result.checks[0].status, 'passed');
  assert.ok(!Object.hasOwn(result.facts, 'worktree'));
  assert.ok(!state.calls.some(({ args }) => args[0] === 'status'));
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
    if (file === 'git' && args[0] === 'rev-list') throw new Error('git failed');
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
  expectState(await invoke(), 'incomplete', 10);
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
      expectState(await invoke(['--fail', 'stop']), 'failed', 30, /stop/);
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
  expectState(await invoke(['--pause', 'quota wait', '--fail', 'stop']), 'failed', 30, /stop/);
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
    'failed',
    30,
  );
});

test('commit closers must belong to main; the latest of multiple closing changes sets the boundary', async () => {
  const { state, invoke } = harness();
  state.issues[0].timelineItems.nodes[0].closer = { __typename: 'Commit', ...commit(outside) };
  expectState(await invoke(), 'incomplete', 10, /#1234.*main/);
  state.issues[0].timelineItems.nodes[0].closer.oid = tip;
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'incomplete', 10, new RegExp(tip));
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
  const { checks: _checks, facts: _facts, ...decision } = result;
  assert.deepEqual(decideEpic(facts), decision);
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
  assert.ok(selfTests.includes('scripts/epic-done.test.mjs'));
  const owners = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
  assert.match(owners, /^\/scripts\/epic-done\.mjs @xiechimon$/m);
  assert.match(owners, /^\/\.claude\/epics\/\*\* @xiechimon$/m);
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

test('only the latest main commit is examined', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [checkPage(tip, 'failure')];
  expectState(await invoke(), 'incomplete', 10);
  const calls = state.calls.filter(({ args }) => args.some((arg) => arg.includes('/check-runs')));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.some((arg) => arg.includes(`/commits/${tip}/`)));
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

test('missing or wrong latest commit facts cannot establish completion', async () => {
  const { invoke } = harness();
  const result = await invoke();
  for (const commits of [[], [{ ...result.facts.commits[0], sha: closing }]])
    expectState(decideEpic({ ...result.facts, commits }), 'unknown', 2);
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
  assert.ok(!state.calls.some(({ args }) => args[0] === 'status'));
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

for (const [args, expected] of [
  [['--pause', 'owner'], 'paused'],
  [['--fail', 'stop'], 'failed'],
  [['--started-at', '2026-10-29T00:00:00Z'], 'failed'],
]) {
  test(`stop condition ${args[0]} wins over completion`, async () => {
    const { invoke } = harness();
    const result = await invoke(args);
    assert.equal(result.state, expected);
  });
}

test('latest red main cannot borrow an older green commit', async () => {
  const { state, invoke } = harness();
  state.checks[tip] = [checkPage(tip, 'failure')];
  const result = await invoke();
  expectState(result, 'incomplete', 10);
  assert.equal(result.mainGreen, false);
});

function batchHarness() {
  const fixture = harness();
  delete fixture.state.manifest.issues;
  fixture.state.manifest.items = [
    { id: 'owner', issue: 1234, dependsOn: [], humanHeld: true },
    { id: 'child', issue: 1235, dependsOn: ['owner'] },
    { id: 'grandchild', issue: 1236, dependsOn: ['child'] },
    { id: 'independent', issue: 1237, dependsOn: [] },
  ];
  fixture.state.issues = [1234, 1235, 1236, 1237].map((number) => ({
    ...issue(number),
    state: 'OPEN',
    stateReason: null,
    timelineItems: connection([]),
  }));
  return fixture;
}

test('a human-held item blocks only its transitive dependents', async () => {
  const { invoke } = batchHarness();
  const result = await invoke();
  expectState(result, 'incomplete', 10);
  assert.deepEqual(result.humanHeld, ['owner']);
  assert.deepEqual(result.blocked, ['child', 'grandchild']);
  assert.deepEqual(result.ready, ['independent']);
});

test('a batch pauses only when no independent item remains ready', async () => {
  const { state, invoke } = batchHarness();
  state.manifest.items.pop();
  state.issues.pop();
  expectState(await invoke(), 'paused', 20);
});

for (const green of [true, false]) {
  test(`all merged items with latest main green=${green}`, async () => {
    const { state, invoke } = batchHarness();
    state.issues = state.manifest.items.map((item, index) => {
      const value = issue(item.issue);
      value.timelineItems.nodes[0].closer.number = 100 + index;
      return value;
    });
    state.checks[tip] = [checkPage(tip, green ? 'success' : 'failure')];
    const result = await invoke();
    expectState(result, green ? 'complete' : 'incomplete', green ? 0 : 10);
    assert.ok(result.items.every((item) => item.status === 'done' && item.pr));
  });
}

test('state preserves the original start and accumulates hours across runs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'batch-state-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const { state, deps, invoke } = batchHarness();
  state.manifest.maxHours = 1;
  await invoke(['--state', path]);
  const first = JSON.parse(readFileSync(path, 'utf8'));
  deps.now = () => new Date(now.getTime() + 3600000);
  const result = await invoke(['--state', path, '--started-at', now.toISOString()]);
  expectState(result, 'failed', 30);
  const second = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(second.startedAt, first.startedAt);
  assert.equal(second.activeHours, 1);
  assert.equal(second.phase, 'failed');
});

test('newest run per name wins regardless of response order', async () => {
  for (const conclusion of ['success', 'failure', null]) {
    const { state, invoke } = harness();
    state.checks[tip][0].check_runs.unshift(runRecord(tip, 'check', conclusion, 9));
    state.checks[tip][0].total_count++;
    expectState(
      await invoke(),
      conclusion === 'success' ? 'complete' : 'incomplete',
      conclusion === 'success' ? 0 : 10,
    );
  }
});

test('invalid DAGs fail closed before running checks', async () => {
  for (const mutate of [
    (items) => {
      items[0].dependsOn = ['missing'];
    },
    (items) => {
      items[0].dependsOn = ['grandchild'];
    },
    (items) => {
      items[0].dependsOn = ['owner'];
    },
    (items) => {
      items[1].id = 'owner';
    },
  ]) {
    const { state, invoke } = batchHarness();
    mutate(state.manifest.items);
    expectState(await invoke(), 'unknown', 2);
    assert.ok(!state.calls.some(({ file }) => file === 'node'));
  }
});

test('owner-waiting open PR is reported and blocks dependents', async () => {
  const { state, invoke } = batchHarness();
  state.manifest.items[0].humanHeld = false;
  state.issues[0].closedByPullRequestsReferences = connection([
    { number: 88, state: 'OPEN', labels: connection([{ name: 'waits-ian' }]) },
  ]);
  const result = await invoke();
  assert.deepEqual(result.humanHeld, ['owner']);
  assert.equal(result.items[0].pr, 88);
  assert.deepEqual(result.ready, ['independent']);
});

test('v2 requires a merged PR and accepts linked closing references as fallback', async () => {
  const { state, invoke } = batchHarness();
  state.manifest.items = [{ id: 'one', issue: 1234, dependsOn: [] }];
  state.issues = [issue(1234)];
  state.issues[0].timelineItems.nodes[0].closer = { __typename: 'Commit', oid: closing };
  expectState(await invoke(), 'incomplete', 10);
  state.issues[0].closedByPullRequestsReferences = connection([
    {
      number: 88,
      state: 'MERGED',
      merged: true,
      mergeCommit: commit(closing),
      labels: connection([]),
    },
  ]);
  expectState(await invoke(), 'complete', 0);
  state.issues[0].stateReason = 'NOT_PLANNED';
  expectState(await invoke(), 'incomplete', 10);
});

test('paused time is excluded and failure history survives reruns', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'batch-paused-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const { deps, invoke } = batchHarness();
  await invoke(['--state', path, '--pause', 'owner']);
  const first = JSON.parse(readFileSync(path, 'utf8'));
  deps.now = () => new Date(now.getTime() + 24 * 3600000);
  await invoke(['--state', path]);
  const second = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(second.activeHours, first.activeHours);
  assert.deepEqual(second.failureHistory.owner.slice(0, 1), first.failureHistory.owner);
});

test('a gathering error still preserves the first start and active budget', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'batch-error-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'state.json');
  const { state, deps, invoke } = batchHarness();
  state.manifest.maxHours = 1;
  state.intercept = (file, args) => {
    if (file === 'gh' && args[1] === 'graphql') throw new Error('offline');
  };
  expectState(await invoke(['--state', path]), 'unknown', 2);
  state.intercept = undefined;
  deps.now = () => new Date(now.getTime() + 3600000);
  expectState(await invoke(['--state', path]), 'failed', 30);
});

test('time spent running checks counts before declaring completion', async () => {
  const { state, deps, invoke } = harness();
  state.manifest.maxHours = 1;
  let current = now;
  deps.now = () => current;
  state.command = () => {
    current = new Date(now.getTime() + 3600000);
    return 'pass';
  };
  expectState(await invoke(), 'failed', 30);
});

for (const stored of [null, {}, { phase: 'incomplete', activeHours: -1 }]) {
  test(`malformed persisted state ${JSON.stringify(stored)} cannot reset counters`, async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'batch-invalid-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'state.json');
    writeFileSync(path, JSON.stringify(stored));
    const { invoke } = harness();
    expectState(await invoke(['--state', path]), 'unknown', 2);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), stored);
  });
}

test('completion policy stays inside the owned manifest boundary', () => {
  const source = readFileSync(new URL('./epic-done.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/\.claude\/epics\/checker-policy\.mjs'/);
  const owners = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8');
  assert.match(owners, /^\/\.claude\/epics\/\*\* @xiechimon$/m);
});
