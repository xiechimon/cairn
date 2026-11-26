#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeIssuesAfterLanding,
  ownerOf,
  pushToMain,
  RELEASE_MARKER,
  REQUIRED_CHECKS,
} from './promote-queue.mjs';

export const ENQUEUE_PREFIX = 'refs/heads/enqueue/';
export const TRY_PREFIX = 'refs/heads/queue/try/';
export const MAX_SPECULATIVE_DEPTH = 4;

const ENQUEUE_REF_RE = /^refs\/heads\/enqueue\/(\d+)-([0-9a-f]+)$/;
const FAILED_JOB_CONCLUSIONS = new Set(['failure', 'timed_out']);
const GREEN_CONCLUSIONS = new Set(['success', 'skipped']);
const COMMITTER_ENV = {
  GIT_COMMITTER_NAME: 'xiechimon',
  GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
};

export function makeEnqueueId(sha, nowMs = Date.now()) {
  return `${String(nowMs).padStart(13, '0')}-${sha.slice(0, 9)}`;
}

export function parseEnqueueRef(ref) {
  const match = ENQUEUE_REF_RE.exec(ref ?? '');
  if (!match) return null;
  return {
    id: `${match[1]}-${match[2]}`,
    ref,
    ts: Number(match[1]),
    shortSha: match[2],
  };
}

