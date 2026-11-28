import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { evaluate } from '../doc-retired-terms-gate.mjs';
import { OWNED_PROCESS_CLI, processInfo } from '../owned-process.mjs';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  acquireLock,
  ownsLock,
  releaseLock,
  renderSummaryHtml,
  runDailyEval,
  summarizeRun,
  updateHistory,
} from './eval-daily.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const INSTALLER = join(ROOT, 'scripts', 'ops', 'install-eval-daily.sh');

function makeTempDir(t, prefix = 'eval-daily-test-') {
  const dir = makeTestTempDir(prefix);
  t.after(() => releaseTestTempDir(dir));
  return dir;
}

function createFakeRepo(root, { runScript, devinEnvScript, clean = true } = {}) {
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'eval', 'harness'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  symlinkSync(join(ROOT, 'node_modules'), join(repo, 'node_modules'));
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(
    join(repo, 'eval', 'harness', 'devin-env.mjs'),
    devinEnvScript ??
      `if (process.argv.includes('--check-auth')) { console.log(JSON.stringify({ ok: true })); process.exit(0); }\n`,
  );
  writeFileSync(
    join(repo, 'eval', 'run.ts'),
    runScript ??
      `import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(out, JSON.stringify({
  arm: 'daily',
  langfuse: { baseUrl: process.env.LANGFUSE_BASE_URL, projectId: 'proj-1', experimentId: 'exp-1', experimentUrl: process.env.LANGFUSE_BASE_URL + '/project/proj-1/experiments/exp-1' },
  items: [
    { caseId: 'fix-bug', kind: 'lane', repeat: 0, scores: { 'lane.completed': 1 }, comments: {}, gate: true, durationMs: 500, traceId: 'tr-1', traceUrl: process.env.LANGFUSE_BASE_URL + '/project/proj-1/traces/tr-1' },
    { caseId: 'canary-answer', kind: 'canary', repeat: 0, scores: { 'canary.completed': 1 }, comments: {}, gate: true, durationMs: 100, traceId: 'tr-2', traceUrl: process.env.LANGFUSE_BASE_URL + '/project/proj-1/traces/tr-2' },
  ],
}));
`,
  );
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'eval@cairn.dev'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'eval'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
  if (!clean) writeFileSync(join(repo, 'untracked.txt'), 'dirty\n');
  return repo;
}

