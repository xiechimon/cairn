import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';
import { buildTrialReport, renderTrialTable } from './trial-report.mjs';

function fixture() {
  const input = {
    repo: 'xiechimon/cairn',
    finishedAt: 2000,
    attempts: Array.from({ length: 20 }, (_, i) => ({ issue: 3000 + i, buildId: `trial-${i}` })),
    reasons: Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        3010 + i,
        { code: 'agent_gave_up', detail: 'Stopped after the bounded retry budget.' },
      ]),
    ),
    canary: {
      checkedAt: 3000,
      result: {
        ok: true,
        routes: Object.fromEntries(
          ['directRead', 'symlinkPush', 'socketAndServer', 'sudoRead'].map((key) => [
            key,
            [{ target: key, blocked: true }],
          ]),
        ),
        pushedObjectsClean: true,
        negativeObjectsContainMarker: true,
        githubReach: { ok: true },
        sentinelsRemaining: [],
      },
    },
  };
  const data = {};
  const pulls = {};
  for (const [i, attempt] of input.attempts.entries()) {
    data[`/api/builds/${attempt.buildId}`] = {
      id: attempt.buildId,
      todoId: `todo-${i}`,
      prNumber: i < 10 ? 4000 + i : null,
      createdAt: 1000,
    };
    data[`/api/builds/${attempt.buildId}/steps`] = [
      {
        id: `step-${i}`,
        buildId: attempt.buildId,
        kind: i % 2 ? 'session' : 'build',
        machineId: 'orb-machine',
        status: i < 10 ? 'done' : 'failed',
      },
    ];
    data[`/api/todos/todo-${i}`] = {
      id: `todo-${i}`,
      teamId: 'team',
      sourceRef: `github:xiechimon/cairn#${attempt.issue}`,
    };
    pulls[4000 + i] = {
      number: 4000 + i,
      merged: true,
      merged_at: new Date(1500).toISOString(),
      merge_commit_sha: String(i).padStart(40, 'a'),
      head: {
        ref: `cairn/conv-${attempt.buildId}`,
        repo: { full_name: 'xiechimon/cairn', fork: false },
      },
    };
  }
  data['/api/teams/team/machines'] = [{ id: 'orb-machine', name: 'omarchy-orb' }];
  return {
    input,
    data,
    pulls,
    comparisons: {},
    issues: {},
    env: { CAIRN_SERVER_URL: 'http://fixture.invalid', CAIRN_API_TOKEN: 'fixture-token' },
    async fetchImpl(url, options) {
      assert.equal(options.headers.authorization, 'Bearer fixture-token');
      assert.equal(options.redirect, 'error');
      const path = new URL(url).pathname;
      assert.ok(Object.hasOwn(data, path), path);
      return { ok: true, json: async () => structuredClone(data[path]) };
    },
    async runner(args) {
      if (args[0] === 'pr') {
        const pr = Number(args[2]);
        return JSON.stringify({
          closingIssuesReferences: [
            { number: pr - 1000, url: `https://github.com/xiechimon/cairn/issues/${pr - 1000}` },
          ],
        });
      }
      const path = args[1];
      const issue = /\/issues\/(\d+)$/.exec(path)?.[1];
      if (issue)
        return JSON.stringify(
          this.issues?.[issue] ?? {
            number: Number(issue),
            labels: [{ name: 'by:cairn' }],
            state: 'closed',
            state_reason: 'completed',
          },
        );
      const pr = /\/pulls\/(\d+)$/.exec(path)?.[1];
      if (pr) return JSON.stringify(pulls[pr]);
      const sha = /\/compare\/([a-f0-9]{40})\.\.\.main$/.exec(path)?.[1];
      assert.ok(sha, path);
      return JSON.stringify({ status: this.comparisons?.[sha] ?? 'ahead' });
    },
  };
}

async function report(f) {
  return buildTrialReport(f.input, {
    env: f.env,
    fetchImpl: f.fetchImpl,
    runner: f.runner.bind(f),
  });
}

