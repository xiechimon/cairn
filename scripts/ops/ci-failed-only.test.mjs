import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { readPlaywrightLastFailed } from '../ci-failed-only-state.mjs';
import { runPlan } from '../prepush.mjs';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  extractGoTestFailures,
  extractNodeTestFailedFiles,
  extractVitestFailedFiles,
  finalizeVitestRun,
  prepareVitestRun,
  readPrevState,
  recordStepState,
  selectNodeTestFiles,
  stripShardArgs,
} from './ci-failed-only.mjs';

test('readPrevState rejects missing, wrong-sha, wrong-run, wrong-attempt, wrong-job, and corrupt files', () => {
  const dir = makeTestTempDir('ci-failed-only-state-');
  try {
    const prevDir = join(dir, 'prev');
    mkdirSync(prevDir, { recursive: true });
    const base = { prevDir, sha: 'abc123', runId: '42', attempt: 2, jobKey: 'vitest-light-1' };

    assert.equal(readPrevState(base), null);

    writeFileSync(join(prevDir, 'state.json'), '{not-json');
    assert.equal(readPrevState(base), null);

    const valid = {
      version: 1,
      sha: 'abc123',
      runId: '42',
      attempt: 1,
      jobKey: 'vitest-light-1',
      steps: { vitest: { status: 'failed', failedFiles: ['apps/web/test/a.test.ts'] } },
    };
    writeFileSync(join(prevDir, 'state.json'), JSON.stringify(valid));
    assert.deepEqual(readPrevState(base), valid);

    assert.equal(readPrevState({ ...base, attempt: 1 }), null);
    assert.equal(readPrevState({ ...base, attempt: 3 }), null);
    assert.equal(readPrevState({ ...base, sha: 'other-sha' }), null);
    assert.equal(readPrevState({ ...base, runId: '999' }), null);
    assert.equal(readPrevState({ ...base, jobKey: 'vitest-light-2' }), null);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('prepareVitestRun and finalizeVitestRun pass --last failed files only on attempt > 1 failure', () => {
  const dir = makeTestTempDir('ci-failed-only-vitest-');
  try {
    const repo = join(dir, 'repo');
    const prevDir = join(dir, 'prev');
    const currDir = join(dir, 'curr');
    mkdirSync(join(repo, 'apps/web/test'), { recursive: true });
    mkdirSync(prevDir, { recursive: true });
    mkdirSync(currDir, { recursive: true });
    const failFile = 'apps/web/test/red.test.ts';
    const passFile = 'apps/web/test/green.test.ts';
    writeFileSync(join(repo, failFile), 'export {};\n');
    writeFileSync(join(repo, passFile), 'export {};\n');

    const att1Env = {
      CI_FAILED_ONLY_PREV_DIR: prevDir,
      CI_FAILED_ONLY_CURR_DIR: currDir,
      CI_FAILED_ONLY_JOB_KEY: 'vitest-light-1',
      GITHUB_SHA: 'sha1',
      GITHUB_RUN_ID: '100',
      GITHUB_RUN_ATTEMPT: '1',
    };
    const prep1 = prepareVitestRun({
      command: 'pnpm',
      args: ['test', '--shard=1/6'],
      env: att1Env,
      cwd: repo,
    });
    assert.equal(prep1.skip, false);
    assert.equal(prep1.rerunOnly, null);
    assert.ok(prep1.args.includes('--shard=1/6'));
    assert.ok(prep1.args.includes('--reporter=json'));

    writeFileSync(
      prep1.reportPath,
      JSON.stringify({
        testResults: [
          { name: join(repo, failFile), status: 'failed' },
          { name: join(repo, passFile), status: 'passed' },
        ],
      }),
    );
    assert.deepEqual(extractVitestFailedFiles(prep1.reportPath, repo), [failFile]);
    finalizeVitestRun({ prep: prep1, code: 1, cwd: repo });

    const prev2 = join(dir, 'prev2');
    const curr2 = join(dir, 'curr2');
    mkdirSync(prev2, { recursive: true });
    mkdirSync(curr2, { recursive: true });
    writeFileSync(join(prev2, 'state.json'), readFileSync(join(currDir, 'state.json'), 'utf8'));
    const att2Env = {
      ...att1Env,
      CI_FAILED_ONLY_PREV_DIR: prev2,
      CI_FAILED_ONLY_CURR_DIR: curr2,
      GITHUB_RUN_ATTEMPT: '2',
    };
    const prep2 = prepareVitestRun({
      command: 'pnpm',
      args: ['test', '--shard=1/6'],
      env: att2Env,
      cwd: repo,
    });
    assert.equal(prep2.skip, false);
    assert.deepEqual(prep2.rerunOnly, [failFile]);
    assert.deepEqual(prep2.args.slice(0, 3), ['exec', 'vitest', 'run']);
    assert.equal(
      prep2.args.some((a) => a.startsWith('--shard')),
      false,
    );
    assert.ok(prep2.args.includes(failFile));
    assert.ok(!prep2.args.includes(passFile));

    recordStepState({
      currDir: prev2,
      sha: 'sha1',
      runId: '100',
      attempt: 1,
      jobKey: 'vitest-light-1',
      stepKey: 'vitest',
      outcome: { status: 'passed', failedFiles: [] },
    });
    const prepSkip = prepareVitestRun({
      command: 'pnpm',
      args: ['test', '--shard=1/6'],
      env: att2Env,
      cwd: repo,
    });
    assert.equal(prepSkip.skip, true);
    assert.deepEqual(stripShardArgs(['test', '--shard', '1/6', '--foo']), ['test', '--foo']);
  } finally {
    releaseTestTempDir(dir);
  }
});

test('node-test CLI runs all files on attempt 1 and only failed file on attempt 2', () => {
  const dir = makeTestTempDir('ci-failed-only-nodetest-');
  try {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, 'scripts/ops'), { recursive: true });
    writeFileSync(
      join(repo, 'a.test.mjs'),
      "import test from 'node:test'; test('ok', () => {});\n",
    );
    writeFileSync(
      join(repo, 'b.test.mjs'),
      "import test from 'node:test'; import assert from 'node:assert/strict'; test('flaky', () => { assert.equal(process.env.GITHUB_RUN_ATTEMPT, '2'); });\n",
    );
    const cli = join(process.cwd(), 'scripts/ops/ci-failed-only.mjs');
    const { NODE_TEST_CONTEXT: _ignored, ...cleanEnv } = process.env;
    const prev1 = join(dir, 'prev1');
    const curr1 = join(dir, 'curr1');
    mkdirSync(prev1, { recursive: true });
    mkdirSync(curr1, { recursive: true });
    const res1 = spawnSync(
      process.execPath,
      [
        cli,
        'node-test',
        '--key',
        'gates-sample',
        '--',
        'node',
        '--test',
        'a.test.mjs',
        'b.test.mjs',
      ],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...cleanEnv,
          CI_FAILED_ONLY_PREV_DIR: prev1,
          CI_FAILED_ONLY_CURR_DIR: curr1,
          CI_FAILED_ONLY_JOB_KEY: 'gates',
          GITHUB_SHA: 'deadbeef',
          GITHUB_RUN_ID: '777',
          GITHUB_RUN_ATTEMPT: '1',
        },
      },
    );
    assert.equal(res1.status, 1, res1.stdout + res1.stderr);
    const state1 = JSON.parse(readFileSync(join(curr1, 'state.json'), 'utf8'));
    assert.equal(state1.steps['gates-sample'].status, 'failed');
    assert.deepEqual(state1.steps['gates-sample'].failedFiles, ['b.test.mjs']);

    const curr2 = join(dir, 'curr2');
    mkdirSync(curr2, { recursive: true });
    const res2 = spawnSync(
      process.execPath,
      [
        cli,
        'node-test',
        '--key',
        'gates-sample',
        '--',
        'node',
        '--test',
        'a.test.mjs',
        'b.test.mjs',
      ],
      {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...cleanEnv,
          CI_FAILED_ONLY_PREV_DIR: curr1,
          CI_FAILED_ONLY_CURR_DIR: curr2,
          CI_FAILED_ONLY_JOB_KEY: 'gates',
          GITHUB_SHA: 'deadbeef',
          GITHUB_RUN_ID: '777',
          GITHUB_RUN_ATTEMPT: '2',
        },
      },
    );
    assert.equal(res2.status, 0, res2.stdout + res2.stderr);
    assert.match(
      res2.stdout,
      /rerunning 1\/2 failed node:test file\(s\) for gates-sample: b\.test\.mjs/,
    );
    assert.doesNotMatch(res2.stdout, /\ba\.test\.mjs\b/);
    const state2 = JSON.parse(readFileSync(join(curr2, 'state.json'), 'utf8'));
    assert.equal(state2.steps['gates-sample'].status, 'passed');

    assert.deepEqual(
      selectNodeTestFiles({
        stepKey: 'gates-sample',
        declaredFiles: ['a.test.mjs', 'b.test.mjs'],
        ctx: {
          prevDir: curr2,
          currDir: dir,
          sha: 'deadbeef',
          runId: '777',
          attempt: 3,
          jobKey: 'gates',
        },
        cwd: repo,
      }),
      { skip: true, files: [], rerunOnly: null },
    );
  } finally {
    releaseTestTempDir(dir);
  }
});