async function startLangfuseMock(t, status = 200) {
  const srv = createServer((req, res) => {
    if (req.url === '/api/public/health') {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: status === 200 ? 'OK' : 'ERR' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const addr = srv.address();
  return `http://127.0.0.1:${addr.port}`;
}

test('refuses CI env and unwritable state dir with exit 2 without writing files', async (t) => {
  const dir = makeTempDir(t);
  const state = join(dir, 'state');
  const codeCi = await runDailyEval({
    env: { CI: 'true', EVAL_DAILY_STATE: state },
  });
  assert.equal(codeCi, 2);
  assert.equal(existsSync(state), false);

  const blocker = join(dir, 'file-as-state');
  writeFileSync(blocker, 'not-a-dir');
  const codeUnwritable = await runDailyEval({
    env: { EVAL_DAILY_STATE: blocker },
  });
  assert.equal(codeUnwritable, 2);
});

test('decision table covers every status, missing config, Langfuse health, auth preflight, exit 3, and dirty repo', async (t) => {
  const dir = makeTempDir(t);
  const devinHome = join(dir, 'devin-home');
  mkdirSync(devinHome, { recursive: true });
  const healthyLf = await startLangfuseMock(t, 200);
  const unhealthyLf = await startLangfuseMock(t, 503);

  const stateMissingRepo = join(dir, 's-missing-repo');
  assert.equal(
    await runDailyEval({
      env: {
        EVAL_DAILY_STATE: stateMissingRepo,
        EVAL_DAILY_REPO: join(dir, 'nope'),
        EVAL_DAILY_DEVIN_HOME: devinHome,
      },
    }),
    1,
  );
  assert.equal(
    JSON.parse(readFileSync(join(stateMissingRepo, 'latest.json'), 'utf8')).status,
    'failed',
  );

  const dirtyRepo = createFakeRepo(join(dir, 'dirty'), { clean: false });
  const stateDirty = join(dir, 's-dirty');
  assert.equal(
    await runDailyEval({
      env: {
        EVAL_DAILY_STATE: stateDirty,
        EVAL_DAILY_REPO: dirtyRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      },
    }),
    1,
  );
  assert.equal(JSON.parse(readFileSync(join(stateDirty, 'latest.json'), 'utf8')).status, 'failed');

  const cleanRepo = createFakeRepo(join(dir, 'clean'));
  const stateFetchFail = join(dir, 's-fetch-fail');
  assert.equal(
    await runDailyEval({
      env: {
        EVAL_DAILY_STATE: stateFetchFail,
        EVAL_DAILY_REPO: cleanRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      },
    }),
    1,
  );
  assert.match(
    JSON.parse(readFileSync(join(stateFetchFail, 'latest.json'), 'utf8')).reason,
    /git fetch failed/,
  );

  const stateMissingEnv = join(dir, 's-missing-lf');
  assert.equal(
    await runDailyEval({
      argv: ['--no-fetch'],
      env: {
        EVAL_DAILY_STATE: stateMissingEnv,
        EVAL_DAILY_REPO: cleanRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
        EVAL_DAILY_SKIP_INSTALL: '1',
        EVAL_DAILY_LANGFUSE_ENV: join(dir, 'absent.env'),
      },
    }),
    1,
  );
  assert.equal(
    JSON.parse(readFileSync(join(stateMissingEnv, 'latest.json'), 'utf8')).status,
    'incomplete',
  );

  const stateUnhealthyLf = join(dir, 's-unhealthy-lf');
  assert.equal(
    await runDailyEval({
      argv: ['--no-fetch'],
      env: {
        EVAL_DAILY_STATE: stateUnhealthyLf,
        EVAL_DAILY_REPO: cleanRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
        EVAL_DAILY_SKIP_INSTALL: '1',
        LANGFUSE_BASE_URL: unhealthyLf,
        LANGFUSE_PUBLIC_KEY: 'pk-1',
        LANGFUSE_SECRET_KEY: 'sk-1',
      },
    }),
    1,
  );
  assert.equal(
    JSON.parse(readFileSync(join(stateUnhealthyLf, 'latest.json'), 'utf8')).status,
    'incomplete',
  );

  const authFailRepo = createFakeRepo(join(dir, 'auth-fail'), {
    devinEnvScript: `console.log(JSON.stringify({ ok: false, detail: 'Not logged in' })); process.exit(1);`,
  });
  const stateAuthFail = join(dir, 's-auth-fail');
  assert.equal(
    await runDailyEval({
      argv: ['--no-fetch'],
      env: {
        EVAL_DAILY_STATE: stateAuthFail,
        EVAL_DAILY_REPO: authFailRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
        EVAL_DAILY_SKIP_INSTALL: '1',
        LANGFUSE_BASE_URL: healthyLf,
        LANGFUSE_PUBLIC_KEY: 'pk-1',
        LANGFUSE_SECRET_KEY: 'sk-1',
      },
    }),
    1,
  );
  const authLatest = JSON.parse(readFileSync(join(stateAuthFail, 'latest.json'), 'utf8'));
  assert.equal(authLatest.status, 'incomplete');
  assert.match(authLatest.reason, /devin auth preflight/);

  const installFailRepo = createFakeRepo(join(dir, 'install-fail'));
  rmSync(join(installFailRepo, 'node_modules'), { recursive: true, force: true });
  const badBin = join(dir, 'bad-pnpm');
  mkdirSync(badBin, { recursive: true });
  writeFileSync(join(badBin, 'pnpm'), '#!/bin/sh\necho "install broke" >&2\nexit 1\n');
  chmodSync(join(badBin, 'pnpm'), 0o755);
  const stateInstallFail = join(dir, 's-install-fail');
  assert.equal(
    await runDailyEval({
      argv: ['--no-fetch'],
      env: {
        PATH: `${badBin}:${process.env.PATH ?? ''}`,
        EVAL_DAILY_STATE: stateInstallFail,
        EVAL_DAILY_REPO: installFailRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
        LANGFUSE_BASE_URL: healthyLf,
        LANGFUSE_PUBLIC_KEY: 'pk-1',
        LANGFUSE_SECRET_KEY: 'sk-1',
      },
    }),
    1,
  );
  assert.equal(
    JSON.parse(readFileSync(join(stateInstallFail, 'latest.json'), 'utf8')).status,
    'failed',
  );
  assert.equal(existsSync(join(stateInstallFail, 'lockfile.sha256')), false);

  const syncedPreflightRepo = createFakeRepo(join(dir, 'synced-preflight'), {
    devinEnvScript: `
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const marker = readFileSync(join(process.cwd(), 'synced.txt'), 'utf8').trim();
      console.log(JSON.stringify({ ok: marker === 'v2', detail: 'marker=' + marker }));
      process.exit(marker === 'v2' ? 0 : 1);
    `,
  });
  const originBare = join(dir, 'origin.git');
  execFileSync('git', ['clone', '--bare', syncedPreflightRepo, originBare]);
  execFileSync('git', ['remote', 'add', 'origin', originBare], { cwd: syncedPreflightRepo });
  const workClone = join(dir, 'work-push');
  execFileSync('git', ['clone', originBare, workClone]);
  execFileSync('git', ['config', 'user.email', 'eval@cairn.dev'], { cwd: workClone });
  execFileSync('git', ['config', 'user.name', 'eval'], { cwd: workClone });
  writeFileSync(join(workClone, 'synced.txt'), 'v2\n');
  execFileSync('git', ['add', 'synced.txt'], { cwd: workClone });
  execFileSync('git', ['commit', '-qm', 'add synced marker'], { cwd: workClone });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: workClone });
  const stateSynced = join(dir, 's-synced');
  assert.equal(
    await runDailyEval({
      env: {
        EVAL_DAILY_STATE: stateSynced,
        EVAL_DAILY_REPO: syncedPreflightRepo,
        EVAL_DAILY_DEVIN_HOME: devinHome,
        EVAL_DAILY_SKIP_INSTALL: '1',
        LANGFUSE_BASE_URL: healthyLf,
        LANGFUSE_PUBLIC_KEY: 'pk-1',
        LANGFUSE_SECRET_KEY: 'sk-1',
      },
    }),
    0,
  );
  assert.equal(JSON.parse(readFileSync(join(stateSynced, 'latest.json'), 'utf8')).status, 'ok');

  assert.equal(
    summarizeRun({
      runId: 'r-lf3',
      arm: 'a',
      startedAt: '2026-11-27T00:00:00Z',
      evalExitCode: 3,
      outJson: null,
    }).status,
    'incomplete',
  );
  assert.equal(
    summarizeRun({
      runId: 'r-noout',
      arm: 'a',
      startedAt: '2026-11-27T00:00:00Z',
      evalExitCode: 1,
      outJson: null,
    }).status,
    'failed',
  );
  assert.equal(
    summarizeRun({
      runId: 'r-ok',
      arm: 'a',
      startedAt: '2026-11-27T00:00:00Z',
      evalExitCode: 0,
      outJson: {
        items: [
          { caseId: 'x', kind: 'lane', repeat: 0, scores: { a: 1 }, comments: {}, gate: true },
        ],
      },
    }).status,
    'ok',
  );
  const degraded = summarizeRun({
    runId: 'r-deg',
    arm: 'a',
    startedAt: '2026-11-27T00:00:00Z',
    evalExitCode: 0,
    outJson: {
      items: [
        { caseId: 'x', kind: 'lane', repeat: 0, scores: { a: 1 }, comments: {}, gate: true },
        { caseId: 'y', kind: 'lane', repeat: 0, scores: { a: 0 }, comments: {}, gate: true },
      ],
    },
  });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.exitCode, 0);
  assert.equal(
    summarizeRun({
      runId: 'r-all0',
      arm: 'a',
      startedAt: '2026-11-27T00:00:00Z',
      evalExitCode: 0,
      outJson: {
        items: [
          { caseId: 'y', kind: 'lane', repeat: 0, scores: { a: 0 }, comments: {}, gate: true },
        ],
      },
    }).status,
    'failed',
  );
});

