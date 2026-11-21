#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export const QUEUE_REF = process.env.PROMOTE_QUEUE_REF ?? 'refs/heads/queue/main';
export const REQUIRED_CHECKS = ['check', 'pack-smoke', 'e2e-gate'];
const POLL_SECONDS = 30;
const WAIT_SECONDS = Number(process.env.PROMOTE_WAIT_SECONDS ?? 40 * 60);
const RERUN_WAIT_SECONDS = Number(process.env.PROMOTE_RERUN_WAIT_SECONDS ?? 25 * 60);
const FAILED_JOB_CONCLUSIONS = ['failure', 'timed_out'];

const OWNER_TRAILER = /^(Amp-Thread-ID|Lane):[ \t]*(.+?)[ \t]*$/gim;

export function ownerOf(message) {
  const last = [...message.matchAll(OWNER_TRAILER)].at(-1);
  if (!last) return null;
  if (last[1].toLowerCase() === 'amp-thread-id') {
    const id = /T-[0-9a-f-]+/.exec(last[2])?.[0];
    return id ? { key: `amp:${id}`, label: `https://ampcode.com/threads/${id}` } : null;
  }
  return { key: `lane:${last[2]}`, label: `lane ${last[2]}` };
}

export function planDrop(chain) {
  if (chain.length === 0) return { dropped: [], keepTip: null };
  const owner = chain.at(-1).owner?.key ?? null;
  let boundary = chain.length;
  while (boundary > 0 && (chain[boundary - 1].owner?.key ?? null) === owner) boundary -= 1;
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
  if (!queueHead) return { action: 'idle', reason: 'queue/main does not exist' };
  if (!candidateContainsMain) {
    return {
      action: 'drop',
      reason: 'stale',
      sha: queueHead,
      dropReason: 'it does not contain main, which moved past it',
    };
  }
  const run = ciRuns.find(
    (r) => r.name === 'ci' && r.head_sha === queueHead && r.head_branch.startsWith('queue/'),
  );
  if (run?.status !== 'completed')
    return { action: 'wait', reason: run ? `run ${run.status}` : 'no ci run yet' };
  if (run.conclusion !== 'success') {
    const failedJobs = jobs
      .filter((job) => FAILED_JOB_CONCLUSIONS.includes(job.conclusion))
      .map((job) => job.name);
    const realFailure = failedJobs.length > 0;
    const again = (run.run_attempt ?? 1) > 1;
    const what = realFailure ? `ci failure in ${failedJobs.join(', ')}` : `ci ${run.conclusion}`;
    return {
      action: again ? 'drop' : 'retry',
      reason: what,
      sha: queueHead,
      runId: run.id,
      runUrl: run.html_url,
      rerun: realFailure ? 'rerun-failed-jobs' : 'rerun',
      dropReason: realFailure
        ? `ci failed again after one rerun of the failed jobs (${failedJobs.join(', ')})`
        : `ci ended ${run.conclusion} again after one rerun`,
    };
  }
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

const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;

export function closingTargets(commits) {
  const targets = new Map();
  for (const commit of commits) {
    for (const match of (commit.body ?? '').matchAll(CLOSING_KEYWORD)) {
      const issue = Number(match[1]);
      targets.set(issue, [...(targets.get(issue) ?? []), commit]);
    }
  }
  return targets;
}

export function landedCommits(before, after) {
  return git(['log', '--reverse', '--format=%H%x1f%s%x1f%B%x1e', `${before}..${after}`])
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split('\x1f');
      return { sha, subject, body };
    });
}

export function closingComment(commits) {
  const lines = commits.map((c) => `- ${c.sha.slice(0, 9)} ${c.subject}`);
  return [`Closed by ${commits.length === 1 ? 'commit' : 'commits'}:`, ...lines].join('\n');
}

export function closeLandedIssues({ commits, getIssue, postComment, closeIssue, warn }) {
  const closed = [];
  for (const [issue, naming] of closingTargets(commits)) {
    try {
      const info = getIssue(issue);
      if (!info || info.state !== 'open') continue;
    } catch (error) {
      warn(`issue #${issue}: ${String(error.message ?? error).split('\n')[0]}`);
      continue;
    }
    try {
      postComment(issue, closingComment(naming));
    } catch (error) {
      warn(`issue #${issue} comment: ${String(error.message ?? error).split('\n')[0]}`);
    }
    try {
      closeIssue(issue);
      closed.push(issue);
    } catch (error) {
      warn(`issue #${issue} close: ${String(error.message ?? error).split('\n')[0]}`);
    }
  }
  return closed;
}