test('extractGoTestFailures isolates failed packages and top-level tests while falling back on package build failure', () => {
  const testFail = [
    JSON.stringify({ Action: 'run', Package: 'example.com/a', Test: 'TestOne' }),
    JSON.stringify({ Action: 'fail', Package: 'example.com/a', Test: 'TestOne/sub' }),
    JSON.stringify({ Action: 'fail', Package: 'example.com/a', Test: 'TestOne' }),
    JSON.stringify({ Action: 'pass', Package: 'example.com/b', Test: 'TestTwo' }),
  ].join('\n');
  assert.deepEqual(extractGoTestFailures(testFail), {
    packages: ['example.com/a'],
    tests: ['TestOne'],
  });

  const buildFail = [
    JSON.stringify({ Action: 'fail', Package: 'example.com/a' }),
    'FAIL\texample.com/a [build failed]',
  ].join('\n');
  assert.deepEqual(extractGoTestFailures(buildFail), {
    packages: ['example.com/a'],
    tests: [],
  });
});

test('extractNodeTestFailedFiles normalizes relative and absolute paths cleanly', () => {
  const dir = makeTestTempDir('ci-failed-only-log-');
  try {
    const log = join(dir, 'fail.jsonl');
    writeFileSync(
      log,
      [
        JSON.stringify({ file: join(dir, 'scripts/a.test.mjs') }),
        JSON.stringify({ file: 'scripts/b.test.mjs' }),
        JSON.stringify({ file: 'scripts/outside.test.mjs' }),
        'not-json',
      ].join('\n'),
    );
    assert.deepEqual(
      extractNodeTestFailedFiles(log, ['scripts/a.test.mjs', 'scripts/b.test.mjs'], dir),
      ['scripts/a.test.mjs', 'scripts/b.test.mjs'],
    );
  } finally {
    releaseTestTempDir(dir);
  }
});

