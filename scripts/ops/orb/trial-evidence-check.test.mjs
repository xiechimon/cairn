import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkTrialEvidence } from './trial-evidence-check.mjs';

const sha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
const distSha = 'c'.repeat(9);
const distFullSha = 'c'.repeat(40);
const evidence = () => ({
  repo: 'xiechimon/cairn',
  issue: 17,
  buildId: 'build-1',
  conversationId: 'build-1',
  orbName: 'cairn-orb-build-1',
  machinectlStatus: 'State: running',
  pr: 23,
  mergeCommit: sha,
  distRelease: {
    key: `0.2.2-${distSha}-dist-0123456789abcdef`,
    version: '0.2.2',
    sha: distSha,
    fullSha: distFullSha,
  },
  labelsBefore: ['by:pi'],
  labelsAfter: ['by:cairn', 'ready-for-agent'],
  lanesAfter: { pending: [18], mine: [], hold: [] },
  hostWorkspaceAbsent: true,
  hostWorkspacePath: '/workspace/build-1',
  claimedMachineId: 'omarchy-orb',
});

function world() {
  const data = {
    pull: {
      merged: true,
      merge_commit_sha: sha,
      head: {
        ref: 'cairn/conv-build-1',
        sha: headSha,
        repo: { full_name: 'xiechimon/cairn', fork: false },
      },
    },
    issue: { state: 'closed', state_reason: 'completed', labels: [{ name: 'by:cairn' }] },
    closing: {
      closingIssuesReferences: [
        { number: 17, url: 'https://github.com/xiechimon/cairn/issues/17' },
      ],
    },
    compare: { status: 'ahead' },
    distCompare: { status: 'ahead' },
    pushCompare: { status: 'diverged' },
    headCommit: { sha: headSha },
  };
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === 'pr') return JSON.stringify(data.closing);
    assert.equal(args[0], 'api');
    const path = args[1];
    if (path.endsWith('/pulls/23')) return JSON.stringify(data.pull);
    if (path.endsWith('/issues/17')) return JSON.stringify(data.issue);
    if (path.endsWith(`/compare/${headSha}...${sha}`)) return JSON.stringify(data.pushCompare);
    if (path.endsWith(`/compare/${distFullSha}...main`)) return JSON.stringify(data.distCompare);
    if (path.endsWith(`/compare/${sha}...main`)) return JSON.stringify(data.compare);
    if (path.endsWith(`/commits/${headSha}`)) return JSON.stringify(data.headCommit);
    throw new Error(`Unexpected gh: ${path}`);
  };
  const options = { runner, env: {} };
  return {
    data,
    calls,
    options,
    run: (file = evidence(), extra = {}) => checkTrialEvidence(file, { ...options, ...extra }),
  };
}

test('accepts a same-repository Thread branch without a merge trailer and prints push first', async () => {
  const w = world();
  const result = await w.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.lines, [
    'push: ok',
    'dist: ok',
    'server: skipped (CAIRN_SERVER_URL and CAIRN_API_TOKEN are both required)',
    'trial-one: ok',
  ]);
  assert.deepEqual(w.calls.slice(0, 3), [
    ['api', 'repos/xiechimon/cairn/pulls/23'],
    ['api', `repos/xiechimon/cairn/commits/${headSha}`],
    ['api', `repos/xiechimon/cairn/compare/${distFullSha}...main`],
  ]);
  w.data.distCompare.status = 'identical';
  w.data.compare.status = 'identical';
  w.data.pushCompare.status = 'identical';
  assert.equal((await w.run()).ok, true);
});