export function evaluateHead(repo) {
  let queueHead;
  try {
    queueHead = gh([`repos/${repo}/git/ref/heads/queue%2Fmain`], { stdio: 'pipe' }).object.sha;
  } catch (error) {
    if (!/HTTP 404/.test(String(error.stderr ?? error.message))) throw error;
    return evaluate({ queueHead: null, ciRuns: [], checkRuns: [] });
  }
  const { workflow_runs: ciRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${queueHead}&event=push&per_page=30`,
  ]);
  const { check_runs: checkRuns } = gh([
    `repos/${repo}/commits/${queueHead}/check-runs?per_page=100`,
  ]);
  const mainTip = gh([`repos/${repo}/git/ref/heads/main`]).object.sha;
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', 'queue/main'], { stdio: 'inherit' });
  const contains =
    spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', queueHead]).status === 0;
  const failed = ciRuns.find(
    (r) =>
      r.name === 'ci' &&
      r.head_sha === queueHead &&
      r.status === 'completed' &&
      r.conclusion === 'failure',
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
      return { sha, subject, owner: ownerOf(body) };
    });
}

export function dropNotice({ verdict, dropped, keepTip }) {
  const lines = dropped.map(
    (c) => `- ${c.sha.slice(0, 9)} ${c.subject} (${c.owner?.label ?? 'no owner trailer'})`,
  );
  const owners = [...new Set(dropped.map((c) => c.owner?.label).filter(Boolean))];
  return [
    `queue/main candidate dropped: ${verdict.dropReason}.`,
    '',
    verdict.runUrl ? `Run: ${verdict.runUrl}` : null,
    'Dropped commits:',
    ...lines,
    keepTip
      ? `Commits below them stay queued; queue/main now points at ${keepTip.slice(0, 9)}.`
      : 'queue/main was deleted.',
    '',
    owners.length > 0
      ? `Owner${owners.length > 1 ? 's' : ''}: ${owners.join(', ')}. Fix the cause, then push again with node scripts/ops/push-queue.mjs.`
      : 'No Amp-Thread-ID or Lane trailer on the dropped commits; whoever pushed them should fix and push again with node scripts/ops/push-queue.mjs.',
    'This workflow cannot message Amp threads, Claude Code sessions or Cairn tasks (no credential in Actions), so the owner has to read this note.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function dropCandidate(repo, verdict) {
  const dropped = planDrop(queueCandidates(verdict.sha));
  if (dropped.dropped.length === 0) {
    console.log('[promote-queue] nothing to drop: queue head is already on main');
    return;
  }
  const target = dropped.keepTip ? `${dropped.keepTip}:${QUEUE_REF}` : `:${QUEUE_REF}`;
  const push = spawnSync(
    'git',
    ['push', `--force-with-lease=${QUEUE_REF}:${verdict.sha}`, 'origin', target],
    { stdio: 'inherit' },
  );
  if (push.status !== 0) {
    console.log('[promote-queue] queue/main moved while dropping; left it alone');
    return;
  }
  const notice = dropNotice({ verdict, ...dropped });
  console.log(`::error title=queue/main candidate dropped::${notice.split('\n')[0]}`);
  console.log(notice);
  console.log(`[promote-queue] dropped ${dropped.dropped.length} commit(s) from queue/main`);
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
}

const sleep = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const wait = process.argv.includes('--wait');
  const enforce = process.argv.includes('--enforce');
  let deadline = Date.now() + WAIT_SECONDS * 1000;
  const retried = new Set();
  for (;;) {
    const verdict = evaluateHead(repo);
    console.log(`[promote-queue] ${verdict.action}: ${verdict.reason ?? verdict.sha}`);
    if (verdict.action === 'idle') process.exit(0);
    if (verdict.action === 'promote') {
      let before = 'origin/main';
      try {
        before = git(['rev-parse', 'origin/main']);
      } catch {
        console.log('::warning::could not resolve origin/main; issue closing range may be empty');
      }
      execFileSync('git', ['push', 'origin', `${verdict.sha}:refs/heads/main`], {
        stdio: 'inherit',
      });
      console.log(`[promote-queue] promoted ${verdict.sha} to main`);
      try {
        const ghWrite = (args) => {
          const tokens = new Set([process.env.QUEUE_WRITE_TOKEN, process.env.GH_TOKEN, undefined]);
          let last;
          for (const token of tokens) {
            try {
              return gh(args, token ? { env: { ...process.env, GH_TOKEN: token } } : undefined);
            } catch (error) {
              last = error;
            }
          }
          throw last;
        };
        const closed = closeLandedIssues({
          commits: landedCommits(before, verdict.sha),
          getIssue: (n) => ghWrite([`repos/${repo}/issues/${n}`]),
          postComment: (n, body) =>
            ghWrite([
              '--method',
              'POST',
              `repos/${repo}/issues/${n}/comments`,
              '-f',
              `body=${body}`,
            ]),
          closeIssue: (n) =>
            ghWrite(['--method', 'PATCH', `repos/${repo}/issues/${n}`, '-f', 'state=closed']),
          warn: (message) => console.log(`::warning::${message}`),
        });
        if (closed.length > 0)
          console.log(`[promote-queue] closed ${closed.map((n) => `#${n}`).join(', ')}`);
      } catch (error) {
        console.log(
          `::warning::issue closing after landing failed: ${String(error.message ?? error).split('\n')[0]}`,
        );
      }
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
        ['api', '--method', 'POST', `repos/${repo}/actions/runs/${verdict.runId}/${verdict.rerun}`],
        { stdio: 'inherit' },
      );
      console.log(`[promote-queue] ${verdict.rerun} ${verdict.runUrl} once`);
      deadline = Math.max(deadline, Date.now() + RERUN_WAIT_SECONDS * 1000);
    }
    const pending = verdict.action === 'wait' || verdict.action === 'retry';
    if (!pending || !wait || Date.now() > deadline) {
      process.exit(pending ? 2 : 1);
    }
    sleep(POLL_SECONDS);
  }
}
