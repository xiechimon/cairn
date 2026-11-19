#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { ownerOf } from './promote-queue.mjs';

const ZERO = /^0+$/;
const QUEUE_REF = process.env.GUARD_QUEUE_REF ?? 'refs/heads/queue/main';
const STATE_REF = process.env.GUARD_STATE_REF ?? 'refs/heads/queue-state/main';
const RUN_LOOKUP_ATTEMPTS = 6;
const RUN_LOOKUP_SECONDS = 10;

export const RELEASE_MARKER = 'queue/main release:';
export const PROMOTER = 'cairn-release[bot]';

export function judgeChange({ event, actor, before, after, live, afterContainsLive }) {
  if (actor === PROMOTER || !live) return { action: 'allow' };
  if (event === 'delete') return { action: 'restore', sha: live };
  if (after === live) return { action: 'allow' };
  if (ZERO.test(before)) return { action: 'refuse', sha: live, kind: 'recreated' };
  return { action: 'refuse', sha: live, kind: afterContainsLive ? 'stacked' : 'replaced' };
}

export function busyMessage({ sha, subject, body, run }) {
  const owner = ownerOf(body ?? '');
  const state = run
    ? run.status === 'completed'
      ? `ci ${run.conclusion}${run.run_attempt > 1 ? ' after a rerun' : ''}`
      : `ci ${run.status}`
    : 'ci not started';
  return [
    `queue/main holds one candidate at a time and ${sha.slice(0, 9)} (${subject}) is still ahead of main: ${state}.`,
    run ? `Run: ${run.html_url}` : null,
    owner ? `Owner: ${owner.label}.` : 'Owner: no Amp-Thread-ID or Lane trailer on the commit.',
    'Push again once it lands on main or is dropped. A candidate whose ci fails (one rerun of the failed jobs first) or that goes stale is dropped automatically; never delete queue/main yourself, the guard puts the candidate back.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function refusalNotice({ kind, sha, after, actor }) {
  const short = (value) => value.slice(0, 9);
  const reasons = {
    stacked: `${short(after)} was pushed on top of a candidate that has not landed, so queue/main was put back to ${short(sha)}.`,
    replaced: `${short(after)} replaced a candidate that has not landed (${short(sha)}), so queue/main was put back to ${short(sha)}.`,
    recreated: `${short(after)} was pushed to an empty queue/main right after ${short(sha)} was deleted by ${actor} before it landed, so queue/main was put back to ${short(sha)}.`,
  };
  return `Refused: ${reasons[kind]}`;
}

export function restoreNotice({ sha, actor }) {
  return `queue/main was deleted by ${actor} while its candidate ${sha.slice(0, 9)} had not landed, so the candidate was put back. Nobody deletes queue/main: a candidate leaves it by landing or by the promote workflow dropping it. A human operator who must clear a live candidate comments "${RELEASE_MARKER} <reason>" on that commit first.`;
}

const gh = (args) => {
  const output = execFileSync('gh', ['api', ...args], { encoding: 'utf8' });
  return output.trim() ? JSON.parse(output) : null;
};
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sleep = (seconds) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'xiechimon/cairn';
  const {
    GUARD_EVENT: event,
    GUARD_ACTOR: actor,
    BEFORE: before = '',
    AFTER: after = '',
  } = process.env;
  const apiRef = (ref) => ref.replace(/^refs\//, '');

  const refSha = (ref) => {
    const result = spawnSync('gh', ['api', `repos/${repo}/git/ref/${apiRef(ref)}`], {
      encoding: 'utf8',
    });
    if (result.status === 0) return JSON.parse(result.stdout).object.sha;
    if (/HTTP 404/.test(result.stderr)) return null;
    throw new Error(result.stderr);
  };
  const setRef = (ref, sha) => {
    if (refSha(ref) === null) {
      gh(['--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=${ref}`, '-f', `sha=${sha}`]);
    } else {
      gh(['--method', 'PATCH', `repos/${repo}/git/${ref}`, '-f', `sha=${sha}`, '-F', 'force=true']);
    }
  };
  const comment = (sha, body) =>
    gh(['--method', 'POST', `repos/${repo}/commits/${sha}/comments`, '-f', `body=${body}`]);

  spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
  const state = refSha(STATE_REF);
  const candidates = [
    ...new Set([event === 'push' && !ZERO.test(before) ? before : null, state].filter(Boolean)),
  ];
  for (const sha of [...candidates, after].filter((sha) => sha && !ZERO.test(sha))) {
    spawnSync('git', ['fetch', '--quiet', 'origin', sha]);
  }
  const isAncestor = (older, newer) =>
    spawnSync('git', ['merge-base', '--is-ancestor', older, newer]).status === 0;
  const released = (sha) =>
    gh([`repos/${repo}/commits/${sha}/comments?per_page=100`]).some((entry) =>
      entry.body.startsWith(RELEASE_MARKER),
    );
  const live = candidates.find((sha) => !isAncestor(sha, 'origin/main') && !released(sha)) ?? null;

  const verdict = judgeChange({
    event,
    actor,
    before,
    after,
    live,
    afterContainsLive: live !== null && !ZERO.test(after) && isAncestor(live, after),
  });
  console.log(
    `[guard-queue] ${verdict.action} ${event} by ${actor}: ${before.slice(0, 9)} -> ${after.slice(0, 9)}; live candidate ${live?.slice(0, 9) ?? 'none'}`,
  );

  if (verdict.action === 'allow') {
    if (event === 'push' && state !== after) setRef(STATE_REF, after);
    if (event === 'delete' && state !== null) {
      spawnSync('gh', ['api', '--method', 'DELETE', `repos/${repo}/git/${STATE_REF}`], {
        stdio: 'inherit',
      });
    }
    process.exit(0);
  }

  const [subject, body] = git(['log', '-1', '--format=%s%x1f%B', live]).split('\x1f');
  const { workflow_runs: liveRuns } = gh([
    `repos/${repo}/actions/runs?head_sha=${live}&event=push&per_page=30`,
  ]);
  const liveRun = liveRuns.find((run) => run.name === 'ci');
  const message = busyMessage({ sha: live, subject, body, run: liveRun });
  let notice;
  if (verdict.action === 'restore') {
    notice = [restoreNotice({ sha: live, actor }), message].join('\n\n');
    console.log(`::error title=queue/main deletion undone::${notice.split('\n')[0]}`);
    console.log(notice);
    setRef(QUEUE_REF, live);
    comment(live, notice);
  } else {
    notice = [refusalNotice({ kind: verdict.kind, sha: live, after, actor }), message].join('\n\n');
    console.log(`::error title=queue/main push refused::${notice.split('\n')[0]}`);
    console.log(notice);
    setRef(QUEUE_REF, live);
    comment(after, notice);
  }

  if (liveRun?.status === 'completed') {
    spawnSync(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${repo}/actions/workflows/promote.yml/dispatches`,
        '-f',
        'ref=main',
      ],
      { stdio: 'inherit' },
    );
  }

  if (verdict.action === 'refuse') {
    for (let attempt = 0; attempt < RUN_LOOKUP_ATTEMPTS; attempt += 1) {
      const { workflow_runs: refusedRuns } = gh([
        `repos/${repo}/actions/runs?head_sha=${after}&event=push&per_page=30`,
      ]);
      const open = refusedRuns.filter((run) => run.name === 'ci' && run.status !== 'completed');
      for (const run of open) {
        gh(['--method', 'POST', `repos/${repo}/actions/runs/${run.id}/cancel`]);
      }
      if (open.length > 0) break;
      sleep(RUN_LOOKUP_SECONDS);
    }
  }
  process.exit(1);
}