test('20 distinct tickets, ten reachable merged PRs and fixed failure reasons pass', async () => {
  const result = await report(fixture());
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.total, 20);
  assert.equal(result.merged, 10);
  assert.equal(result.rows[10].reason.code, 'agent_gave_up');
  assert.deepEqual(result.rows[0].attempts[0], {
    buildId: 'trial-0',
    todoId: 'todo-0',
    sourceRef: 'github:xiechimon/cairn#3000',
    createdAt: 1000,
    machineId: 'orb-machine',
    executionSteps: [{ id: 'step-0', kind: 'build', machineId: 'orb-machine', status: 'done' }],
    pr: 4000,
    mergeCommit: '0'.padStart(40, 'a'),
    mergedAt: 1500,
    reachableFromMain: true,
  });
  assert.match(renderTrialTable(result), /\| #3000 \| trial-0 \| #4000 \| merged \|/);
});

test('retries and duplicate input rows count once per issue and build', async () => {
  const f = fixture();
  f.input.attempts.push({ issue: 3000, buildId: 'retry' }, f.input.attempts[0]);
  f.data['/api/builds/retry'] = { ...f.data['/api/builds/trial-0'], id: 'retry', prNumber: null };
  f.data['/api/builds/retry/steps'] = [
    { buildId: 'retry', kind: 'session', machineId: 'orb-machine', status: 'failed' },
  ];
  const result = await report(f);
  assert.equal(result.ok, true, result.failures.join('\n'));
  assert.equal(result.total, 20);
  assert.equal(result.merged, 10);
  assert.deepEqual(result.rows[0].buildIds, ['trial-0', 'retry']);
});