test('skips partial and non-official runs observably, and records publication after private persistence', async (t) => {
  const dir = makeTempDir(t);
  const devinHome = join(dir, 'devin-home');
  mkdirSync(devinHome, { recursive: true });
  const lfUrl = await startLangfuseMock(t, 200);
  const repo = createFakeRepo(join(dir, 'publish-integration'));
  const calls = [];
  let persistedBeforePublish = false;
  const state = join(dir, 'state');
  const code = await runDailyEval({
    argv: ['--no-fetch'],
    env: {
      EVAL_DAILY_STATE: state,
      EVAL_DAILY_REPO: repo,
      EVAL_DAILY_DEVIN_HOME: devinHome,
      EVAL_DAILY_SKIP_INSTALL: '1',
      LANGFUSE_BASE_URL: lfUrl,
      LANGFUSE_PUBLIC_KEY: 'pk-1',
      LANGFUSE_SECRET_KEY: 'sk-1',
    },
    publishImpl: (record) => {
      calls.push(structuredClone(record));
      persistedBeforePublish = existsSync(join(state, 'latest.json'));
      return { state: 'published', branch: 'eval-results', commit: 'c'.repeat(40) };
    },
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(persistedBeforePublish, true);
  assert.equal(calls[0].publicResults, undefined);
  const latest = JSON.parse(readFileSync(join(state, 'latest.json'), 'utf8'));
  assert.equal(latest.status, 'ok');
  assert.deepEqual(latest.publicResults, {
    state: 'published',
    branch: 'eval-results',
    commit: 'c'.repeat(40),
  });
  assert.match(readFileSync(join(state, 'index.html'), 'utf8'), /published/);

  const badRepo = createFakeRepo(join(dir, 'bad-out'), {
    runScript: 'process.exit(1)',
  });
  const badState = join(dir, 'bad-state');
  const badCalls = [];
  const badCode = await runDailyEval({
    argv: ['--no-fetch'],
    env: {
      EVAL_DAILY_STATE: badState,
      EVAL_DAILY_REPO: badRepo,
      EVAL_DAILY_DEVIN_HOME: devinHome,
      EVAL_DAILY_SKIP_INSTALL: '1',
      LANGFUSE_BASE_URL: lfUrl,
      LANGFUSE_PUBLIC_KEY: 'pk-1',
      LANGFUSE_SECRET_KEY: 'sk-1',
    },
    publishImpl: () => {
      badCalls.push('called');
      return { state: 'published', branch: 'eval-results' };
    },
  });
  assert.equal(badCode, 1);
  assert.equal(badCalls.length, 0);
  const badLatest = JSON.parse(readFileSync(join(badState, 'latest.json'), 'utf8'));
  assert.equal(badLatest.publicResults.state, 'skipped');
  assert.match(badLatest.publicResults.reason, /complete official/);
});

test('handles lock concurrency, corrupt/empty locks, wait-for-exit reclaim, EPERM abort, ENOENT unlink, and displaced signal', async (t) => {
  const dir = makeTempDir(t);
  const liveStart = processInfo(process.pid)?.start ?? 'now';

  writeFileSync(join(dir, 'lock'), '');
  const initSkip = await acquireLock(dir, 'r-init', { now: () => Date.now() });
  assert.equal(initSkip.acquired, false);
  assert.equal(initSkip.reason, 'lock_initializing');

  const oldTime = new Date(Date.now() - 10_000);
  utimesSync(join(dir, 'lock'), oldTime, oldTime);
  const corruptReclaimed = await acquireLock(dir, 'r-corrupt');
  assert.equal(corruptReclaimed.acquired, true);
  releaseLock(dir, 'r-corrupt');

  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 999999,
      start: 'dead',
      startedAt: new Date(Date.now() - 10 * 3600 * 1000).toISOString(),
      runId: 'old',
    }),
  );
  writeFileSync(join(dir, 'lock.reclaim'), '');
  utimesSync(join(dir, 'lock.reclaim'), oldTime, oldTime);
  const reclaimRecover = await acquireLock(dir, 'r-reclaim-stale', {
    getInfo: (p) => (p === process.pid ? { pid: p, start: liveStart } : null),
  });
  assert.equal(reclaimRecover.acquired, true);
  releaseLock(dir, 'r-reclaim-stale');

  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 4242,
      start: 'orig',
      startedAt: new Date().toISOString(),
      runId: 'live-owner',
    }),
  );
  const liveSkip = await acquireLock(dir, 'r-live-skip', {
    getInfo: (p) => (p === 4242 ? { pid: 4242, start: 'orig' } : { pid: p, start: liveStart }),
  });
  assert.equal(liveSkip.acquired, false);
  assert.equal(liveSkip.code, 0);

  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 4242,
      start: 'orig',
      startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      runId: 'reused-pid',
    }),
  );
  const reusedReclaim = await acquireLock(dir, 'r-reused', {
    getInfo: (p) =>
      p === 4242 ? { pid: 4242, start: 'different-process-start' } : { pid: p, start: liveStart },
  });
  assert.equal(reusedReclaim.acquired, true);
  releaseLock(dir, 'r-reused');

  let alive4242 = true;
  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 4242,
      start: 'orig',
      startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      runId: 'expired-live',
    }),
  );
  const signals = [];
  const waitReclaim = await acquireLock(dir, 'r-wait-exit', {
    reclaimWaitMs: 300,
    getInfo: (p) =>
      p === 4242 ? (alive4242 ? { pid: 4242, start: 'orig' } : null) : { pid: p, start: liveStart },
    signalFn: (pid, sig) => {
      signals.push([pid, sig]);
      if (sig === 'SIGTERM') {
        alive4242 = false;
        rmSync(join(dir, 'lock'), { force: true });
      }
    },
  });
  assert.equal(waitReclaim.acquired, true);
  assert.deepEqual(signals, [[4242, 'SIGTERM']]);
  assert.equal(ownsLock(dir, 'r-wait-exit'), true);
  releaseLock(dir, 'wrong-run-id');
  assert.equal(existsSync(join(dir, 'lock')), true);
  releaseLock(dir, 'r-wait-exit');
  assert.equal(existsSync(join(dir, 'lock')), false);

  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 5555,
      start: 'immortal',
      startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      runId: 'immortal',
    }),
  );
  const epermAbort = await acquireLock(dir, 'r-eperm', {
    getInfo: (p) => (p === 5555 ? { pid: 5555, start: 'immortal' } : { pid: p, start: liveStart }),
    signalFn: () => {
      const err = new Error('Operation not permitted');
      err.code = 'EPERM';
      throw err;
    },
  });
  assert.equal(epermAbort.acquired, false);
  assert.equal(epermAbort.code, 1);
  assert.equal(epermAbort.reason, 'reclaim_failed_still_alive');
  assert.equal(ownsLock(dir, 'immortal'), true);

  const stateSig = join(dir, 's-sig');
  mkdirSync(stateSig, { recursive: true });
  const devinHome = join(dir, 'devin-home');
  mkdirSync(devinHome, { recursive: true });
  const lfUrl = await startLangfuseMock(t, 200);
  const hangRepo = createFakeRepo(join(dir, 'hang-repo'), {
    runScript: `setTimeout(() => {}, 60_000);`,
  });
  const childEnv = {
    ...process.env,
    EVAL_DAILY_STATE: stateSig,
    EVAL_DAILY_REPO: hangRepo,
    EVAL_DAILY_DEVIN_HOME: devinHome,
    EVAL_DAILY_SKIP_INSTALL: '1',
    LANGFUSE_BASE_URL: lfUrl,
    LANGFUSE_PUBLIC_KEY: 'pk-1',
    LANGFUSE_SECRET_KEY: 'sk-1',
  };
  delete childEnv.CI;
  const child = spawn(
    process.execPath,
    [
      OWNED_PROCESS_CLI,
      '--name',
      'eval-daily-sig-test',
      '--max-runtime-sec',
      '120',
      '--',
      process.execPath,
      join(ROOT, 'scripts', 'ops', 'eval-daily.mjs'),
      '--no-fetch',
    ],
    {
      env: childEnv,
      stdio: 'ignore',
    },
  );
  const lockFile = join(stateSig, 'lock');
  for (let i = 0; i < 100 && !existsSync(lockFile); i += 1)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(existsSync(lockFile), true);
  await new Promise((r) => setTimeout(r, 400));
  child.kill('SIGTERM');
  const exitCode = await new Promise((resolveExit) => child.once('exit', resolveExit));
  assert.notEqual(exitCode, 0);
  const sigLatest = JSON.parse(readFileSync(join(stateSig, 'latest.json'), 'utf8'));
  assert.equal(sigLatest.status, 'incomplete');
  assert.match(sigLatest.reason, /signal/);
  assert.equal(existsSync(lockFile), false);
});

