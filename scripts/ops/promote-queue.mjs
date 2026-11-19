#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export const QUEUE_REF = 'refs/heads/queue/main';
export const REQUIRED_CHECKS = ['check', 'pack-smoke', 'e2e-gate'];
const POLL_SECONDS = 30;
const WAIT_SECONDS = Number(process.env.PROMOTE_WAIT_SECONDS ?? 40 * 60);
const RERUN_WAIT_SECONDS = Number(process.env.PROMOTE_RERUN_WAIT_SECONDS ?? 25 * 60);
const FAILED_JOB_CONCLUSIONS = ['failure', 'timed_out'];

export function threadOf(message) {
  const ids = [...message.matchAll(/^Amp-Thread-ID:\s*(?:\S*\/threads\/)?(T-[0-9a-f-]+)\s*$/gim)];
  return ids.length > 0 ? ids.at(-1)[1] : null;
}

export function planDrop(chain) {
  if (chain.length === 0) return { dropped: [], keepTip: null };
  const owner = chain.at(-1).thread;
  let boundary = chain.length;
  while (boundary > 0 && chain[boundary - 1].thread === owner) boundary -= 1;
  return {
    dropped: chain.slice(boundary),
    keepTip: boundary > 0 ? chain[boundary - 1].sha : null,
  };
}

export function evaluate({
  queueHead,
  ciRuns,
  checkRuns,
  mainTip,
  candidateContainsMain,
  jobs = [],
}) {
  if (!queueHead) return { action: 'reject', reason: 'queue/main does not exist' };
  if (!candidateContainsMain) return { action: 'reject', reason: 'stale' };
  const run = ciRuns.find((r) => r.head_sha === queueHead && r.head_branch.startsWith('queue/'));
  if (run?.status !== 'completed')
    return { action: 'wait', reason: run ? `run ${run.status}` : 'no ci run yet' };
  if (run.conclusion === 'failure') {
    const failedJobs = jobs
      .filter((job) => FAILED_JOB_CONCLUSIONS.includes(job.conclusion))
      .map((job) => job.name);
    if (failedJobs.length === 0) return { action: 'reject', reason: 'ci failure' };
    return {
      action: (run.run_attempt ?? 1) > 1 ? 'drop' : 'retry',
      reason: `ci failure in ${failedJobs.join(', ')}`,
      sha: queueHead,
      runId: run.id,
      runUrl: run.html_url,
      failedJobs,
    };
  }
  if (run.conclusion !== 'success') return { action: 'reject', reason: `ci ${run.conclusion}` };
  const byName = new Map(
    checkRuns
      .toSorted(
        (a, b) =>
          (Date.parse(a.completed_at ?? a.started_at) || 0) -
            (Date.parse(b.completed_at ?? b.started_at) || 0) || (a.id ?? 0) - (b.id ?? 0),
      )
      .map((c) => [c.name, c.conclusion]),
  );
  const missing = REQUIRED_CHECKS.filter(
    (name) => !['success', 'skipped'].includes(byName.get(name) ?? ''),
  );
  if (missing.length > 0)
    return { action: 'wait', reason: `checks pending: ${missing.join(', ')}` };
  void mainTip;
  return { action: 'promote', sha: queueHead };
}

const gh = (args, options = {}) =>
  JSON.parse(
    execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    }),
  );

