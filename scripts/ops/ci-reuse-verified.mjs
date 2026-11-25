#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const VERIFIED_PREFIX = /^(queue|preflight)\//;
const PACK_SMOKE_VALID = new Set(['success', 'skipped']);

export function selectVerifiedPriorRun({
  ref,
  eventName,
  repo,
  sha,
  hasSidecar,
  evalRequired,
  runs,
  jobsOf,
}) {
  if (ref !== 'refs/heads/main' || eventName !== 'push') {
    return { reuse: false, reason: 'only push to refs/heads/main may reuse prior CI' };
  }
  if (hasSidecar) {
    return { reuse: false, reason: 'sidecar changes must build tsnet-sidecar-binaries on main' };
  }
  if (!sha || !repo) {
    return { reuse: false, reason: 'missing commit sha or repository' };
  }

  const candidates = [...(runs ?? [])]
    .filter(
      (run) =>
        run &&
        run.name === 'ci' &&
        run.event === 'push' &&
        run.head_sha === sha &&
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        (!run.repository?.full_name || run.repository.full_name === repo) &&
        typeof run.head_branch === 'string' &&
        VERIFIED_PREFIX.test(run.head_branch),
    )
    .toSorted((a, b) => (b.id ?? 0) - (a.id ?? 0));

  for (const run of candidates) {
    let jobs;
    try {
      jobs = jobsOf(run.id, run.run_attempt ?? 1);
    } catch {
      return { reuse: false, reason: `failed to inspect jobs for run ${run.id}` };
    }
    const byName = new Map((jobs ?? []).map((job) => [job.name, job.conclusion]));
    if (byName.get('check') !== 'success') continue;
    if (byName.get('e2e-gate') !== 'success') continue;
    if (!PACK_SMOKE_VALID.has(byName.get('pack-smoke') ?? '')) continue;
    if (evalRequired && byName.get('eval') !== 'success') continue;
    return { reuse: true, runId: run.id };
  }
  return { reuse: false, reason: `no verified green queue/preflight ci run covers ${sha}` };
}

function ghJson(path) {
  return JSON.parse(
    execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }),
  );
}

function listAllJobs(repo, runId, attempt) {
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const data = ghJson(
      `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`,
    );
    const batch = data.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100) break;
  }
  return jobs;
}

if (process.argv[1] && import.meta.filename === realpathSync(process.argv[1])) {
  const ref = process.env.GITHUB_REF ?? '';
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  const sha = process.env.GITHUB_SHA ?? '';
  const hasSidecar = process.env.HAS_SIDECAR === 'true';
  const evalRequired = process.env.EVAL_REQUIRED === 'true';

  let result = { reuse: false, reason: 'uninitialized' };
  try {
    if (ref === 'refs/heads/main' && eventName === 'push' && !hasSidecar && repo && sha) {
      const data = ghJson(
        `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=30`,
      );
      result = selectVerifiedPriorRun({
        ref,
        eventName,
        repo,
        sha,
        hasSidecar,
        evalRequired,
        runs: data.workflow_runs ?? [],
        jobsOf: (runId, attempt) => listAllJobs(repo, runId, attempt),
      });
    } else {
      result = selectVerifiedPriorRun({
        ref,
        eventName,
        repo,
        sha,
        hasSidecar,
        evalRequired,
        runs: [],
        jobsOf: () => [],
      });
    }
  } catch (error) {
    result = {
      reuse: false,
      reason: `lookup failed closed: ${String(error.message ?? error).split('\n')[0]}`,
    };
  }

  console.error(
    result.reuse
      ? `[ci-reuse] verified exact SHA ${sha.slice(0, 9)} from prior ci run ${result.runId}; skipping redundant main test matrix`
      : `[ci-reuse] running full CI on ${ref || 'unknown'}: ${result.reason}`,
  );
  console.log(`reused-sha=${result.reuse}`);
  console.log(`reused-run-id=${result.reuse ? result.runId : ''}`);
}