for (const [name, distRelease] of [
  ['missing', undefined],
  ['null', null],
  ['array', []],
  ['missing key', { version: '0.2.2', sha: distSha }],
  ['empty key', { ...evidence().distRelease, key: '' }],
  ['missing version', { key: `0.2.2-${distSha}`, sha: distSha }],
  ['empty version', { ...evidence().distRelease, version: ' ' }],
  ['missing sha', { key: `0.2.2-${distSha}`, version: '0.2.2' }],
  ['invalid sha', { ...evidence().distRelease, sha: '../main' }],
  [
    'four-character sha',
    { ...evidence().distRelease, sha: 'cccc', key: '0.2.2-cccc-dist-0123456789abcdef' },
  ],
  ['missing fullSha', { ...evidence().distRelease, fullSha: undefined }],
  ['short fullSha', { ...evidence().distRelease, fullSha: distSha }],
  ['invalid fullSha', { ...evidence().distRelease, fullSha: 'g'.repeat(40) }],
  ['uppercase fullSha', { ...evidence().distRelease, fullSha: distFullSha.toUpperCase() }],
  ['fullSha mismatch', { ...evidence().distRelease, fullSha: headSha }],
  [
    'missing left dash',
    { ...evidence().distRelease, key: `0.2.2${distSha}-dist-0123456789abcdef` },
  ],
  [
    'missing right dash',
    { ...evidence().distRelease, key: `0.2.2-${distSha}dist-0123456789abcdef` },
  ],
  [
    'dirty key',
    { ...evidence().distRelease, key: `${evidence().distRelease.key}-dirty-0123456789abcdef` },
  ],
  ['key/sha mismatch', { ...evidence().distRelease, key: `0.2.2-${headSha}` }],
]) {
  test(`rejects invalid dist release: ${name}`, async () => {
    const w = world();
    const result = await w.run({ ...evidence(), distRelease });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith('dist:')));
    assert.ok(result.lines.some((line) => line.startsWith('dist:')));
    assert.ok(!result.lines.includes('dist: ok'));
    assert.ok(!result.lines.includes('trial-one: ok'));
    assert.equal(w.calls.length, 0);
  });
}

for (const length of [7, 40]) {
  test(`accepts a ${length}-character release SHA and compares fullSha`, async () => {
    const w = world();
    const sha = distFullSha.slice(0, length);
    const result = await w.run({
      ...evidence(),
      distRelease: { ...evidence().distRelease, sha, key: `0.2.2-${sha}-dist-0123456789abcdef` },
    });
    assert.equal(result.ok, true);
    assert.ok(
      w.calls.some((args) => args[1] === `repos/xiechimon/cairn/compare/${distFullSha}...main`),
    );
  });
}

for (const status of ['behind', 'diverged', undefined]) {
  test(`rejects a dist SHA not on main: ${status}`, async () => {
    const w = world();
    w.data.distCompare.status = status;
    const result = await w.run();
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, ['dist: release SHA is not reachable from main']);
    assert.equal(result.lines[0], 'push: ok');
    assert.ok(!result.lines.includes('dist: ok'));
    assert.ok(!result.lines.includes('trial-one: ok'));
    assert.ok(
      w.calls.some((args) => args[1] === `repos/xiechimon/cairn/compare/${distFullSha}...main`),
    );
  });
}