export function evaluateHead(repo) {
  const queueHead = gh([`repos/${repo}/git/ref/heads/queue%2Fmain`]).object.sha;
  const { workflow_runs: ciRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${queueHead}&event=push&per_page=10`,
  ]);
  const { check_runs: checkRuns } = gh([
    `repos/${repo}/commits/${queueHead}/check-runs?per_page=100`,
  ]);
  const mainTip = gh([`repos/${repo}/git/ref/heads/main`]).object.sha;
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', 'queue/main'], { stdio: 'inherit' });
  const contains =
    spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', queueHead]).status === 0;
  const failed = ciRuns.find(
    (r) => r.head_sha === queueHead && r.status === 'completed' && r.conclusion === 'failure',
  );
  const jobs = failed
    ? gh([`repos/${repo}/actions/runs/${failed.id}/jobs?filter=latest&per_page=100`]).jobs
    : [];
  return evaluate({
    queueHead,
    ciRuns,
    checkRuns,
    mainTip,
    candidateContainsMain: contains,
    jobs,
  });
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function queueCandidates(head) {
  return git(['log', '--reverse', '--format=%H%x1f%s%x1f%B%x1e', `origin/main..${head}`])
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f');
      return { sha, subject, thread: threadOf(body) };
    });
}

export function dropNotice({ verdict, dropped, keepTip }) {
  const lines = dropped.map(
    (c) =>
      `- ${c.sha.slice(0, 9)} ${c.subject} (${c.thread ? `https://ampcode.com/threads/${c.thread}` : 'no Amp-Thread-ID'})`,
  );
  const threads = [...new Set(dropped.map((c) => c.thread).filter(Boolean))];
  return [
    `queue/main candidate dropped: ci failed again after one rerun of the failed jobs (${verdict.failedJobs.join(', ')}).`,
    '',
    `Run: ${verdict.runUrl}`,
    'Dropped commits:',
    ...lines,
    keepTip
      ? `Commits below them stay queued; queue/main now points at ${keepTip.slice(0, 9)}.`
      : 'queue/main was deleted.',
    '',
    threads.length > 0
      ? `Owner thread${threads.length > 1 ? 's' : ''}: ${threads.map((t) => `https://ampcode.com/threads/${t}`).join(', ')}. Fix the failure, then push again with node scripts/ops/push-queue.mjs.`
      : 'No Amp-Thread-ID on the dropped commits; whoever pushed them should fix and push again with node scripts/ops/push-queue.mjs.',
    'This workflow cannot message Amp threads (no Amp credential in Actions), so the owner has to read this note.',
  ].join('\n');
}

export function dropCandidate(repo, verdict) {
  const dropped = planDrop(queueCandidates(verdict.sha));
  if (dropped.dropped.length === 0) {
    console.log('[promote-queue] nothing to drop: queue head is already on main');
    return;
  }
  const notice = dropNotice({ verdict, ...dropped });
  console.log(`::error title=queue/main candidate dropped::${notice.split('\n')[0]}`);
  console.log(notice);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${notice}\n`);
  try {
    gh(
      ['--method', 'POST', `repos/${repo}/commits/${verdict.sha}/comments`, '-f', `body=${notice}`],
      {
        env: { ...process.env, GH_TOKEN: process.env.QUEUE_WRITE_TOKEN ?? process.env.GH_TOKEN },
      },
    );
  } catch (error) {
    console.log(`::warning::could not comment on ${verdict.sha}: ${error.message.split('\n')[0]}`);
  }
  const target = dropped.keepTip ? `${dropped.keepTip}:${QUEUE_REF}` : `:${QUEUE_REF}`;
  const push = spawnSync(
    'git',
    ['push', `--force-with-lease=${QUEUE_REF}:${verdict.sha}`, 'origin', target],
    { stdio: 'inherit' },
  );
  console.log(
    push.status === 0
      ? `[promote-queue] dropped ${dropped.dropped.length} commit(s) from queue/main`
      : '[promote-queue] queue/main moved while dropping; left it alone',
  );
}

const sleep = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, seconds * 1000);

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const wait = process.argv.includes('--wait');
  const enforce = process.argv.includes('--enforce');
  let deadline = Date.now() + WAIT_SECONDS * 1000;
  const retried = new Set();
  for (;;) {
    const verdict = evaluateHead(repo);
    console.log(`[promote-queue] ${verdict.action}: ${verdict.reason ?? verdict.sha}`);
    if (verdict.action === 'promote') {
      execFileSync('git', ['push', 'origin', `${verdict.sha}:refs/heads/main`], {
        stdio: 'inherit',
      });
      console.log(`[promote-queue] promoted ${verdict.sha} to main`);
      process.exit(0);
    }
    if (enforce && verdict.action === 'drop') {
      dropCandidate(repo, verdict);
      process.exit(0);
    }
    if (enforce && verdict.action === 'retry' && !retried.has(verdict.runId)) {
      retried.add(verdict.runId);
      execFileSync(
        'gh',
        [
          'api',
          '--method',
          'POST',
          `repos/${repo}/actions/runs/${verdict.runId}/rerun-failed-jobs`,
        ],
        { stdio: 'inherit' },
      );
      console.log(`[promote-queue] reran the failed jobs of ${verdict.runUrl} once`);
      deadline = Math.max(deadline, Date.now() + RERUN_WAIT_SECONDS * 1000);
    }
    const pending = verdict.action === 'wait' || verdict.action === 'retry';
    if (!pending || !wait || Date.now() > deadline) {
      process.exit(pending ? 2 : 1);
    }
    sleep(POLL_SECONDS);
  }
}
