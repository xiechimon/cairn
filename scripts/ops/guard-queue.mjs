#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { threadOf } from './promote-queue.mjs';

const ZERO = /^0+$/;
const QUEUE_REF = 'refs/heads/queue/main';
const RUN_LOOKUP_ATTEMPTS = 6;
const RUN_LOOKUP_SECONDS = 10;

export function judgePush({ before, after, beforeLanded, afterContainsBefore }) {
  if (ZERO.test(after) || ZERO.test(before)) return { action: 'allow' };
  if (beforeLanded) return { action: 'allow' };
  if (!afterContainsBefore) return { action: 'allow' };
  return { action: 'refuse' };
}

export function busyMessage({ sha, subject, body, run }) {
  const thread = threadOf(body ?? '');
  const state = run
    ? run.status === 'completed'
      ? `ci ${run.conclusion}${run.run_attempt > 1 ? ' after a rerun' : ''}`
      : `ci ${run.status}`
    : 'ci not started';
  return [
    `queue/main holds one candidate at a time and ${sha.slice(0, 9)} (${subject}) is still ahead of main: ${state}.`,
    run ? `Run: ${run.html_url}` : null,
    thread
      ? `Owner: https://ampcode.com/threads/${thread}.`
      : 'Owner: no Amp-Thread-ID on the commit.',
    'Push again once it lands on main or is dropped; a candidate whose ci fails twice (one rerun of the failed jobs) is dropped automatically.',
  ]
    .filter(Boolean)
    .join('\n');
}

const gh = (args) => JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }));
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sleep = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, seconds * 1000);

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const { BEFORE: before, AFTER: after } = process.env;
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', after], { stdio: 'inherit' });
  if (!ZERO.test(before)) spawnSync('git', ['fetch', '--quiet', 'origin', before]);
  const isAncestor = (older, newer) =>
    spawnSync('git', ['merge-base', '--is-ancestor', older, newer]).status === 0;
  const verdict = judgePush({
    before,
    after,
    beforeLanded: !ZERO.test(before) && isAncestor(before, 'origin/main'),
    afterContainsBefore: !ZERO.test(before) && isAncestor(before, after),
  });
  console.log(`[guard-queue] ${verdict.action}: ${before.slice(0, 9)} -> ${after.slice(0, 9)}`);
  if (verdict.action === 'allow') process.exit(0);

  const [subject, body] = git(['log', '-1', '--format=%s%x1f%B', before]).split('\x1f');
  const { workflow_runs: heldRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${before}&event=push&per_page=5`,
  ]);
  const message = busyMessage({ sha: before, subject, body, run: heldRuns[0] });
  const notice = [
    `Refused: ${after.slice(0, 9)} was pushed on top of a candidate that has not landed, so queue/main was put back to ${before.slice(0, 9)}.`,
    message,
  ].join('\n\n');
  console.log(`::error title=queue/main push refused::${message.split('\n')[0]}`);
  console.log(notice);

  gh([
    '--method',
    'PATCH',
    `repos/${repo}/git/${QUEUE_REF}`,
    '-f',
    `sha=${before}`,
    '-F',
    'force=true',
  ]);
  gh(['--method', 'POST', `repos/${repo}/commits/${after}/comments`, '-f', `body=${notice}`]);

  for (let attempt = 0; attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
    const { workflow_runs: refusedRuns } = gh([
      `repos/${repo}/actions/runs?head_sha=${after}&event=push&per_page=5`,
    ]);
    const live = refusedRuns.filter((run) => run.status !== 'completed');
    for (const run of live) gh(['--method', 'POST', `repos/${repo}/actions/runs/${run.id}/cancel`]);
    if (live.length > 0) break;
    sleep(RUN_LOOKUP_SECONDS);
  }
  process.exit(1);
}