test('dist GitHub read failures fail closed', async () => {
  for (const response of ['unavailable', 'invalid JSON', 'null']) {
    const w = world();
    const result = await w.run(evidence(), {
      runner: async (args) => {
        if (args[1] === `repos/xiechimon/cairn/compare/${distFullSha}...main`) {
          if (response === 'unavailable') throw new Error('network unavailable');
          return response;
        }
        return w.options.runner(args);
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, ['dist: GitHub read failed']);
    assert.equal(result.lines[0], 'push: ok');
    assert.ok(!result.lines.includes('dist: ok'));
    assert.ok(!result.lines.includes('trial-one: ok'));
  }
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
    'branch-join',
    (d) => {
      d.pull.head.ref = 'cairn/conv-build-10';
    },
  ],
  [
    'branch-join',
    (d) => {
      d.pull.head.repo.full_name = 'fork/repo';
    },
  ],
  [
    'branch-join',
    (d) => {
      d.pull.head.repo.fork = true;
    },
  ],
  [
    'branch-join',
    (d) => {
      d.pull.head.repo = null;
    },
  ],
  [
    'branch-join',
    (d) => {
      delete d.pull.head.repo.fork;
    },
  ],
  [
    'push',
    (d) => {
      d.pull.head.sha = '';
    },
  ],
  [
    'push',
    (d) => {
      delete d.pull.head;
    },
  ],
  [
    'push',
    (d) => {
      d.headCommit.sha = sha;
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
  assert.ok(!result.lines.includes('push: ok'));
  const unavailable = await w.run(evidence(), {
    runner: async () => {
      throw new Error('network unavailable');
    },
  });
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.lines[0], /^push:/);
  assert.ok(!unavailable.lines.includes('push: ok'));
});

function serverWorld() {
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
      { id: 'step-2', buildId: 'build-1', kind: 'merge', machineId: 'other-machine' },
    ],
    '/api/todos/todo-1': { teamId: 'team-1', sourceRef: 'github:xiechimon/cairn#17' },
    '/api/teams/team-1/machines': [{ id: 'machine-uuid', name: 'omarchy-orb' }],
  };
  const options = {
    env: { CAIRN_SERVER_URL: 'http://server.test/', CAIRN_API_TOKEN: 'test-token' },
    fetchImpl: async (url, init) => {
      calls.push(url);
      assert.equal(init.headers.authorization, 'Bearer test-token');
      assert.equal(init.redirect, 'error');
      const value = responses[new URL(url).pathname];
      assert.ok(value);
      return new Response(JSON.stringify(value), { status: 200 });
    },
  };
  return { responses, calls, run: (file = evidence()) => w.run(file, options) };
}

test('verifies the server build, Thread and claimed machine after push', async () => {
  const w = serverWorld();
  const result = await w.run();
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, ['push: ok', 'dist: ok', 'server: checked', 'trial-one: ok']);
  assert.equal(w.calls.length, 4);
  w.responses['/api/teams/team-1/machines'][0].name = 'omarchy';
  const failed = await w.run();
  assert.equal(failed.ok, false);
  assert.equal(failed.lines[0], 'push: ok');
  assert.ok(!failed.lines.includes('server: checked'));
});

for (const [name, mutate] of [
  [
    'server-build',
    (r) => {
      r['/api/builds/build-1'].id = 'other';
    },
  ],
  [
    'server-build',
    (r) => {
      r['/api/todos/todo-1'].sourceRef = 'github:xiechimon/cairn#18';
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'] = [];
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'][0].machineId = null;
    },
  ],
  [
    'server-machine',
    (r) => {
      delete r['/api/builds/build-1/steps'][0].machineId;
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'][0].machineId = 'other';
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'][0].buildId = 'other';
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'][0].kind = 'plan';
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/teams/team-1/machines'] = [];
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/teams/team-1/machines'].push({ id: 'other', name: 'omarchy-orb' });
    },
  ],
  [
    'server-machine',
    (r) => {
      delete r['/api/teams/team-1/machines'][0].id;
    },
  ],
  [
    'server-machine',
    (r) => {
      r['/api/builds/build-1/steps'].push({
        buildId: 'build-1',
        kind: 'build',
        machineId: 'other',
      });
    },
  ],
]) {
  test(`rejects inconsistent server evidence: ${name} ${mutate}`, async () => {
    const w = serverWorld();
    mutate(w.responses);
    const result = await w.run();
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith(`${name}:`)));
    assert.ok(!result.lines.includes('server: checked'));
  });
}

test('rejects a conversation that does not match the server build identity', async () => {
  const w = world();
  w.data.pull.head.ref = 'cairn/conv-other';
  const result = await w.run(
    {
      ...evidence(),
      conversationId: 'other',
      orbName: 'cairn-orb-other',
      hostWorkspacePath: '/workspace/other',
    },
    {
      env: { CAIRN_SERVER_URL: 'http://server.test', CAIRN_API_TOKEN: 'test-token' },
      fetchImpl: async (url) => {
        const responses = serverWorld().responses;
        return new Response(JSON.stringify(responses[new URL(url).pathname]));
      },
    },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((line) => line.startsWith('server-build:')));
});

