#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { MAX_CONCURRENT_PREFLIGHT_RUNS } from './ci-capacity-gate.mjs';
import { laneName, stampUnownedCommits } from './push-queue.mjs';
import { ENQUEUE_PREFIX, TRY_PREFIX } from './speculative-queue.mjs';

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRun(runs, sha, ref) {
  return (
    runs.find((run) => run.name === 'ci' && run.head_sha === sha && run.head_branch === ref) ?? null
  );
}

export function fastGateInvocation({ env = process.env } = {}) {
  const runner = env.CAIRN_PREFLIGHT_GATE_WRAPPER?.trim()
    ? 'CAIRN_PREFLIGHT_GATE_WRAPPER'
    : 'local exact tree';
  return { command: process.execPath, args: ['scripts/ops/preflight-fast-gate.mjs'], runner };
}

export function runFastGateBeforePush({
  root,
  spawn = spawnSync,
  invocation = fastGateInvocation(),
}) {
  return spawn(invocation.command, invocation.args, { cwd: root, stdio: 'inherit' });
}

export { MAX_CONCURRENT_PREFLIGHT_RUNS };

const ACTIVE_PREFLIGHT_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested']);

export function isActivePreflightRun(run) {
  return (
    ACTIVE_PREFLIGHT_STATUSES.has(run?.status) &&
    typeof run?.head_branch === 'string' &&
    run.head_branch.startsWith('preflight/')
  );
}

export function isSupersededRun(run, { ref, sha, keepShas }) {
  return run.head_branch === ref && run.head_sha !== sha && !keepShas.has(run.head_sha);
}

export function cancelSupersededRuns({
  repo,
  ref,
  sha,
  keepShas = new Set(),
  gh,
  cancel,
  log = console.log,
}) {
  let runs = [];
  try {
    runs =
      gh([
        'api',
        `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(ref)}&per_page=30`,
      ])?.workflow_runs ?? [];
  } catch (error) {
    log(`[preflight] could not list superseded runs (${error.message}); leaving them running`);
  }
  const superseded = runs.filter(
    (run) =>
      run.name === 'ci' &&
      isSupersededRun(run, { ref, sha, keepShas }) &&
      isActivePreflightRun(run),
  );
  return superseded
    .map((run) => run.id)
    .filter((id) => {
      const accepted = cancel(id);
      if (accepted) log(`[preflight] cancelled superseded ci run ${id} on ${ref}`);
      return accepted;
    });
}

export function preflightCapacityDecision({
  activeCount,
  maxRuns = MAX_CONCURRENT_PREFLIGHT_RUNS,
  bypass = false,
}) {
  if (bypass || activeCount < maxRuns) return { action: 'push' };
  return { action: 'wait', activeCount, maxRuns };
}

export function collectActivePreflightRuns({
  repo,
  gh,
  statuses = ['queued', 'in_progress', 'waiting', 'requested'],
}) {
  const runs = [];
  try {
    for (const status of statuses) {
      const page = gh([
        'api',
        `repos/${repo}/actions/workflows/ci.yml/runs?status=${status}&per_page=100`,
      ]);
      runs.push(...(page?.workflow_runs ?? []));
    }
  } catch (error) {
    return { ok: false, error };
  }
  const unique = new Map();
  for (const run of runs.filter(isActivePreflightRun))
    unique.set(run.id ?? `${run.head_branch}:${run.head_sha}`, run);
  return { ok: true, runs: [...unique.values()] };
}

export function waitForPreflightCapacity({
  repo,
  gh,
  sleep,
  log = console.log,
  bypass = false,
  replaced = () => false,
  pollSeconds = 20,
  waitMinutes = 60,
  now = () => Date.now(),
}) {
  const deadline = now() + waitMinutes * 60_000;
  for (;;) {
    const active = collectActivePreflightRuns({ repo, gh });
    if (!active.ok) {
      log(
        `[preflight] could not count active preflight runs (${active.error.message}); proceeding after the mandatory fast gate`,
      );
      return { ok: true, degraded: true };
    }
    const activeCount = active.runs.filter((run) => !replaced(run)).length;
    const decision = preflightCapacityDecision({ activeCount, bypass });
    if (decision.action === 'push') return { ok: true, activeCount };
    if (now() > deadline) {
      return {
        ok: false,
        error: `${activeCount} preflight ci runs are still active after ${waitMinutes} minutes; rerun later or set CAIRN_PREFLIGHT_CONCURRENCY_BYPASS=1`,
      };
    }
    log(
      `[preflight] ${activeCount}/${MAX_CONCURRENT_PREFLIGHT_RUNS} preflight ci runs active; waiting ${pollSeconds}s before pushing`,
    );
    sleep(pollSeconds);
  }
}