export function sortEnqueueEntries(entries) {
  return entries
    .map((entry) => {
      const parsed = parseEnqueueRef(entry.ref);
      return parsed ? { ...entry, ...parsed } : null;
    })
    .filter(Boolean)
    .toSorted((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

export function latestCompletedCheckMap(checkRuns) {
  return new Map(
    checkRuns
      .filter((check) => !check.status || check.status === 'completed')
      .toSorted(
        (a, b) =>
          (Date.parse(a.completed_at ?? a.started_at) || 0) -
            (Date.parse(b.completed_at ?? b.started_at) || 0) || (a.id ?? 0) - (b.id ?? 0),
      )
      .map((check) => [check.name, check.conclusion]),
  );
}

export function evaluateSpeculativeCandidate({ sha, ciRuns, checkRuns, jobs = [] }) {
  const matchingRuns = ciRuns.filter(
    (run) =>
      run.name === 'ci' &&
      run.head_sha === sha &&
      typeof run.head_branch === 'string' &&
      (run.head_branch.startsWith('queue/') || run.head_branch.startsWith('refs/heads/queue/')),
  );
  const run =
    matchingRuns.find((item) => item.status === 'completed' && item.conclusion === 'success') ??
    matchingRuns[0];
  if (run?.status !== 'completed') {
    return { state: 'pending', runId: run?.id ?? null, inFlight: Boolean(run) };
  }
  if (run.conclusion !== 'success') {
    const failedJobs = jobs
      .filter((job) => FAILED_JOB_CONCLUSIONS.has(job.conclusion))
      .map((job) => job.name);
    const attempt = run.run_attempt ?? 1;
    if (attempt <= 1) {
      return {
        state: 'retry',
        runId: run.id,
        runUrl: run.html_url,
        rerun: failedJobs.length > 0 ? 'rerun-failed-jobs' : 'rerun',
        failedJobs,
        conclusion: run.conclusion,
      };
    }
    return {
      state: 'red',
      runId: run.id,
      runAttempt: attempt,
      runUrl: run.html_url,
      failedJobs,
      conclusion: run.conclusion,
    };
  }
  const byName = latestCompletedCheckMap(checkRuns);
  const missing = REQUIRED_CHECKS.filter((name) => !GREEN_CONCLUSIONS.has(byName.get(name) ?? ''));
  if (missing.length > 0) {
    return { state: 'pending', runId: run.id };
  }
  return { state: 'green', runId: run.id };
}

export function planQueueStep({
  mainTip,
  entries,
  tryMap,
  verdicts,
  landedSet = new Set(),
  maxDepth = MAX_SPECULATIVE_DEPTH,
}) {
  const prune = [];
  const ejectUnverified = [];
  const active = [];

  for (const entry of entries) {
    const existingTry = tryMap.get(entry.id);
    if (
      entry.released ||
      entry.sha === mainTip ||
      landedSet.has(entry.sha) ||
      (existingTry && landedSet.has(existingTry.sha))
    ) {
      prune.push(entry);
      continue;
    }
    if (!entry.verified) {
      ejectUnverified.push(entry);
      continue;
    }
    active.push(entry);
  }

  const activeIds = active.map((entry) => entry.id);
  const window = active.slice(0, maxDepth);
  const windowIds = new Set(window.map((entry) => entry.id));

  const orphanTryRefs = [];
  for (const id of tryMap.keys()) {
    if (!windowIds.has(id) && !prune.some((item) => item.id === id)) {
      orphanTryRefs.push(`${TRY_PREFIX}${id}`);
    }
  }

  let validPrefixEnd = -1;
  for (let i = 0; i < window.length; i += 1) {
    const info = tryMap.get(window[i].id);
    if (!info?.validOnParent) break;
    validPrefixEnd = i;
  }

  let furthestGreen = -1;
  for (let i = 0; i <= validPrefixEnd; i += 1) {
    const info = tryMap.get(window[i].id);
    const verdict = verdicts.get(info.sha);
    if (verdict?.state === 'green') furthestGreen = i;
  }

  if (furthestGreen >= 0) {
    const targetInfo = tryMap.get(window[furthestGreen].id);
    const cancelRunIds = [];
    for (let i = 0; i < furthestGreen; i += 1) {
      const info = tryMap.get(window[i].id);
      const verdict = verdicts.get(info.sha);
      if (verdict && verdict.state !== 'green' && verdict.runId) {
        cancelRunIds.push(verdict.runId);
      }
    }
    return {
      prune,
      ejectUnverified,
      activeIds,
      promote: {
        targetSha: targetInfo.sha,
        entries: window.slice(0, furthestGreen + 1),
        cancelRunIds,
      },
      retry: [],
      ejectRed: null,
      rebuild: [],
      cancelObsoleteRunIds: [],
      orphanTryRefs,
    };
  }

  const retry = [];
  for (let i = 0; i <= validPrefixEnd; i += 1) {
    const info = tryMap.get(window[i].id);
    const verdict = verdicts.get(info.sha);
    if (verdict?.state === 'retry' && verdict.runId) {
      retry.push({
        entry: window[i],
        trySha: info.sha,
        runId: verdict.runId,
        rerun: verdict.rerun,
        runUrl: verdict.runUrl,
        failedJobs: verdict.failedJobs ?? [],
      });
    }
  }

  let ejectRed = null;
  if (validPrefixEnd >= 0) {
    const headInfo = tryMap.get(window[0].id);
    const headVerdict = verdicts.get(headInfo.sha);
    if (headVerdict?.state === 'red') {
      const cancelRunIds = [];
      for (let i = 1; i <= validPrefixEnd; i += 1) {
        const info = tryMap.get(window[i].id);
        const verdict = verdicts.get(info.sha);
        if (verdict?.runId && verdict.state === 'pending') {
          cancelRunIds.push(verdict.runId);
        }
      }
      ejectRed = {
        entry: window[0],
        trySha: headInfo.sha,
        verdict: headVerdict,
        cancelRunIds,
      };
      return {
        prune,
        ejectUnverified,
        activeIds,
        promote: null,
        retry: [],
        ejectRed,
        rebuild: [],
        cancelObsoleteRunIds: [],
        orphanTryRefs,
      };
    }
  }

  const rebuild = [];
  const cancelObsoleteRunIds = [];
  if (validPrefixEnd + 1 < window.length) {
    let parentSha = validPrefixEnd >= 0 ? tryMap.get(window[validPrefixEnd].id).sha : mainTip;
    for (let i = validPrefixEnd + 1; i < window.length; i += 1) {
      const entry = window[i];
      const existing = tryMap.get(entry.id);
      if (existing) {
        const verdict = verdicts.get(existing.sha);
        if (verdict?.runId && verdict.state === 'pending') {
          cancelObsoleteRunIds.push(verdict.runId);
        }
      }
      rebuild.push({
        entry,
        parentSha: i === validPrefixEnd + 1 ? parentSha : null,
      });
      parentSha = null;
    }
  }

  return {
    prune,
    ejectUnverified,
    activeIds,
    promote: null,
    retry,
    ejectRed: null,
    rebuild,
    cancelObsoleteRunIds,
    orphanTryRefs,
  };
}

function runGit(cwd, args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  }).trim();
}

function isAncestor(cwd, older, newer) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd }).status === 0;
}