test('tracks two consecutive runs, caps history at 60, recovers corrupt history, and escapes HTML XSS', async (t) => {
  const dir = makeTempDir(t);
  const state = join(dir, 'state');
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'history.json'), '{broken-json');

  for (let i = 0; i < 61; i += 1) {
    const rec = summarizeRun({
      runId: `run-${String(i).padStart(2, '0')}`,
      arm: `daily-${i}`,
      sha: `abc000${i}`,
      startedAt: `2026-11-27T0${Math.floor(i / 10)}:00:00Z`,
      durationMs: 1000 + i,
      evalExitCode: 0,
      outJson: {
        langfuse: { experimentUrl: 'https://lf.local/exp/1' },
        items: [
          {
            caseId: i === 60 ? 'fix-bug<script>alert(1)</script>' : 'fix-bug',
            kind: 'lane',
            repeat: 0,
            scores: { 'lane.completed': i % 2 === 0 ? 1 : 0 },
            comments: i === 60 ? { 'lane.completed': '<img src=x onerror=alert(1)>' } : {},
            gate: true,
            durationMs: 250,
            traceId: `trace-${i}`,
            traceUrl: i === 59 ? undefined : `https://lf.local/project/p1/traces/trace-${i}`,
          },
        ],
      },
    });
    updateHistory(state, rec);
  }

  const history = JSON.parse(readFileSync(join(state, 'history.json'), 'utf8'));
  assert.equal(history.length, 60);
  assert.equal(history[0].runId, 'run-60');
  assert.equal(existsSync(join(state, 'runs', 'run-00.json')), false);
  assert.equal(existsSync(join(state, 'runs', 'run-60.json')), true);

  const html = readFileSync(join(state, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /https:\/\/lf\.local\/project\/p1\/traces\/trace-60/);

  const firstHtml = renderSummaryHtml([
    summarizeRun({
      runId: 'only-1',
      arm: 'daily-1',
      sha: '11112222',
      startedAt: '2026-11-27T00:00:00Z',
      evalExitCode: 0,
      outJson: {
        items: [
          {
            caseId: 'c1',
            kind: 'lane',
            repeat: 0,
            scores: { a: 1 },
            comments: {},
            gate: true,
            traceId: 't-no-proj',
          },
        ],
      },
    }),
  ]);
  assert.match(firstHtml, /first run/);
  assert.match(firstHtml, /trace: t-no-proj/);

  const unsafeHtml = renderSummaryHtml([
    summarizeRun({
      runId: 'xss-url',
      arm: 'daily-xss',
      sha: '99990000',
      startedAt: '2026-11-27T01:00:00Z',
      evalExitCode: 0,
      outJson: {
        langfuse: { experimentUrl: 'javascript:alert(1)' },
        items: [
          {
            caseId: 'c1',
            kind: 'lane',
            repeat: 0,
            scores: { a: 1 },
            comments: {},
            gate: true,
            traceId: 't-js',
            traceUrl: 'javascript:void(0)',
          },
        ],
      },
    }),
    summarizeRun({
      runId: 'data-url',
      arm: 'daily-data',
      sha: '88880000',
      startedAt: '2026-11-26T01:00:00Z',
      evalExitCode: 0,
      outJson: {
        langfuse: { experimentUrl: 'data:text/html,<script>1</script>' },
        items: [],
      },
    }),
  ]);
  assert.doesNotMatch(unsafeHtml, /href="javascript:/i);
  assert.doesNotMatch(unsafeHtml, /href="data:/i);
  assert.match(unsafeHtml, /javascript:alert\(1\)/);
  assert.match(unsafeHtml, /&lt;script&gt;1&lt;\/script&gt;/);
  assert.match(unsafeHtml, /trace: t-js/);
});

test('preserves third-process lock during reclaim, aborts pnpm install cleanly on SIGTERM, and marks external SIGKILL as incomplete', async (t) => {
  const dir = makeTempDir(t);
  const liveStart = processInfo(process.pid)?.start ?? 'now';

  let aliveOwner = true;
  writeFileSync(
    join(dir, 'lock'),
    JSON.stringify({
      pid: 6161,
      start: 'old-owner',
      startedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      runId: 'expired-a',
    }),
  );
  const raceResult = await acquireLock(dir, 'reclaimer-b', {
    reclaimWaitMs: 300,
    getInfo: (p) =>
      p === 6161
        ? aliveOwner
          ? { pid: 6161, start: 'old-owner' }
          : null
        : { pid: p, start: liveStart },
    signalFn: (_pid, sig) => {
      if (sig === 'SIGTERM') {
        aliveOwner = false;
        rmSync(join(dir, 'lock'), { force: true });
        writeFileSync(
          join(dir, 'lock'),
          JSON.stringify({
            pid: process.pid,
            start: liveStart,
            startedAt: new Date().toISOString(),
            runId: 'proc-c',
          }),
          { flag: 'wx', mode: 0o600 },
        );
      }
    },
  });
  assert.equal(raceResult.acquired, false);
  assert.equal(raceResult.reason, 'skipped_locked');
  assert.equal(ownsLock(dir, 'proc-c'), true);
  releaseLock(dir, 'proc-c');

  const lfUrl = await startLangfuseMock(t, 200);
  const devinHome = join(dir, 'devin-home');
  mkdirSync(devinHome, { recursive: true });
  const installRepo = createFakeRepo(join(dir, 'install-sig-repo'));
  rmSync(join(installRepo, 'node_modules'), { recursive: true, force: true });
  const fakePnpmBin = join(dir, 'fake-pnpm-bin');
  mkdirSync(fakePnpmBin, { recursive: true });
  const startedMarker = join(dir, 'pnpm-started');
  writeFileSync(
    join(fakePnpmBin, 'pnpm'),
    `#!/bin/sh\necho started > "${startedMarker}"\ntrap 'exit 143' TERM\nwhile :; do sleep 0.1; done\n`,
  );
  chmodSync(join(fakePnpmBin, 'pnpm'), 0o755);
  const stateInstallSig = join(dir, 'state-install-sig');
  const installEnv = {
    ...process.env,
    PATH: `${fakePnpmBin}:${process.env.PATH ?? ''}`,
    EVAL_DAILY_STATE: stateInstallSig,
    EVAL_DAILY_REPO: installRepo,
    EVAL_DAILY_DEVIN_HOME: devinHome,
    LANGFUSE_BASE_URL: lfUrl,
    LANGFUSE_PUBLIC_KEY: 'pk-1',
    LANGFUSE_SECRET_KEY: 'sk-1',
  };
  delete installEnv.CI;
  const installChild = spawn(
    process.execPath,
    [
      OWNED_PROCESS_CLI,
      '--name',
      'eval-daily-install-sig-test',
      '--max-runtime-sec',
      '120',
      '--',
      process.execPath,
      join(ROOT, 'scripts', 'ops', 'eval-daily.mjs'),
      '--no-fetch',
    ],
    {
      env: installEnv,
      stdio: 'ignore',
    },
  );
  for (
    let i = 0;
    i < 300 && (!existsSync(join(stateInstallSig, 'lock')) || !existsSync(startedMarker));
    i += 1
  ) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(existsSync(startedMarker), true);
  assert.equal(existsSync(join(stateInstallSig, 'lock')), true);
  installChild.kill('SIGTERM');
  const installCode = await new Promise((resolveExit) => installChild.once('exit', resolveExit));
  assert.equal(installCode, 143);
  const installLatest = JSON.parse(readFileSync(join(stateInstallSig, 'latest.json'), 'utf8'));
  assert.equal(installLatest.status, 'incomplete');
  assert.match(installLatest.reason, /interrupted by signal/);
  assert.equal(existsSync(join(stateInstallSig, 'lock')), false);

  const killRepo = createFakeRepo(join(dir, 'kill-repo'), {
    runScript: `process.kill(process.pid, 'SIGKILL');`,
  });
  const stateKill = join(dir, 'state-kill');
  const killExit = await runDailyEval({
    argv: ['--no-fetch'],
    env: {
      EVAL_DAILY_STATE: stateKill,
      EVAL_DAILY_REPO: killRepo,
      EVAL_DAILY_DEVIN_HOME: devinHome,
      EVAL_DAILY_SKIP_INSTALL: '1',
      LANGFUSE_BASE_URL: lfUrl,
      LANGFUSE_PUBLIC_KEY: 'pk-1',
      LANGFUSE_SECRET_KEY: 'sk-1',
    },
  });
  assert.equal(killExit, 1);
  const killLatest = JSON.parse(readFileSync(join(stateKill, 'latest.json'), 'utf8'));
  assert.equal(killLatest.status, 'incomplete');
  assert.match(killLatest.reason, /killed by signal \(SIGKILL\)/);
});

test('install-eval-daily generates valid 0600 plist with env sourcing and PATH fallback', (t) => {
  const dir = makeTempDir(t);
  const fakeHome = join(dir, 'home');
  const state = join(dir, 'state');
  const repo = createFakeRepo(join(dir, 'repo'));
  mkdirSync(join(repo, 'scripts', 'ops'), { recursive: true });
  writeFileSync(join(repo, 'scripts', 'ops', 'eval-daily.mjs'), '// stub\n');
  writeFileSync(join(repo, 'scripts', 'owned-process.mjs'), '// stub\n');
  const envFile = join(dir, 'eval-daily.env');
  writeFileSync(
    envFile,
    `EVAL_DAILY_REPO=${repo}\nEVAL_DAILY_STATE=${state}\nPATH=${process.env.PATH}\n`,
  );
  const res = spawnSync(
    INSTALLER,
    ['--env-file', envFile, '--launchd', '--hour', '5', '--minute', '30', '--no-load'],
    {
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf8',
    },
  );
  assert.equal(res.status, 0, res.stderr);
  const plistPath = join(
    fakeHome,
    'Library',
    'LaunchAgents',
    'com.xiechimon.cairn-eval-daily.plist',
  );
  assert.equal(existsSync(plistPath), true);
  assert.equal(statSync(plistPath).mode & 0o777, 0o600);
  const plist = readFileSync(plistPath, 'utf8');
  assert.match(plist, /<string>com\.xiechimon\.cairn-eval-daily<\/string>/);
  assert.match(plist, /set -a; \. "\$1"; set \+a;/);
  assert.match(plist, /owned-process\.mjs/);
  assert.match(plist, /eval-daily\.mjs/);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>5<\/integer>/);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>30<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<false\/>/);
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<key>StandardOutPath<\/key>/);
  if (process.platform === 'darwin') {
    const lint = spawnSync('plutil', ['-lint', plistPath], { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stderr);
  }
});