export function watchVerdict(status, conclusion, watchStatus) {
  if (status === 'completed')
    return { verdict: conclusion === 'success' ? 'green' : 'red', conclusion };
  return watchStatus === 0 ? { verdict: 'unreadable' } : { verdict: 'unreadable', watchStatus };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const wait = process.argv.includes('--wait');
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const lane = laneName(hostname(), basename(git(['rev-parse', '--show-toplevel'])));
  const ref = `preflight/${lane}`;
  const stamped = stampUnownedCommits({ lane, prefix: '[preflight]' });
  if (!stamped.ok) {
    console.error(
      '[preflight] could not stamp the owner trailer (a dirty tree or a conflict); fix that and run it again. Nothing was pushed.',
    );
    process.exit(1);
  }
  const sha = stamped.sha;
  const root = git(['rev-parse', '--show-toplevel']);
  const invocation = fastGateInvocation();
  console.log(
    `[preflight] running the fast gate through ${invocation.runner}; nothing is pushed unless it passes`,
  );
  const gate = runFastGateBeforePush({ root, invocation });
  if (gate.status !== 0) {
    console.error('[preflight] fast gate failed on the exact HEAD tree; nothing was pushed.');
    process.exit(gate.status ?? 1);
  }
  const ghJson = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  const sleep = (seconds) => spawnSync('sleep', [String(seconds)]);
  const readQueuedShas = () =>
    new Set(
      git(['ls-remote', 'origin', `${ENQUEUE_PREFIX}*`, `${TRY_PREFIX}*`])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[0]),
    );
  let keepShas = null;
  try {
    keepShas = readQueuedShas();
  } catch (error) {
    console.log(`[preflight] could not list queued shas (${error.message}); cancelling nothing`);
  }
  const capacity = waitForPreflightCapacity({
    repo,
    gh: ghJson,
    sleep,
    bypass: process.env.CAIRN_PREFLIGHT_CONCURRENCY_BYPASS === '1',
    replaced: (run) => keepShas !== null && isSupersededRun(run, { ref, sha, keepShas }),
  });
  if (!capacity.ok) {
    console.error(`[preflight] ${capacity.error}`);
    process.exit(1);
  }
  const push = spawnSync(
    'git',
    ['push', `--force-with-lease=${preflightRef(lane)}`, 'origin', `HEAD:${preflightRef(lane)}`],
    { stdio: 'inherit' },
  );
  if (push.status !== 0) process.exit(push.status ?? 1);
  console.log(`[preflight] pushed ${sha.slice(0, 9)} to ${preflightRef(lane)}`);
  if (keepShas !== null) {
    cancelSupersededRuns({
      repo,
      ref,
      sha,
      keepShas,
      gh: ghJson,
      cancel: (id) =>
        spawnSync('gh', ['api', '--method', 'POST', `repos/${repo}/actions/runs/${id}/cancel`], {
          stdio: 'ignore',
        }).status === 0,
    });
  }
  const readRun = () => {
    const { workflow_runs: runs } = ghJson([
      'api',
      `repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`,
    ]);
    return preflightRun(runs, sha, ref);
  };
  let run = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      run = readRun();
    } catch {
      run = null;
    }
    if (run) break;
    sleep(5);
  }
  if (!run) {
    console.error(
      '[preflight] could not read the run: the ci run did not appear; check that the ci workflow is enabled',
    );
    process.exit(1);
  }
  console.log(`[preflight] ci run: ${run.html_url}`);
  if (!wait) {
    console.log(
      '[preflight] rerun with --wait to block until it finishes, then node scripts/ops/push-queue.mjs',
    );
    process.exit(0);
  }
  const currentStatus = () => {
    try {
      const latest = readRun();
      return { status: latest?.status ?? null, conclusion: latest?.conclusion ?? null };
    } catch {
      return null;
    }
  };
  const watched = spawnSync(
    'gh',
    ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'],
    {
      stdio: 'inherit',
    },
  );
  let state = currentStatus();
  const WATCH_RETRIES = 5;
  for (let attempt = 0; attempt < WATCH_RETRIES; attempt++) {
    const outcome = watchVerdict(state?.status ?? null, state?.conclusion ?? null, watched.status);
    if (outcome.verdict !== 'unreadable') {
      if (outcome.verdict === 'green') {
        console.log('[preflight] green — push-queue will accept this head');
        process.exit(0);
      }
      console.error(
        `[preflight] the run went ${outcome.conclusion}: ${run.html_url}; fix the failing jobs and push again`,
      );
      process.exit(1);
    }
    console.error(
      `[preflight] could not read the run (watch exited ${watched.status ?? 'signal'}, state query failed); retrying ${WATCH_RETRIES - attempt} more time(s)`,
    );
    sleep(5);
    state = currentStatus();
    if (state && state.status !== 'completed') {
      const again = spawnSync(
        'gh',
        ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'],
        {
          stdio: 'inherit',
        },
      );
      if (again.status === 0) {
        console.log('[preflight] green — push-queue will accept this head');
        process.exit(0);
      }
      state = currentStatus();
      if (state && state.status === 'completed') continue;
    }
  }
  console.error(
    `[preflight] could not read the run at ${run.html_url}; rerun node scripts/ops/preflight.mjs --wait`,
  );
  process.exit(1);
}