function commitSignaturesRange(cwd, base, tip) {
  const out = runGit(cwd, ['log', '--reverse', '--format=%s%x00%an%x00%ae', `${base}..${tip}`]);
  return out === '' ? [] : out.split('\n');
}

function cherrySignatures(cwd, expectedParent, entrySha) {
  const cherry = runGit(cwd, ['cherry', expectedParent, entrySha]);
  if (cherry === '') return [];
  const shas = cherry
    .split('\n')
    .filter((line) => line.startsWith('+ '))
    .map((line) => line.slice(2).trim().split(/\s+/)[0]);
  return shas.map((sha) => runGit(cwd, ['show', '-s', '--format=%s%x00%an%x00%ae', sha]));
}

export function isTryValid({ cwd, expectedParent, trySha, entrySha }) {
  if (!trySha || !isAncestor(cwd, expectedParent, trySha)) return false;
  const trySigs = commitSignaturesRange(cwd, expectedParent, trySha);
  const entrySigs = cherrySignatures(cwd, expectedParent, entrySha);
  if (trySigs.length !== entrySigs.length) return false;
  return trySigs.every((sig, index) => sig === entrySigs[index]);
}

function treeOf(cwd, sha) {
  return runGit(cwd, ['rev-parse', `${sha}^{tree}`]);
}

export function rebaseOntoTry({ cwd, expectedParent, entrySha }) {
  if (isAncestor(cwd, expectedParent, entrySha)) {
    return { ok: true, sha: entrySha, rebased: false };
  }
  const missing = cherrySignatures(cwd, expectedParent, entrySha);
  if (missing.length === 0) {
    return { ok: true, sha: expectedParent, rebased: false, empty: true };
  }
  const base = runGit(cwd, ['merge-base', expectedParent, entrySha]);
  const workDir = mkdtempSync(join(tmpdir(), 'cairn-try-'));
  try {
    runGit(cwd, ['worktree', 'add', '--detach', workDir, entrySha], COMMITTER_ENV);
    const rebase = spawnSync('git', ['rebase', '--empty=drop', '--onto', expectedParent, base], {
      cwd: workDir,
      encoding: 'utf8',
      env: { ...process.env, ...COMMITTER_ENV },
    });
    if (rebase.status !== 0) {
      const conflictsOut = runGit(workDir, ['diff', '--name-only', '--diff-filter=U']);
      const conflicts = conflictsOut === '' ? ['(rebase conflict)'] : conflictsOut.split('\n');
      spawnSync('git', ['rebase', '--abort'], { cwd: workDir });
      return { ok: false, conflicts };
    }
    const sha = runGit(workDir, ['rev-parse', 'HEAD']);
    return { ok: true, sha, rebased: true };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', workDir], { cwd });
    rmSync(workDir, { recursive: true, force: true });
  }
}

function gh(args, options = {}) {
  return JSON.parse(
    execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    }),
  );
}

function ghPages(path, key) {
  return gh(['--paginate', '--slurp', path]).flatMap((page) => page?.[key] ?? []);
}

function deleteRemoteRefs(cwd, refs) {
  if (refs.length === 0) return true;
  const targets = refs.map((ref) => `:${ref}`);
  const push = spawnSync('git', ['push', 'origin', ...targets], { cwd, encoding: 'utf8' });
  if (push.stdout) process.stdout.write(push.stdout);
  if (push.stderr) process.stderr.write(push.stderr);
  if (push.status !== 0) {
    console.log(`::warning::failed to delete remote ref(s) ${refs.join(', ')}`);
    return false;
  }
  return true;
}