test('doc-retired-terms-gate rejects eval-weekly.yml in living docs', () => {
  const registry = JSON.parse(
    readFileSync(join(ROOT, 'scripts', 'doc-retired-terms.json'), 'utf8'),
  );
  const result = evaluate({
    registry,
    headDocs: new Map([
      ['docs/ops/eval-daily.md', 'Do not run .github/workflows/eval-weekly.yml anymore.'],
    ]),
    base: null,
    renames: new Map(),
  });
  assert.ok(result.failures.some((f) => f.includes('eval-weekly-workflow')));
});

test('prunes expired files, broken symlinks, and public temp dirs without touching unrelated dirs', (t) => {
  const dir = makeTempDir(t);
  const state = join(dir, 'state');
  const tmpDir = join(state, 'tmp');
  const publicTmp = join(tmpDir, 'daily-1-public-abc');
  const keepDir = join(tmpDir, 'keep-unrelated');
  const expiredFile = join(tmpDir, 'expired.json');
  const brokenLink = join(tmpDir, 'broken-link');
  mkdirSync(publicTmp, { recursive: true });
  mkdirSync(keepDir, { recursive: true });
  writeFileSync(join(publicTmp, 'marker.txt'), 'temp\n');
  writeFileSync(join(keepDir, 'keep.txt'), 'keep\n');
  writeFileSync(expiredFile, 'old\n');
  symlinkSync(join(dir, 'does-not-exist'), brokenLink);

  const rec = summarizeRun({
    runId: 'run-prune',
    arm: 'daily-prune',
    sha: 'abc0001',
    startedAt: '2026-11-27T00:00:00Z',
    evalExitCode: 0,
    outJson: { items: [] },
  });
  updateHistory(state, rec, { nowMs: Date.now() + 25 * 3600 * 1000 });

  assert.equal(existsSync(publicTmp), false);
  assert.equal(existsSync(expiredFile), false);
  assert.equal(existsSync(keepDir), true);
  assert.throws(() => readFileSync(brokenLink), /ENOENT/);
});