for (const [name, change] of [
  [
    'foreign ownership label',
    (f) => {
      f.issues[3000] = { number: 3000, labels: [{ name: 'by:lane2' }] };
    },
  ],
  [
    'mixed ownership labels',
    (f) => {
      f.issues[3000] = { number: 3000, labels: [{ name: 'by:cairn' }, { name: 'batch:now' }] };
    },
  ],
  [
    'merged Thread still awaiting a user reply',
    (f) => {
      f.data['/api/todos/todo-0'].awaitingReply = true;
    },
  ],
  [
    'merged issue still open',
    (f) => {
      f.issues[3000] = { number: 3000, labels: [{ name: 'by:cairn' }], state: 'open' };
    },
  ],
  [
    'missing build',
    (f) => {
      f.data['/api/builds/trial-0'] = null;
    },
  ],
  [
    'wrong todo',
    (f) => {
      f.data['/api/todos/todo-0'].sourceRef = 'github:xiechimon/cairn#9999';
    },
  ],
  [
    'wrong build identity',
    (f) => {
      f.data['/api/builds/trial-0'].id = 'other';
    },
  ],
  [
    'wrong todo identity',
    (f) => {
      f.data['/api/todos/todo-0'].id = 'other';
    },
  ],
  [
    'foreign machine',
    (f) => {
      f.data['/api/builds/trial-0/steps'][0].machineId = 'host';
    },
  ],
  [
    'mixed machine sessions',
    (f) => {
      f.data['/api/builds/trial-0/steps'].push({
        buildId: 'trial-0',
        kind: 'session',
        machineId: 'host',
        status: 'done',
      });
    },
  ],
  [
    'no claimed execution',
    (f) => {
      f.data['/api/builds/trial-0/steps'][0].kind = 'review';
    },
  ],
  [
    'unclaimed execution',
    (f) => {
      f.data['/api/builds/trial-0/steps'][0].machineId = null;
    },
  ],
  [
    'foreign build step',
    (f) => {
      f.data['/api/builds/trial-0/steps'][0].buildId = 'other';
    },
  ],
  [
    'ambiguous enrolled name',
    (f) => {
      f.data['/api/teams/team/machines'].push({ id: 'other', name: 'omarchy-orb' });
    },
  ],
  [
    'uncompleted merged execution',
    (f) => {
      f.data['/api/builds/trial-0/steps'][0].status = 'claimed';
    },
  ],
  [
    'foreign PR branch',
    (f) => {
      f.pulls[4000].head.ref = 'unrelated';
    },
  ],
  [
    'fork PR',
    (f) => {
      f.pulls[4000].head.repo.fork = true;
    },
  ],
  [
    'foreign PR repository',
    (f) => {
      f.pulls[4000].head.repo.full_name = 'other/repo';
    },
  ],
  [
    'unreachable merge',
    (f) => {
      f.comparisons[f.pulls[4000].merge_commit_sha] = 'diverged';
    },
  ],
  [
    'canary before an actual merge',
    (f) => {
      f.pulls[4000].merged_at = new Date(4000).toISOString();
    },
  ],
  [
    'missing merge time',
    (f) => {
      delete f.pulls[4000].merged_at;
    },
  ],
  [
    'malformed merge time',
    (f) => {
      f.pulls[4000].merged_at = 'unknown';
    },
  ],
  [
    'unmerged PR',
    (f) => {
      f.pulls[4000].merged = false;
    },
  ],
  [
    'missing reason',
    (f) => {
      delete f.input.reasons[3010];
    },
  ],
  [
    'unknown reason',
    (f) => {
      f.input.reasons[3010].code = 'looks_good';
    },
  ],
  [
    'blank reason detail',
    (f) => {
      f.input.reasons[3010].detail = ' ';
    },
  ],
  [
    'less than 20 tickets',
    (f) => {
      f.input.attempts.pop();
    },
  ],
  [
    'fewer than ten merges',
    (f) => {
      f.data['/api/builds/trial-0'].prNumber = null;
      f.input.reasons[3000] = { code: 'review_blocked', detail: 'Waiting for review.' };
    },
  ],
  [
    'bad canary',
    (f) => {
      f.input.canary.result.ok = false;
    },
  ],
  [
    'open sudo route',
    (f) => {
      f.input.canary.result.routes.sudoRead[0].blocked = false;
    },
  ],
  [
    'missing sudo probe',
    (f) => {
      delete f.input.canary.result.routes.sudoRead;
    },
  ],
  [
    'open host route',
    (f) => {
      f.input.canary.result.routes.directRead[0].blocked = false;
    },
  ],
  [
    'missing route group',
    (f) => {
      delete f.input.canary.result.routes.symlinkPush;
    },
  ],
  [
    'empty route group',
    (f) => {
      f.input.canary.result.routes.socketAndServer = [];
    },
  ],
  [
    'remaining sentinel',
    (f) => {
      f.input.canary.result.sentinelsRemaining = ['leftover'];
    },
  ],
  [
    'pre-trial canary',
    (f) => {
      f.input.canary.checkedAt = 1000;
    },
  ],
  [
    'unfinished trial',
    (f) => {
      f.input.finishedAt = 500;
    },
  ],
]) {
  test(`fails closed: ${name}`, async () => {
    const f = fixture();
    change(f);
    const result = await report(f);
    assert.equal(result.ok, false);
    assert.ok(result.failures.length > 0);
  });
}

test('GitHub and server failures do not become reason-only successes or print credentials', async () => {
  for (const key of ['runner', 'fetchImpl']) {
    const f = fixture();
    f[key] = async () => {
      throw new Error('Bearer private-token /private/home');
    };
    const result = await report(f);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes('private-token'), false);
    assert.equal(JSON.stringify(result).includes('/private/home'), false);
  }
});

test('every fixed reason code is accepted without changing the denominator', async () => {
  for (const code of [
    'setup_failed',
    'orb_start_failed',
    'agent_gave_up',
    'review_blocked',
    'ci_red',
    'timeout',
    'other',
  ]) {
    const f = fixture();
    f.input.reasons[3010].code = code;
    assert.equal((await report(f)).ok, true, code);
  }
});