function commentOnCommit(repo, sha, body) {
  try {
    gh(['--method', 'POST', `repos/${repo}/commits/${sha}/comments`, '-f', `body=${body}`], {
      env: { ...process.env, GH_TOKEN: process.env.QUEUE_WRITE_TOKEN ?? process.env.GH_TOKEN },
    });
  } catch (error) {
    console.log(
      `::warning::could not comment on ${sha.slice(0, 9)}: ${error.message.split('\n')[0]}`,
    );
  }
}

function cancelRuns(repo, runIds) {
  for (const runId of runIds) {
    if (!runId) continue;
    spawnSync('gh', ['api', '--method', 'POST', `repos/${repo}/actions/runs/${runId}/cancel`], {
      stdio: 'ignore',
    });
  }
}

function readEntryMeta(repo, cwd, sha) {
  const subject = runGit(cwd, ['log', '-1', '--format=%s', sha]);
  const body = runGit(cwd, ['log', '-1', '--format=%B', sha]);
  const owner = ownerOf(body);
  let released = false;
  try {
    const comments = gh([`repos/${repo}/commits/${sha}/comments?per_page=100`]);
    released = comments.some((comment) => comment.body.startsWith(RELEASE_MARKER));
  } catch {
    released = false;
  }
  const checkRuns = ghPages(`repos/${repo}/commits/${sha}/check-runs?per_page=100`, 'check_runs');
  const byName = latestCompletedCheckMap(checkRuns);
  const verified = REQUIRED_CHECKS.every((name) => GREEN_CONCLUSIONS.has(byName.get(name) ?? ''));
  return { subject, owner, released, verified };
}

