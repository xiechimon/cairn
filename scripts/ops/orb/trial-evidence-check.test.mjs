import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { checkTrialEvidence } from './trial-evidence-check.mjs';

const sha = 'a'.repeat(40);
const evidence = () => ({
  repo: 'owner/repo',
  issue: 17,
  buildId: 'build-1',
  conversationId: 'build-1',
  orbName: 'cairn-orb-build-1',
  machinectlStatus: 'State: running',
  pr: 23,
  mergeCommit: sha,
  labelsBefore: ['by:pi'],
  labelsAfter: ['by:cairn', 'ready-for-agent'],
  lanesAfter: { pending: [18], mine: [], hold: [] },
  hostWorkspaceAbsent: true,
  hostWorkspacePath: '/workspace/build-1',
  claimedMachineId: 'omarchy-orb',
});

function world() {
  const data = {
    pull: { merged: true, merge_commit_sha: sha },
    issue: { state: 'closed', state_reason: 'completed' },
    compare: { status: 'ahead' },
    commit: { commit: { message: 'Delivery\n\nSynthetic-Build: build-1' } },
  };
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    assert.equal(args[0], 'api');
    const path = args[1];
    if (path.endsWith('/pulls/23')) return JSON.stringify(data.pull);
    if (path.endsWith('/issues/17')) return JSON.stringify(data.issue);
    if (path.includes('/compare/')) return JSON.stringify(data.compare);
    if (path.endsWith(`/commits/${sha}`)) return JSON.stringify(data.commit);
    throw new Error(`Unexpected gh: ${path}`);
  };
  const options = { runner, env: {}, buildTrailerFor: (buildId) => `Synthetic-Build: ${buildId}` };
  return {
    data,
    calls,
    options,
    run: (file = evidence(), extra = {}) => checkTrialEvidence(file, { ...options, ...extra }),
  };
}

test('all checks pass with an explicitly injected synthetic trailer contract and no server', async () => {
  const w = world();
  const result = await w.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.lines, ['server: skipped (no CAIRN_SERVER_URL)', 'trial-one: ok']);
  assert.ok(w.calls.some((args) => args[1] === `repos/owner/repo/compare/${sha}...main`));
  w.data.compare.status = 'identical';
  assert.equal((await w.run()).ok, true);
});

test('the default fails closed while the production B1 trailer contract is unavailable', async () => {
  const w = world();
  const result = await checkTrialEvidence(evidence(), { runner: w.options.runner, env: {} });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((line) => line.startsWith('build-trailer-contract-unavailable')));
  assert.ok(!result.lines.includes('trial-one: ok'));
});

for (const [name, patch] of [
  ['issue', { issue: 0 }],
  ['buildId', { buildId: '' }],
  ['conversationId', { conversationId: '' }],
  ['orbName', { orbName: 'other' }],
  ['machinectlStatus', { machinectlStatus: '  ' }],
  ['pr', { pr: -1 }],
  ['mergeCommit', { mergeCommit: 'short' }],
  ['labelsBefore', { labelsBefore: null }],
  ['labelsAfter', { labelsAfter: ['ready-for-agent'] }],
  ['labelsAfter', { labelsAfter: ['by:cairn', 'by:pi'] }],
  ['labelsAfter', { labelsAfter: ['by:cairn', 'batch:later'] }],
  ['labelsAfter', { labelsAfter: ['by:cairn', 'batch:Backlog'] }],
  ['lanesAfter', { lanesAfter: { pending: [17], mine: [], hold: [] } }],
  ['lanesAfter', { lanesAfter: { pending: [], mine: ['17'], hold: [] } }],
  ['lanesAfter', { lanesAfter: { pending: [], mine: [], hold: [17] } }],
  ['lanesAfter', { lanesAfter: { pending: [], mine: [] } }],
  ['hostWorkspaceAbsent', { hostWorkspaceAbsent: false }],
  ['hostWorkspacePath', { hostWorkspacePath: '' }],
  ['hostWorkspacePath', { hostWorkspacePath: '/workspace/other' }],
  ['claimedMachineId', { claimedMachineId: 'omarchy' }],
  ['repo', { repo: '../repo' }],
]) {
  test(`rejects invalid ${name}: ${JSON.stringify(patch)}`, async () => {
    const w = world();
    const result = await w.run({ ...evidence(), ...patch });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith(`${name}:`)));
    assert.ok(!result.lines.includes('trial-one: ok'));
    assert.equal(w.calls.length, 0);
  });
}