for (const env of [
  {},
  { CAIRN_SERVER_URL: 'http://server.test' },
  { CAIRN_API_TOKEN: 'test-token' },
]) {
  test(`skips server reads unless both settings exist: ${Object.keys(env)}`, async () => {
    const result = await world().run(evidence(), {
      env,
      fetchImpl: async () => {
        throw new Error('must not fetch');
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.lines[0], 'push: ok');
    assert.equal(result.lines[1], 'dist: ok');
    assert.match(result.lines[2], /^server: skipped/);
  });
}

for (const endpoint of [`commits/${headSha}`]) {
  test(`push fails first when GitHub cannot read ${endpoint}`, async () => {
    const w = world();
    const result = await w.run(evidence(), {
      runner: async (args) => {
        if (args[1].endsWith(endpoint)) throw new Error('not found');
        return w.options.runner(args);
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.lines[0], /^push:/);
    assert.ok(!result.lines.includes('push: ok'));
  });
}

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
      fileURLToPath(new URL('./trial-evidence-check.mjs', import.meta.url)),
      '/missing/trial-evidence.json',
    ],
    { encoding: 'utf8', cwd: '/tmp' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /evidence-file:/);
});

test('CLI prints push first using fake GitHub and an authenticated local server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-trial-'));
  const w = world();
  const responses = serverWorld().responses;
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer cli-test-token');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responses[req.url]));
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    writeFileSync(join(dir, 'world.json'), JSON.stringify(w.data));
    writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evidence()));
    writeFileSync(
      join(dir, 'gh'),
      `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.env.TRIAL_WORLD, 'utf8'));
const path = process.argv[3];
const value = process.argv[2] === 'pr' ? data.closing
  : path.endsWith('/pulls/23') ? data.pull
  : path.endsWith('/issues/17') ? data.issue
  : path.endsWith('/commits/${headSha}') ? data.headCommit
  : path.endsWith('/compare/${headSha}...${sha}') ? data.pushCompare
  : path.endsWith('/compare/${distFullSha}...main') ? data.distCompare
  : path.endsWith('/compare/${sha}...main') ? data.compare : null;
if (!value) process.exit(1);
process.stdout.write(JSON.stringify(value));
`,
      { mode: 0o700 },
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('./trial-evidence-check.mjs', import.meta.url)),
        join(dir, 'evidence.json'),
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          TRIAL_WORLD: join(dir, 'world.json'),
          CAIRN_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
          CAIRN_API_TOKEN: 'cli-test-token',
        },
        timeout: 15_000,
      },
    );
    assert.equal(result.stdout, 'push: ok\ndist: ok\nserver: checked\ntrial-one: ok\n');
    assert.equal(requests.length, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const labels of [[], [{ name: 'by:pi' }], [{ name: 'by:cairn' }, { name: 'batch:now' }]]) {
  test(`rejects live issue labels ${JSON.stringify(labels)}`, async () => {
    const w = world();
    w.data.issue.labels = labels;
    const result = await w.run();
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith('live-labels:')));
  });
}

test('requires a closing reference to the trial issue in this repository', async () => {
  for (const references of [
    [],
    [{ number: 18 }],
    [{ number: 17, url: 'https://github.com/other/repo/issues/17' }],
  ]) {
    const w = world();
    w.data.closing.closingIssuesReferences = references;
    const result = await w.run();
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((line) => line.startsWith('pr-closes-issue:')));
  }
});

test('rejects a repository override before GitHub reads', async () => {
  const w = world();
  assert.equal((await w.run({ ...evidence(), repo: 'other/repo' })).ok, false);
  assert.equal(w.calls.length, 0);
});