function readTryVerdict(repo, sha) {
  const { workflow_runs: ciRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${sha}&event=push&per_page=30`,
  ]);
  const checkRuns = ghPages(`repos/${repo}/commits/${sha}/check-runs?per_page=100`, 'check_runs');
  const failed = ciRuns.find(
    (run) =>
      run.name === 'ci' &&
      run.head_sha === sha &&
      typeof run.head_branch === 'string' &&
      (run.head_branch.startsWith('queue/') || run.head_branch.startsWith('refs/heads/queue/')) &&
      run.status === 'completed' &&
      run.conclusion === 'failure',
  );
  const jobs = failed
    ? ghPages(`repos/${repo}/actions/runs/${failed.id}/jobs?filter=latest&per_page=100`, 'jobs')
    : [];
  return evaluateSpeculativeCandidate({ sha, ciRuns, checkRuns, jobs });
}

function hasCommit(cwd, sha) {
  return spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd }).status === 0;
}

function fetchQueueRefs(cwd) {
  const fetch = spawnSync(
    'git',
    [
      'fetch',
      '--quiet',
      '--prune',
      'origin',
      '+refs/heads/main:refs/remotes/origin/main',
      `+${ENQUEUE_PREFIX}*:refs/remotes/origin/enqueue/*`,
      `+${TRY_PREFIX}*:refs/remotes/origin/queue/try/*`,
    ],
    { cwd, encoding: 'utf8' },
  );
  if (fetch.stderr) process.stderr.write(fetch.stderr);
  if (fetch.status !== 0) {
    throw new Error(`git fetch speculative queue refs failed with status ${fetch.status}`);
  }
}

function listRemoteQueueRefs(cwd) {
  const out = runGit(cwd, [
    'ls-remote',
    'origin',
    `${ENQUEUE_PREFIX}*`,
    `${TRY_PREFIX}*`,
    'refs/heads/main',
  ]);
  const enqueueRaw = [];
  const tryRaw = new Map();
  let mainTip = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [sha, ref] = line.split(/\s+/);
    if (ref === 'refs/heads/main') mainTip = sha;
    else if (ref.startsWith(ENQUEUE_PREFIX)) enqueueRaw.push({ ref, sha });
    else if (ref.startsWith(TRY_PREFIX)) tryRaw.set(ref.slice(TRY_PREFIX.length), sha);
  }
  return { mainTip, enqueue: sortEnqueueEntries(enqueueRaw), tryRaw };
}

export function runQueuePass({ repo, enforce = true, cwd = process.cwd() }) {
  const retriedRuns = new Set();
  for (let pass = 0; pass < 8; pass += 1) {
    let { mainTip, enqueue, tryRaw } = listRemoteQueueRefs(cwd);
    if (!mainTip) throw new Error('could not resolve refs/heads/main on origin');
    if (enqueue.length === 0 && tryRaw.size === 0) {
      console.log('[speculative-queue] idle: no enqueued commits');
      return { action: 'idle' };
    }

    fetchQueueRefs(cwd);
    const refreshed = listRemoteQueueRefs(cwd);
    mainTip = refreshed.mainTip;
    enqueue = refreshed.enqueue;
    tryRaw = refreshed.tryRaw;
    if (!mainTip) throw new Error('could not resolve refs/heads/main on origin');
    const missingCommit =
      !hasCommit(cwd, mainTip) ||
      enqueue.some((item) => !hasCommit(cwd, item.sha)) ||
      [...tryRaw.values()].some((sha) => !hasCommit(cwd, sha));
    if (missingCommit) fetchQueueRefs(cwd);

    const entries = enqueue.map((item) => ({
      ...item,
      ...readEntryMeta(repo, cwd, item.sha),
    }));

    const landedSet = new Set();
    for (const item of entries) {
      if (
        isAncestor(cwd, item.sha, mainTip) ||
        cherrySignatures(cwd, mainTip, item.sha).length === 0
      ) {
        landedSet.add(item.sha);
      }
      const trySha = tryRaw.get(item.id);
      if (trySha && isAncestor(cwd, trySha, mainTip)) {
        landedSet.add(trySha);
      }
    }

    const active = entries.filter(
      (item) => !item.released && !landedSet.has(item.sha) && item.verified,
    );
    const window = active.slice(0, MAX_SPECULATIVE_DEPTH);
    const tryMap = new Map();
    const verdicts = new Map();

    let prevSha = mainTip;
    let chainBroken = false;
    const supersededRunIds = [];
    for (let i = 0; i < window.length; i += 1) {
      const item = window[i];
      const existingTrySha = tryRaw.get(item.id) ?? null;
      const existingValid =
        !chainBroken &&
        existingTrySha !== null &&
        isTryValid({ cwd, expectedParent: prevSha, trySha: existingTrySha, entrySha: item.sha });
      const stacksUnchanged =
        !chainBroken &&
        (!existingValid || existingTrySha === item.sha) &&
        isAncestor(cwd, prevSha, item.sha);
      const addsNothing =
        !chainBroken &&
        prevSha !== mainTip &&
        cherrySignatures(cwd, prevSha, item.sha).length === 0;
      if (stacksUnchanged || addsNothing) {
        const covering = stacksUnchanged ? item.sha : prevSha;
        if (existingTrySha && existingTrySha !== covering) {
          const stale = readTryVerdict(repo, existingTrySha);
          if (stale.inFlight) supersededRunIds.push(stale.runId);
        }
        tryMap.set(item.id, { sha: covering, validOnParent: true });
        if (stacksUnchanged) verdicts.set(covering, { state: 'green', runId: null });
        prevSha = covering;
        continue;
      }
      if (existingTrySha) {
        tryMap.set(item.id, { sha: existingTrySha, validOnParent: existingValid });
        verdicts.set(existingTrySha, readTryVerdict(repo, existingTrySha));
      }
      if (!existingValid) chainBroken = true;
      else prevSha = existingTrySha;
    }
    for (const [id, trySha] of tryRaw.entries()) {
      if (!tryMap.has(id)) tryMap.set(id, { sha: trySha, validOnParent: false });
    }

    const plan = planQueueStep({
      mainTip,
      entries,
      tryMap,
      verdicts,
      landedSet,
      maxDepth: MAX_SPECULATIVE_DEPTH,
    });

    if (enforce && (plan.prune.length > 0 || plan.orphanTryRefs.length > 0)) {
      const refs = [
        ...plan.prune.map((item) => item.ref),
        ...plan.prune
          .filter((item) => tryRaw.has(item.id))
          .map((item) => `${TRY_PREFIX}${item.id}`),
        ...plan.orphanTryRefs,
      ];
      deleteRemoteRefs(cwd, refs);
    }

    for (const bad of plan.ejectUnverified) {
      if (enforce) {
        const refs = [bad.ref, ...(tryRaw.has(bad.id) ? [`${TRY_PREFIX}${bad.id}`] : [])];
        if (!deleteRemoteRefs(cwd, refs)) return { action: 'wait' };
        commentOnCommit(
          repo,
          bad.sha,
          `Removed from merge queue: ${bad.sha.slice(0, 9)} (${bad.subject}) lacks green preflight evidence (${REQUIRED_CHECKS.join(' + ')}). Re-run \`node scripts/ops/preflight.mjs --wait\` and \`node scripts/ops/push-queue.mjs\`.`,
        );
      }
    }

    if (enforce) cancelRuns(repo, supersededRunIds);

    if (plan.promote) {
      const { targetSha, entries: promotedEntries, cancelRunIds } = plan.promote;
      console.log(
        `[speculative-queue] promoting batch of ${promotedEntries.length} (${promotedEntries.map((item) => item.id).join(', ')}) -> ${targetSha.slice(0, 9)}`,
      );
      if (enforce) {
        const sleep = (seconds) =>
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
        let concurrentMainAdvance = false;
        try {
          pushToMain({
            sha: targetSha,
            mainTip,
            push: () =>
              spawnSync('git', ['push', 'origin', `${targetSha}:refs/heads/main`], {
                cwd,
                encoding: 'utf8',
              }),
            recheck: () => {
              const latest = listRemoteQueueRefs(cwd);
              return {
                mainTip: latest.mainTip,
                landed: isAncestor(cwd, targetSha, latest.mainTip),
              };
            },
            sleep,
          });
        } catch (error) {
          fetchQueueRefs(cwd);
          const latest = listRemoteQueueRefs(cwd);
          if (isAncestor(cwd, targetSha, latest.mainTip)) {
            console.log(
              `[speculative-queue] ${targetSha.slice(0, 9)} already landed on main concurrently`,
            );
          } else if (latest.mainTip && latest.mainTip !== mainTip) {
            console.log(
              `[speculative-queue] main moved concurrently (${mainTip.slice(0, 9)} -> ${latest.mainTip.slice(0, 9)}); rebasing queue`,
            );
            concurrentMainAdvance = true;
          } else {
            throw error;
          }
        }
        if (concurrentMainAdvance) continue;
        closeIssuesAfterLanding({ repo, before: mainTip, after: targetSha });
        cancelRuns(repo, cancelRunIds);
        const cleanupRefs = [
          ...promotedEntries.map((item) => item.ref),
          ...promotedEntries
            .filter((item) => tryRaw.has(item.id))
            .map((item) => `${TRY_PREFIX}${item.id}`),
        ];
        deleteRemoteRefs(cwd, cleanupRefs);
        continue;
      }
      return { action: 'promote', targetSha };
    }

    let didRetry = false;
    if (enforce && plan.retry.length > 0) {
      for (const target of plan.retry) {
        if (retriedRuns.has(target.runId)) continue;
        retriedRuns.add(target.runId);
        execFileSync(
          'gh',
          ['api', '--method', 'POST', `repos/${repo}/actions/runs/${target.runId}/${target.rerun}`],
          { stdio: 'inherit' },
        );
        console.log(`[speculative-queue] ${target.rerun} ${target.runUrl} once`);
        didRetry = true;
      }
      if (didRetry && plan.rebuild.length === 0 && !plan.ejectRed) return { action: 'retry' };
    }

    if (enforce && plan.ejectRed) {
      const { entry: failedEntry, verdict, cancelRunIds } = plan.ejectRed;
      console.log(
        `[speculative-queue] ejecting red head ${failedEntry.id} (${failedEntry.sha.slice(0, 9)})`,
      );
      cancelRuns(repo, cancelRunIds);
      const refs = [
        failedEntry.ref,
        ...(tryRaw.has(failedEntry.id) ? [`${TRY_PREFIX}${failedEntry.id}`] : []),
      ];
      if (!deleteRemoteRefs(cwd, refs)) return { action: 'wait' };
      const reason =
        verdict.failedJobs?.length > 0
          ? `ci failed again in ${verdict.failedJobs.join(', ')}`
          : `ci ended ${verdict.conclusion} again`;
      commentOnCommit(
        repo,
        failedEntry.sha,
        [
          `Removed from merge queue: ${reason}.`,
          verdict.runUrl ? `Run: ${verdict.runUrl}` : null,
          `Commit: ${failedEntry.sha.slice(0, 9)} ${failedEntry.subject}`,
          failedEntry.owner ? `Owner: ${failedEntry.owner.label}` : null,
          'Fix the failure, run `node scripts/ops/preflight.mjs --wait`, and re-queue with `node scripts/ops/push-queue.mjs`.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      continue;
    }

    if (enforce && plan.rebuild.length > 0) {
      let currentParent = plan.rebuild[0].parentSha;
      let hitConflict = false;
      let pushedAny = false;
      let keptAny = false;
      for (const step of plan.rebuild) {
        const res = rebaseOntoTry({
          cwd,
          expectedParent: currentParent,
          entrySha: step.entry.sha,
        });
        const existingTrySha = tryRaw.get(step.entry.id);
        const existingVerdict = verdicts.get(existingTrySha);
        const obsoleteRunIds = plan.cancelObsoleteRunIds.filter(
          (runId) => runId === existingVerdict?.runId,
        );
        const alreadyBuilt =
          res.ok &&
          existingTrySha !== undefined &&
          isTryValid({
            cwd,
            expectedParent: currentParent,
            trySha: existingTrySha,
            entrySha: step.entry.sha,
          });
        const runCoversRebuild =
          res.ok &&
          Boolean(existingVerdict?.inFlight) &&
          treeOf(cwd, res.sha) === treeOf(cwd, existingTrySha);
        if (alreadyBuilt || runCoversRebuild) {
          console.log(
            `[speculative-queue] holding ${TRY_PREFIX}${step.entry.id} at ${existingTrySha.slice(0, 9)}: its run already covers what a rebuild would test`,
          );
          currentParent = existingTrySha;
          keptAny = true;
          continue;
        }
        cancelRuns(repo, obsoleteRunIds);
        if (!res.ok && keptAny && !isAncestor(cwd, mainTip, currentParent)) break;
        if (!res.ok) {
          const refs = [
            step.entry.ref,
            ...(tryRaw.has(step.entry.id) ? [`${TRY_PREFIX}${step.entry.id}`] : []),
          ];
          if (!deleteRemoteRefs(cwd, refs)) return { action: 'wait' };
          commentOnCommit(
            repo,
            step.entry.sha,
            [
              `Removed from merge queue: rebase conflict onto ${currentParent.slice(0, 9)}.`,
              `Conflicting files: ${res.conflicts.join(', ')}`,
              step.entry.owner ? `Owner: ${step.entry.owner.label}` : null,
              'Rebase onto latest origin/main, run `node scripts/ops/preflight.mjs --wait`, and push again.',
            ]
              .filter(Boolean)
              .join('\n'),
          );
          hitConflict = true;
          break;
        }
        const pushSha = res.sha;
        const pushTry = spawnSync(
          'git',
          ['push', '--force', 'origin', `${pushSha}:${TRY_PREFIX}${step.entry.id}`],
          { cwd, stdio: 'inherit' },
        );
        if (pushTry.status !== 0) {
          throw new Error(`failed to push ${TRY_PREFIX}${step.entry.id}`);
        }
        console.log(
          `[speculative-queue] built ${TRY_PREFIX}${step.entry.id} -> ${pushSha.slice(0, 9)} atop ${currentParent.slice(0, 9)}${res.empty ? ' (empty delta preserved)' : ''}`,
        );
        currentParent = pushSha;
        pushedAny = true;
      }
      if (hitConflict) continue;
      if (keptAny && !pushedAny) return { action: 'wait' };
      return { action: 'rebuilt' };
    }

    if (didRetry) return { action: 'retry' };

    console.log(`[speculative-queue] waiting on ${window.length} active try branch(es)`);
    return { action: 'wait' };
  }
  return { action: 'wait' };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const enforce = process.argv.includes('--enforce');
  runQueuePass({ repo, enforce, cwd: process.cwd() });
}