test('one build cannot count for two issues, and invalid input cannot trigger network reads', async () => {
  const f = fixture();
  f.input.attempts[1].buildId = 'trial-0';
  assert.equal((await report(f)).ok, false);
  for (const input of [
    null,
    {},
    { repo: 'foreign/repo', attempts: [{}] },
    { repo: 'xiechimon/cairn', attempts: [] },
  ]) {
    const result = await buildTrialReport(input, {
      fetchImpl: () => assert.fail('unexpected HTTP'),
      runner: () => assert.fail('unexpected GitHub'),
    });
    assert.equal(result.ok, false);
  }
});

test('an unrelated closing reference cannot count as a merged issue', async () => {
  const f = fixture();
  const original = f.runner.bind(f);
  f.runner = async (args) =>
    args[0] === 'pr' ? JSON.stringify({ closingIssuesReferences: [] }) : original(args);
  assert.equal((await report(f)).ok, false);
});

test('table escapes operator reason text into one row', async () => {
  const f = fixture();
  f.input.reasons[3010].detail = 'a|b\nnext';
  const text = renderTrialTable(await report(f));
  assert.ok(text.includes('a\\|b next'));
  assert.equal(text.split('\n').length, 22);
});

test('CLI joins real authenticated HTTP and a stateful gh executable without node_modules', async (t) => {
  const f = fixture();
  const root = makeTestTempDir('trial-report-');
  t.after(() => releaseTestTempDir(root));
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    const value = f.data[req.url];
    res.writeHead(value === undefined ? 404 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value ?? {}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((done) => server.close(done)));
  const gh = join(root, 'gh');
  const github = {};
  for (const attempt of f.input.attempts) {
    github[`repos/xiechimon/cairn/issues/${attempt.issue}`] = {
      number: attempt.issue,
      labels: [{ name: 'by:cairn' }],
      state: 'closed',
      state_reason: 'completed',
    };
  }
  for (const pull of Object.values(f.pulls)) {
    github[`repos/xiechimon/cairn/pulls/${pull.number}`] = pull;
    github[`repos/xiechimon/cairn/compare/${pull.merge_commit_sha}...main`] = { status: 'ahead' };
    github[`pr-${pull.number}`] = {
      closingIssuesReferences: [
        {
          number: pull.number - 1000,
          url: `https://github.com/xiechimon/cairn/issues/${pull.number - 1000}`,
        },
      ],
    };
  }
  writeFileSync(join(root, 'github.json'), JSON.stringify(github));
  writeFileSync(
    gh,
    `#!${process.execPath}\nimport {readFileSync} from 'node:fs';\nconst data=JSON.parse(readFileSync(process.env.TRIAL_GH_FIXTURE));\nconst key=process.argv[2]==='api'?process.argv[3]:'pr-'+process.argv[4];\nif(!Object.hasOwn(data,key))process.exit(1);\nprocess.stdout.write(JSON.stringify(data[key]));\n`,
  );
  chmodSync(gh, 0o700);
  async function runCli(args) {
    writeFileSync(join(root, 'input.json'), JSON.stringify(f.input));
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'trial-report.mjs'), ...args, join(root, 'input.json')],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          TRIAL_GH_FIXTURE: join(root, 'github.json'),
          CAIRN_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
          CAIRN_API_TOKEN: 'fixture-token',
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const [code] = await once(child, 'close');
    return { code, stdout, stderr };
  }
  const passing = await runCli(['--check']);
  assert.equal(passing.code, 0, passing.stderr + passing.stdout);
  assert.equal(JSON.parse(passing.stdout).total, 20);
  assert.equal(JSON.parse(passing.stdout).ok, true);
  assert.equal(passing.stdout.includes('fixture-token'), false);
  f.input.attempts = f.input.attempts.slice(10);
  const incomplete = await runCli(['--check']);
  assert.equal(incomplete.code, 1, incomplete.stderr);
  assert.equal(JSON.parse(incomplete.stdout).total, 10);
  const draft = await runCli([]);
  assert.equal(draft.code, 0);
  assert.equal(JSON.parse(draft.stdout).ok, false);
  const markdown = await runCli(['--check', '--markdown']);
  assert.equal(markdown.code, 1);
  assert.match(markdown.stdout, /agent_gave_up/);
});