for (const [name, mutate] of [
  [
    'pr-merged',
    (d) => {
      d.pull.merged = false;
    },
  ],
  [
    'merge-commit',
    (d) => {
      d.pull.merge_commit_sha = 'b'.repeat(40);
    },
  ],
  [
    'main-reachable',
    (d) => {
      d.compare.status = 'behind';
    },
  ],
  [
    'main-reachable',
    (d) => {
      d.compare.status = 'diverged';
    },
  ],
  [
    'issue-completed',
    (d) => {
      d.issue.state = 'open';
    },
  ],
  [
    'issue-completed',
    (d) => {
      d.issue.state_reason = 'not_planned';
    },
  ],
  [
    'build-trailer',
    (d) => {
      d.commit.commit.message = 'No trailer';
    },
  ],
  [
    'build-trailer',
    (d) => {
      d.commit.commit.message = 'Synthetic-Build: build-10';
    },
  ],
  [
    'build-trailer',
    (d) => {
      d.commit.commit.message = 'Quoted Synthetic-Build: build-1';
    },
  ],
]) {
  test(`rejects failed GitHub check ${name}`, async () => {
    const w = world();
    mutate(w.data);
    const result = await w.run();
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith(`${name}:`)));
  });
}

test('reports independent GitHub failures together and handles runner failures', async () => {
  const w = world();
  w.data.pull.merged = false;
  w.data.issue.state = 'open';
  const result = await w.run();
  assert.equal(result.failures.length, 2);
  const unavailable = await w.run(evidence(), {
    runner: async () => {
      throw new Error('network unavailable');
    },
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.failures.length, 4);
});

test('verifies a claimed build step using the server machine ID and its name', async () => {
  const w = world();
  const calls = [];
  const responses = {
    '/api/builds/build-1': { id: 'build-1', todoId: 'todo-1' },
    '/api/builds/build-1/steps': [
      {
        id: 'step-1',
        buildId: 'build-1',
        kind: 'build',
        status: 'done',
        machineId: 'machine-uuid',
      },
    ],
    '/api/todos/todo-1': { teamId: 'team-1', sourceRef: 'github:owner/repo#17' },
    '/api/teams/team-1/machines': [{ id: 'machine-uuid', name: 'omarchy-orb' }],
  };
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.authorization, 'Bearer test-token');
    assert.equal(init.redirect, 'error');
    const value = responses[new URL(url).pathname];
    assert.ok(value);
    return new Response(JSON.stringify(value), { status: 200 });
  };
  const options = {
    env: { CAIRN_SERVER_URL: 'http://server.test/', CAIRN_API_TOKEN: 'test-token' },
    fetchImpl,
  };
  assert.equal((await w.run(evidence(), options)).ok, true);
  assert.equal(calls.length, 4);
  responses['/api/teams/team-1/machines'][0].name = 'omarchy';
  assert.ok(
    (await w.run(evidence(), options)).failures.some((line) => line.startsWith('server-machine:')),
  );
  responses['/api/teams/team-1/machines'][0].name = 'omarchy-orb';
  responses['/api/builds/build-1/steps'][0].machineId = null;
  assert.equal((await w.run(evidence(), options)).ok, false);
  responses['/api/builds/build-1/steps'][0].machineId = 'machine-uuid';
  responses['/api/todos/todo-1'].sourceRef = 'github:owner/repo#18';
  assert.equal((await w.run(evidence(), options)).ok, false);
});

test('server HTTP failures fail closed and do not expose the token', async () => {
  const w = world();
  const result = await w.run(evidence(), {
    env: { CAIRN_SERVER_URL: 'http://server.test', CAIRN_API_TOKEN: 'secret-test-token' },
    fetchImpl: async () => new Response('unauthorized', { status: 401 }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((line) => line.startsWith('server:')));
  assert.ok(!JSON.stringify(result).includes('secret-test-token'));
});

test('CLI returns a named failure for a missing evidence file without node_modules', () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL('./trial-evidence-check.mjs', import.meta.url).pathname,
      '/missing/trial-evidence.json',
    ],
    { encoding: 'utf8', cwd: '/tmp' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /evidence-file:/);
});
