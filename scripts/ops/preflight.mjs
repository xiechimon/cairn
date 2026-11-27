#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { acquireSlot } from '../heavy-slots.mjs';
import { MAX_CONCURRENT_PREFLIGHT_RUNS } from './ci-capacity-gate.mjs';
import { localLane, parsePreflightArgs, stampUnownedCommits } from './push-queue.mjs';
import { ENQUEUE_PREFIX, TRY_PREFIX } from './speculative-queue.mjs';

export { parsePreflightArgs };

const REASON_TRAILER = 'Preflight-Reason';

export function extractCommitReason(message) {
  const match = /^Preflight-Reason:\s*(.+)$/im.exec(message ?? '');
  return match ? match[1].trim() : null;
}

export function upsertPreflightReason(message, reason) {
  const lines = String(message ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^Preflight-Reason:\s/i.test(line));
  while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop();
  const lastBlank = lines.lastIndexOf('');
  const tailLines = lastBlank === -1 ? [] : lines.slice(lastBlank + 1);
  const endsWithTrailers =
    tailLines.length > 0 &&
    tailLines.every((line) => /^(?:[A-Za-z][A-Za-z0-9-]*:\s|(?:Closes|Part of)\s+#\d+)/.test(line));
  if (lines.length > 0 && !endsWithTrailers) lines.push('');
  lines.push(`${REASON_TRAILER}: ${reason}`);
  return `${lines.join('\n')}\n`;
}

export function readPreflightHistory(historyPath) {
  try {
    if (!existsSync(historyPath)) return {};
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writePreflightHistory(historyPath, history) {
  mkdirSync(dirname(historyPath), { recursive: true });
  writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
}

export function pruneLandedEntries(entries, isAncestorOfMain) {
  const list = Array.isArray(entries) ? entries : [];
  let lastLanded = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]?.sha && isAncestorOfMain(list[i].sha)) lastLanded = i;
  }
  return lastLanded === -1 ? list : list.slice(lastLanded + 1);
}

export function evaluateGreenRerunGuard({
  priorEntries,
  sha,
  reason,
  lane,
  taskBranch,
  previousConclusion,
}) {
  const prior = Array.isArray(priorEntries) ? priorEntries : [];
  const last = prior.at(-1) ?? null;
  if (last && last.sha === sha) {
    return { ok: true, sameSha: true, round: prior.length };
  }
  const round = prior.length + 1;
  if (round < 3) {
    return { ok: true, sameSha: false, round };
  }
  const prevConclusion = previousConclusion ?? last?.conclusion ?? null;
  if (prevConclusion !== 'success' || reason) {
    return { ok: true, sameSha: false, round };
  }
  return {
    ok: false,
    sameSha: false,
    round,
    error: `[preflight] 第 ${round} 次预检（${lane} @ ${taskBranch}）上一次已绿，先把评审发现批量改完再推；确实需重跑请加 --reason "<原因>"`,
  };
}

export function stampPreflightReason({ reason, cwd } = {}) {
  const execOpts = cwd ? { encoding: 'utf8', cwd } : { encoding: 'utf8' };
  const body = execFileSync('git', ['log', '-1', '--format=%B', 'HEAD'], execOpts);
  const nextBody = upsertPreflightReason(body, reason);
  if (nextBody.trimEnd() !== body.trimEnd()) {
    execFileSync('git', ['commit', '--amend', '--only', '--allow-empty', '-q', '-F', '-'], {
      ...execOpts,
      input: nextBody,
    });
  }
  return execFileSync('git', ['rev-parse', 'HEAD'], execOpts).trim();
}

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRun(runs, sha, ref, { priorRunIds = null } = {}) {
  return (
    runs.find(
      (run) =>
        run.name === 'ci' &&
        run.head_sha === sha &&
        run.head_branch === ref &&
        !priorRunIds?.has(run.id),
    ) ?? null
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

export function isSupersededRun(run, { ref, sha, keepShas, currentRun = null }) {
  if (run.head_branch !== ref || run.head_sha === sha || keepShas.has(run.head_sha)) {
    return false;
  }
  if (currentRun) {
    if (
      typeof currentRun.id === 'number' &&
      typeof run.id === 'number' &&
      run.id >= currentRun.id
    ) {
      return false;
    }
    if (
      currentRun.created_at &&
      run.created_at &&
      Date.parse(run.created_at) > Date.parse(currentRun.created_at)
    ) {
      return false;
    }
  }
  return true;
}

export function cancelSupersededRuns({
  repo,
  ref,
  sha,
  queuedShas,
  currentRun = null,
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
    return [];
  }
  const anchor =
    currentRun ??
    runs.find((run) => run.name === 'ci' && run.head_branch === ref && run.head_sha === sha) ??
    null;
  const active = runs.filter(
    (run) =>
      run.name === 'ci' &&
      run.head_branch === ref &&
      run.head_sha !== sha &&
      isActivePreflightRun(run),
  );
  if (active.length === 0) return [];
  let keepShas;
  try {
    keepShas = queuedShas();
  } catch (error) {
    log(`[preflight] could not list queued shas (${error.message}); cancelling nothing`);
    return [];
  }
  const superseded = active.filter((run) =>
    isSupersededRun(run, { ref, sha, keepShas, currentRun: anchor }),
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

export const PREFLIGHT_PUSH_POOL = {
  defaultCount: 1,
  dirName: 'preflight-push',
  label: 'preflight-queue',
};

export async function withPreflightAdmission(
  { bypass = false, env = process.env, log = console.log, acquire = acquireSlot } = {},
  fn,
) {
  if (bypass) return await fn();
  const lease = await acquire({
    pool: PREFLIGHT_PUSH_POOL,
    env: { ...env, CAIRN_CPU_SATURATION_PERCENT: '0', CAIRN_HEAVY_GATE_BYPASS: '' },
    log,
  });
  try {
    return await fn();
  } finally {
    lease?.release();
  }
}

export function waitForPreflightCapacity({
  repo,
  gh,
  sleep,
  log = console.log,
  bypass = false,
  replaced = () => false,
  pollSeconds = 10,
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
  const parsed = parsePreflightArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  const { wait, stampOnly } = parsed;
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const gitDir = resolve(root, git(['rev-parse', '--git-dir']));
  const taskBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const lane = localLane(root);
  const ref = `preflight/${lane}`;
  const stamped = stampUnownedCommits({ lane, prefix: '[preflight]' });
  if (!stamped.ok) {
    console.error(
      '[preflight] could not stamp the owner trailer (a dirty tree or a conflict); fix that and run it again. Nothing was pushed.',
    );
    process.exit(1);
  }
  const historyPath = join(gitDir, 'cairn-preflight-history.json');
  const historyKey = `${lane}::${taskBranch}`;
  const history = readPreflightHistory(historyPath);
  const isAncestorOfMain = (candidateSha) =>
    spawnSync('git', ['merge-base', '--is-ancestor', candidateSha, 'origin/main']).status === 0;
  const priorEntries = pruneLandedEntries(history[historyKey], isAncestorOfMain);
  const headReason = extractCommitReason(git(['log', '-1', '--format=%B', 'HEAD']));
  const lastEntry = priorEntries.at(-1) ?? null;
  const effectiveReason =
    parsed.reason ??
    (headReason && (!lastEntry || lastEntry.sha === stamped.sha || lastEntry.reason !== headReason)
      ? headReason
      : null);
  const sha = parsed.reason
    ? stampPreflightReason({ reason: parsed.reason, cwd: root })
    : stamped.sha;
  if (stampOnly) {
    console.log(`[preflight] stamped ${sha}`);
    process.exit(0);
  }
  const ghJson = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  let previousConclusion = lastEntry?.conclusion ?? null;
  if (priorEntries.length >= 2 && lastEntry?.sha !== sha && !effectiveReason) {
    try {
      const runs =
        ghJson([
          'api',
          `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(ref)}&per_page=20`,
        ])?.workflow_runs ?? [];
      const matched = runs.find((entry) => entry.name === 'ci' && entry.head_sha === lastEntry.sha);
      if (matched?.conclusion) previousConclusion = matched.conclusion;
    } catch {}
  }
  const guard = evaluateGreenRerunGuard({
    priorEntries,
    sha,
    reason: effectiveReason,
    lane,
    taskBranch,
    previousConclusion,
  });
  if (!guard.ok) {
    console.error(guard.error);
    process.exit(1);
  }
  const invocation = fastGateInvocation();
  console.log(
    `[preflight] running the fast gate through ${invocation.runner}; nothing is pushed unless it passes`,
  );
  const gate = runFastGateBeforePush({ root, invocation });
  if (gate.status !== 0) {
    console.error('[preflight] fast gate failed on the exact HEAD tree; nothing was pushed.');
    process.exit(gate.status ?? 1);
  }
  const movedHeadError = (outcome = 'Nothing was pushed') => {
    if (git(['rev-parse', 'HEAD']) === sha) return null;
    return `[preflight] HEAD moved from ${sha.slice(0, 9)} while pre-flight was running, so this run does not cover the new HEAD; run it again. ${outcome}.`;
  };
  const refuseMovedHead = (outcome = 'Nothing was pushed') => {
    const error = movedHeadError(outcome);
    if (!error) return;
    console.error(error);
    process.exit(1);
  };
  const succeed = (message) => {
    refuseMovedHead(`${sha.slice(0, 9)} was pushed`);
    console.log(message);
    process.exit(0);
  };
  refuseMovedHead();
  const sleep = (seconds) => spawnSync('sleep', [String(seconds)]);
  const readQueuedShas = () =>
    new Set(
      git(['ls-remote', 'origin', `${ENQUEUE_PREFIX}*`, `${TRY_PREFIX}*`])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[0]),
    );
  const recordedEntries = guard.sameSha
    ? priorEntries
    : [
        ...priorEntries,
        {
          sha,
          pushedAt: new Date().toISOString(),
          reason: effectiveReason ?? null,
          conclusion: null,
        },
      ];
  const saveConclusion = (conclusion) => {
    const current = readPreflightHistory(historyPath);
    const list = Array.isArray(current[historyKey]) ? current[historyKey] : recordedEntries;
    current[historyKey] = list.map((entry) =>
      entry.sha === sha ? { ...entry, conclusion } : entry,
    );
    writePreflightHistory(historyPath, current);
  };
  const readRun = (priorRunIds = null) => {
    const { workflow_runs: runs } = ghJson([
      'api',
      `repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`,
    ]);
    return preflightRun(runs, sha, ref, { priorRunIds });
  };
  const bypassConcurrency = process.env.CAIRN_PREFLIGHT_CONCURRENCY_BYPASS === '1';
  const admission = await withPreflightAdmission({ bypass: bypassConcurrency }, async () => {
    const preWaitMoved = movedHeadError();
    if (preWaitMoved) return { ok: false, exitCode: 1, error: preWaitMoved };
    let keepShas = null;
    try {
      keepShas = readQueuedShas();
    } catch (error) {
      console.log(
        `[preflight] could not list queued shas (${error.message}); counting every active run`,
      );
    }
    const capacity = waitForPreflightCapacity({
      repo,
      gh: ghJson,
      sleep,
      bypass: bypassConcurrency,
      replaced: (run) => keepShas !== null && isSupersededRun(run, { ref, sha, keepShas }),
    });
    if (!capacity.ok) {
      return { ok: false, exitCode: 1, error: `[preflight] ${capacity.error}` };
    }
    const prePushMoved = movedHeadError();
    if (prePushMoved) return { ok: false, exitCode: 1, error: prePushMoved };
    let priorRunIds = new Set();
    try {
      const existing =
        ghJson([
          'api',
          `repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(ref)}&per_page=100`,
        ])?.workflow_runs ?? [];
      priorRunIds = new Set(
        existing
          .filter(
            (entry) =>
              entry.name === 'ci' &&
              entry.head_sha === sha &&
              entry.head_branch === ref &&
              entry.id !== undefined,
          )
          .map((entry) => entry.id),
      );
    } catch {}
    const push = spawnSync(
      'git',
      [
        'push',
        '--no-follow-tags',
        `--force-with-lease=${preflightRef(lane)}`,
        'origin',
        `${sha}:${preflightRef(lane)}`,
      ],
      { stdio: 'inherit' },
    );
    if (push.status !== 0) return { ok: false, exitCode: push.status ?? 1, error: null };
    console.log(`[preflight] pushed ${sha.slice(0, 9)} to ${preflightRef(lane)}`);
    history[historyKey] = recordedEntries;
    writePreflightHistory(historyPath, history);
    let run = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        run = readRun(priorRunIds);
      } catch {
        run = null;
      }
      if (run) break;
      sleep(5);
    }
    if (!run) {
      return {
        ok: false,
        exitCode: 1,
        error:
          movedHeadError(`${sha.slice(0, 9)} was pushed`) ??
          '[preflight] could not read the run: the ci run did not appear; check that the ci workflow is enabled',
      };
    }
    return { ok: true, run };
  });
  if (!admission.ok) {
    if (admission.error) console.error(admission.error);
    process.exit(admission.exitCode);
  }
  const { run } = admission;
  refuseMovedHead(`${sha.slice(0, 9)} was pushed`);
  cancelSupersededRuns({
    repo,
    ref,
    sha,
    currentRun: run,
    queuedShas: readQueuedShas,
    gh: ghJson,
    cancel: (id) =>
      spawnSync('gh', ['api', '--method', 'POST', `repos/${repo}/actions/runs/${id}/cancel`], {
        stdio: 'ignore',
      }).status === 0,
  });
  console.log(`[preflight] ci run: ${run.html_url}`);
  if (!wait) {
    succeed(
      '[preflight] rerun with --wait to block until it finishes, then node scripts/ops/push-queue.mjs',
    );
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
        saveConclusion('success');
        succeed('[preflight] green — push-queue will accept this head');
      }
      saveConclusion(outcome.conclusion ?? 'failure');
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
        saveConclusion('success');
        succeed('[preflight] green — push-queue will accept this head');
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
