#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const VERIFIED_PREFIX = /^(queue|preflight)\//;
const PACK_SMOKE_VALID = new Set(['success', 'skipped']);
const TRY_REF_PREFIX = 'refs/heads/queue/try/';
const GREEN_RUN_PAGES = 3;

const mayReuse = (ref, eventName) =>
  eventName === 'push' && (ref === 'refs/heads/main' || ref?.startsWith(TRY_REF_PREFIX));

export function selectVerifiedPriorRun({
  ref,
  eventName,
  repo,
  sha,
  tree,
  hasSidecar,
  evalRequired,
  runs,
  jobsOf,
}) {
  if (!mayReuse(ref, eventName)) {
    return { reuse: false, reason: 'only a push to main or queue/try/* may reuse prior CI' };
  }
  if (hasSidecar) {
    return { reuse: false, reason: 'sidecar changes must build tsnet-sidecar-binaries on main' };
  }
  const sameCode =
    ref === 'refs/heads/main'
      ? (run) => run.head_sha === sha
      : (run) => run.head_commit?.tree_id === tree;
  if (!sha || !repo || (ref !== 'refs/heads/main' && !tree)) {
    return { reuse: false, reason: 'missing commit sha, tree or repository' };
  }

  const candidates = [...(runs ?? [])]
    .filter(
      (run) =>
        run &&
        run.name === 'ci' &&
        run.event === 'push' &&
        sameCode(run) &&
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
  const covered = ref === 'refs/heads/main' ? sha : `tree ${tree}`;
  return { reuse: false, reason: `no verified green queue/preflight ci run covers ${covered}` };
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

function listCandidateRuns({ repo, ref, sha }) {
  const base = `repos/${repo}/actions/workflows/ci.yml/runs?event=push`;
  if (ref === 'refs/heads/main') {
    return ghJson(`${base}&head_sha=${sha}&per_page=30`).workflow_runs ?? [];
  }
  const runs = [];
  for (let page = 1; page <= GREEN_RUN_PAGES; page += 1) {
    const batch = ghJson(`${base}&status=success&per_page=100&page=${page}`).workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  return runs;
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
    const lookUp = mayReuse(ref, eventName) && !hasSidecar && repo && sha;
    const tree = lookUp
      ? execFileSync('git', ['rev-parse', `${sha}^{tree}`], { encoding: 'utf8' }).trim()
      : '';
    result = selectVerifiedPriorRun({
      ref,
      eventName,
      repo,
      sha,
      tree,
      hasSidecar,
      evalRequired,
      runs: lookUp ? listCandidateRuns({ repo, ref, sha }) : [],
      jobsOf: (runId, attempt) => listAllJobs(repo, runId, attempt),
    });
  } catch (error) {
    result = {
      reuse: false,
      reason: `lookup failed closed: ${String(error.message ?? error).split('\n')[0]}`,
    };
  }

  console.error(
    result.reuse
      ? `[ci-reuse] ${sha.slice(0, 9)} on ${ref} is verified by prior ci run ${result.runId}; skipping the redundant test matrix`
      : `[ci-reuse] running full CI on ${ref || 'unknown'}: ${result.reason}`,
  );
  console.log(`reused-sha=${result.reuse}`);
  console.log(`reused-run-id=${result.reuse ? result.runId : ''}`);
}