test('records real lane model from isolated Devin sessions.db into latest.json', async (t) => {
  const dir = makeTempDir(t);
  const devinHome = join(dir, 'devin-home');
  const cliDir = join(devinHome, '.local', 'share', 'devin', 'cli');
  mkdirSync(cliDir, { recursive: true });
  const db = new DatabaseSync(join(cliDir, 'sessions.db'));
  db.exec(
    'CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL)',
  );
  const nowSec = Math.floor(Date.now() / 1000) + 1;
  db.prepare(
    'INSERT INTO sessions (id, working_directory, model, created_at) VALUES (?, ?, ?, ?)',
  ).run('s-1', '/tmp/eval-lane-fix-bug-xyz999', 'swe-2-high', nowSec);
  db.close();

  const lfUrl = await startLangfuseMock(t, 200);
  const repo = createFakeRepo(join(dir, 'model-repo'));
  const state = join(dir, 'model-state');
  const code = await runDailyEval({
    argv: ['--no-fetch'],
    env: {
      EVAL_DAILY_STATE: state,
      EVAL_DAILY_REPO: repo,
      EVAL_DAILY_DEVIN_HOME: devinHome,
      EVAL_DAILY_SKIP_INSTALL: '1',
      LANGFUSE_BASE_URL: lfUrl,
      LANGFUSE_PUBLIC_KEY: 'pk-1',
      LANGFUSE_SECRET_KEY: 'sk-1',
    },
    publishImpl: () => ({ state: 'skipped', branch: 'eval-results', reason: 'test' }),
  });
  assert.equal(code, 0);
  const latest = JSON.parse(readFileSync(join(state, 'latest.json'), 'utf8'));
  assert.equal(latest.items.find((item) => item.caseId === 'fix-bug')?.ranModel, 'swe-2-high');
});
