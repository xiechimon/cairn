#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { failedGreenContexts, GREEN_CONTEXTS } from './push-queue.mjs';

const CI_WORKFLOW = 'ci.yml';
const MAIN_REF = 'main';
const PAGE = 100;
const GREEN_JOB_CONCLUSIONS = new Map([
  ['check', new Set(['success'])],
  ['pack-smoke', new Set(['success', 'skipped'])],
  ['e2e-gate', new Set(['success'])],
]);

const listPages = (gh, endpoint, key) => {
  const separator = endpoint.includes('?') ? '&' : '?';
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch =
      JSON.parse(gh(['api', `${endpoint}${separator}per_page=${PAGE}&page=${page}`]))[key] ?? [];
    items.push(...batch);
    if (batch.length === 0) break;
  }
  return items;
};

export function pickAuthoritativeRun(runs) {
  let newest = null;
  for (const run of runs ?? []) {
    if (run?.id == null) continue;
    if (run.event !== 'push' || run.head_branch !== MAIN_REF) continue;
    if (newest === null || run.id > newest.id) newest = run;
  }
  return newest;
}

export function fetchGateEvidence({ repo, sha, gh }) {
  const runs = listPages(
    gh,
    `repos/${repo}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&event=push&branch=${MAIN_REF}`,
    'workflow_runs',
  );
  const picked = pickAuthoritativeRun(runs);
  if (picked === null) return { run: null, jobs: [] };
  const readRun = () => JSON.parse(gh(['api', `repos/${repo}/actions/runs/${picked.id}`]));
  const before = readRun();
  const attempt = before.run_attempt ?? 1;
  const jobs = listPages(
    gh,
    `repos/${repo}/actions/runs/${picked.id}/attempts/${attempt}/jobs`,
    'jobs',
  );
  const after = readRun();
  return {
    run: {
      id: picked.id,
      attempt,
      latestAttempt: after.run_attempt,
      status: after.status,
      conclusion: after.conclusion,
      head_sha: after.head_sha,
      repository: repo,
      event: after.event,
      head_branch: after.head_branch,
    },
    jobs,
  };
}

export function missingReleaseContexts(jobs) {
  const byName = new Map((jobs ?? []).map((job) => [job.name, job.conclusion]));
  return GREEN_CONTEXTS.filter((name) => !GREEN_JOB_CONCLUSIONS.get(name)?.has(byName.get(name)));
}

export function evaluate({ run, jobs, sha, repo }) {
  const missing = missingReleaseContexts(jobs ?? []);
  const failed = failedGreenContexts(jobs ?? []);
  if (run === null || run === undefined) {
    return {
      action: 'wait',
      missing: [...GREEN_CONTEXTS],
      failed: [],
      reason: `no push-to-main ci run exists on this SHA yet; the ${GREEN_CONTEXTS.join(' + ')} evidence is absent`,
    };
  }
  if (run.event !== 'push' || run.head_branch !== MAIN_REF) {
    return {
      action: 'block',
      missing,
      failed,
      reason: `ci run ${run.id} is a ${run.event ?? 'non-push'} run on ${run.head_branch ?? 'an unknown branch'}, not a push to main; its green jobs are not release evidence`,
    };
  }
  if (run.repository != null && run.repository !== repo) {
    return {
      action: 'block',
      missing,
      failed,
      reason: `ci run ${run.id} completed in ${run.repository}, not ${repo}; another repository's ci is not evidence for this release`,
    };
  }
  if (run.head_sha !== sha) {
    return {
      action: 'block',
      missing,
      failed,
      reason: `ci run ${run.id} tested ${run.head_sha}, not ${sha}; evidence for another commit is not evidence for this release`,
    };
  }
  if (run.latestAttempt !== run.attempt) {
    return {
      action: 'wait',
      missing,
      failed,
      reason: `ci run ${run.id} attempt ${run.latestAttempt} started after attempt ${run.attempt}; the green evidence must be re-read once that attempt completes`,
    };
  }
  if (run.status !== 'completed') {
    return {
      action: 'wait',
      missing,
      failed,
      reason: `ci run ${run.id} attempt ${run.attempt} is ${run.status ?? 'missing a status'}; it has not completed`,
    };
  }
  if (run.conclusion !== 'success') {
    return {
      action: 'block',
      missing,
      failed,
      reason: `ci run ${run.id} attempt ${run.attempt} concluded ${run.conclusion ?? 'with no conclusion'}; the release needs a completed success`,
    };
  }
  if (missing.length === 0) return { action: 'release' };
  const tail =
    failed.length > 0
      ? `${failed.join(', ')} went red`
      : `${missing.join(', ')} are pending or absent; a partial rerun can omit required jobs, so re-run all jobs before releasing`;
  return {
    action: 'block',
    missing,
    failed,
    reason: `ci run ${run.id} attempt ${run.attempt} lacks green ${GREEN_CONTEXTS.join(' + ')} evidence: ${tail}`,
  };
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const repo = process.env.GATE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const sha =
    process.argv[2] ??
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  try {
    const gh = (args) =>
      execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const evidence = fetchGateEvidence({ repo, sha, gh });
    const verdict = evaluate({ run: evidence.run, jobs: evidence.jobs, sha, repo });
    if (verdict.action === 'release') {
      console.log(
        `[release-gate] ${sha.slice(0, 9)} carries green ${GREEN_CONTEXTS.join(' + ')} on ci run ${evidence.run.id} attempt ${evidence.run.attempt}; the release may proceed`,
      );
      process.exit(0);
    }
    console.error(`[release-gate] not releasing ${sha.slice(0, 9)}: ${verdict.reason}`);
    process.exit(1);
  } catch (error) {
    console.error(
      `[release-gate] could not read ci evidence for ${sha.slice(0, 9)}: ${String(error.message ?? error).split('\n')[0]}`,
    );
    process.exit(2);
  }
}