test('prepush runPlan skips checks passed in attempt 1 and readPlaywrightLastFailed requires failed status with IDs', () => {
  const dir = makeTestTempDir('ci-failed-only-prepush-');
  try {
    const prev1 = join(dir, 'prev1');
    const curr1 = join(dir, 'curr1');
    const curr2 = join(dir, 'curr2');
    mkdirSync(prev1, { recursive: true });
    mkdirSync(curr1, { recursive: true });
    mkdirSync(curr2, { recursive: true });

    const plan = [
      [process.execPath, '-e', 'process.exit(0)'],
      [process.execPath, '-e', 'process.exit(Number(process.env.ATTEMPT_EXIT || 1))'],
      [process.execPath, '-e', 'process.exit(0)'],
    ];

    let exit1 = null;
    runPlan(plan, {
      cwd: dir,
      env: {
        ...process.env,
        CI_FAILED_ONLY_PREV_DIR: prev1,
        CI_FAILED_ONLY_CURR_DIR: curr1,
        CI_FAILED_ONLY_JOB_KEY: 'check-core',
        GITHUB_SHA: 'sha1',
        GITHUB_RUN_ID: '55',
        GITHUB_RUN_ATTEMPT: '1',
        ATTEMPT_EXIT: '1',
      },
      exit: (code) => {
        exit1 = code;
      },
    });
    assert.equal(exit1, 1);

    const failMarker = join(dir, 'step0-ran');
    const planAttempt2 = [
      [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(failMarker)}, 'x')`,
      ],
      plan[1],
      plan[2],
    ];
    recordStepState({
      currDir: curr1,
      sha: 'sha1',
      runId: '55',
      attempt: 1,
      jobKey: 'check-core',
      stepKey: 'prepush-ci',
      outcome: { status: 'failed', passedChecks: [planAttempt2[0].join(' ')] },
    });

    let exit2 = 0;
    runPlan(planAttempt2, {
      cwd: dir,
      env: {
        ...process.env,
        CI_FAILED_ONLY_PREV_DIR: curr1,
        CI_FAILED_ONLY_CURR_DIR: curr2,
        CI_FAILED_ONLY_JOB_KEY: 'check-core',
        GITHUB_SHA: 'sha1',
        GITHUB_RUN_ID: '55',
        GITHUB_RUN_ATTEMPT: '2',
        ATTEMPT_EXIT: '0',
      },
      exit: (code) => {
        exit2 = code;
      },
    });
    assert.equal(exit2, 0);
    assert.equal(existsSync(failMarker), false, 'step 0 skipped on attempt 2');

    const pwFile = join(dir, 'pw.json');
    writeFileSync(pwFile, JSON.stringify({ status: 'passed', failedTests: ['t1'] }));
    assert.equal(readPlaywrightLastFailed(pwFile), null);
    writeFileSync(pwFile, JSON.stringify({ status: 'failed', failedTests: [] }));
    assert.equal(readPlaywrightLastFailed(pwFile), null);
    writeFileSync(pwFile, JSON.stringify({ status: 'failed', failedTests: ['spec.ts:1:1'] }));
    assert.deepEqual(readPlaywrightLastFailed(pwFile), ['spec.ts:1:1']);

    const leakProbe = join(dir, 'leaked.txt');
    let exitLeak = 0;
    runPlan(
      [
        [
          process.execPath,
          '-e',
          `if (process.env.CI_FAILED_ONLY_CURR_DIR) require('node:fs').writeFileSync(${JSON.stringify(leakProbe)}, 'leaked')`,
        ],
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          CI_FAILED_ONLY_CURR_DIR: curr2,
          CI_FAILED_ONLY_PREV_DIR: curr1,
          CI_FAILED_ONLY_JOB_KEY: 'check-core',
          GITHUB_SHA: 'sha1',
          GITHUB_RUN_ID: '55',
          GITHUB_RUN_ATTEMPT: '1',
        },
        exit: (code) => {
          exitLeak = code;
        },
      },
    );
    assert.equal(exitLeak, 0);
    assert.equal(existsSync(leakProbe), false);
  } finally {
    releaseTestTempDir(dir);
  }
});
