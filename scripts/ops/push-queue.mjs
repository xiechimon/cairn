#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { busyMessage, RELEASE_MARKER } from './guard-queue.mjs';
import { ownerOf } from './promote-queue.mjs';

export function planPush({ live, queueHead }) {
  if (!live) return { action: 'push' };
  return { action: 'wait', sha: live, restoring: queueHead === null };
}

export function laneName(host, worktree) {
  return `${host}/${worktree}`.replace(/[^A-Za-z0-9._/-]/g, '-');
}

export const GREEN_CONTEXTS = ['check', 'pack-smoke', 'e2e-gate'];

export function missingGreenContexts(checkRuns) {
  const green = new Set(
    checkRuns
      .filter((run) => ['success', 'skipped'].includes(run.conclusion))
      .map((run) => run.name),
  );
  return GREEN_CONTEXTS.filter((name) => !green.has(name));
}

export function preflightEvidence({ shas, pushedTree, treeOf, checkRunsOf }) {
  for (const sha of shas) {
    if (treeOf(sha) !== pushedTree) continue;
    const runs = checkRunsOf(sha) ?? [];
    if (missingGreenContexts(runs).length === 0) return { ok: true, sha };
  }
  return { ok: false };
}

export const RED_CONCLUSIONS = ['failure', 'timed_out', 'cancelled'];

export function failedGreenContexts(checkRuns) {
  const byName = new Map(checkRuns.map((run) => [run.name, run.conclusion]));
  return GREEN_CONTEXTS.filter((name) => RED_CONCLUSIONS.includes(byName.get(name) ?? ''));
}

export function nextWaitAction({
  live,
  headOnLive,
  deadBase,
  headTree,
  armedTree,
  evidence,
  failed,
}) {
  if (live) {
    if (!headOnLive) return { action: 'rebase', onto: live };
    if (headTree !== armedTree) return { action: 'preflight' };
    if (failed.length > 0) return { action: 'fail', contexts: failed };
    return { action: 'poll' };
  }
  if (deadBase) return { action: 'rebase', onto: 'origin/main' };
  if (failed.length > 0) return { action: 'fail', contexts: failed };
  if (!evidence.ok) {
    if (headTree !== armedTree) return { action: 'preflight' };
    return { action: 'poll' };
  }
  return { action: 'push' };
}

export function unownedCommits(commits) {
  return commits.filter((commit) => ownerOf(commit.body) === null).map((commit) => commit.sha);
}

export function stampCommand(lane) {
  return `git log -1 --format=%B | grep -Eq '^(Amp-Thread-ID|Lane):' || git commit -q --amend --allow-empty --no-edit --trailer 'Lane: ${lane}'`;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const remoteSha = (ref) => git(['ls-remote', 'origin', ref]).split(/\s+/)[0] || null;
  const wait = process.argv.includes('--wait');
  const POLL_SECONDS = Number(process.env.PUSH_QUEUE_POLL_SECONDS ?? 60);
  const waitMinutes = Number(process.env.PUSH_QUEUE_WAIT_MINUTES ?? 120);
  const deadline = Date.now() + waitMinutes * 60_000;

  const released = (sha) => {
    try {
      return JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/commits/${sha}/comments?per_page=100`], {
          encoding: 'utf8',
        }),
      ).some((entry) => entry.body.startsWith(RELEASE_MARKER));
    } catch {
      return false;
    }
  };
  const ancestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0;
  const findLive = () => {
    const queueHead = remoteSha('refs/heads/queue/main');
    const stateHead = remoteSha('refs/heads/queue-state/main');
    const candidates = [...new Set([queueHead, stateHead].filter(Boolean))];
    spawnSync('git', ['fetch', '--quiet', 'origin', 'main', ...candidates], { stdio: 'inherit' });
    const live = candidates.find((sha) => !ancestor(sha, 'origin/main') && !released(sha)) ?? null;
    return { queueHead, live };
  };
  const treeOf = (sha) => git(['rev-parse', `${sha}^{tree}`]);
  const checkRunsOf = (sha) => {
    try {
      return JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`], {
          encoding: 'utf8',
        }),
      ).check_runs;
    } catch (error) {
      if (/No commit found|HTTP (404|422)/.test(error.message)) return null;
      throw error;
    }
  };
  const sleep = (seconds) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

  const { queueHead, live } = findLive();
  const plan = planPush({ live, queueHead });
  if (plan.action === 'wait' && !wait) {
    const [subject, body] = git(['log', '-1', '--format=%s%x1f%B', plan.sha]).split('\x1f');
    let run;
    try {
      const { workflow_runs: runs } = JSON.parse(
        execFileSync(
          'gh',
          ['api', `repos/${repo}/actions/runs?head_sha=${plan.sha}&event=push&per_page=30`],
          { encoding: 'utf8' },
        ),
      );
      run = runs.find((candidate) => candidate.name === 'ci');
    } catch {
      run = undefined;
    }
    const restoring = plan.restoring
      ? '\nqueue/main is missing because someone deleted it; the guard is putting the candidate back.'
      : '';
    console.error(
      `[push-queue] not pushed.\n${busyMessage({ sha: plan.sha, subject, body, run })}${restoring}`,
    );
    process.exit(1);
  }

  if (wait) {
    let armedTree = null;
    let lastBase = null;
    for (;;) {
      const { live: current } = findLive();
      const head = git(['rev-parse', 'HEAD']);
      const headTree = treeOf(head);
      const headOnLive = current !== null && ancestor(current, 'HEAD');
      const deadBase = current === null && lastBase !== null && !ancestor(lastBase, 'origin/main');
      const runs = checkRunsOf(head) ?? [];
      const step = nextWaitAction({
        live: current,
        headOnLive,
        deadBase,
        headTree,
        armedTree,
        evidence: preflightEvidence({
          shas: [head],
          pushedTree: headTree,
          treeOf,
          checkRunsOf,
        }),
        failed: failedGreenContexts(runs),
      });
      if (step.action === 'push') break;
      if (step.action === 'fail') {
        console.error(
          `[push-queue] not pushed: the preflight run for ${head.slice(0, 9)} went red in ${step.contexts.join(', ')}. Rerun its failed jobs or fix and push again.`,
        );
        process.exit(1);
      }
      if (step.action === 'rebase') {
        const upstream = lastBase ?? 'origin/main';
        console.log(`[push-queue] rebasing ${upstream}..HEAD onto ${step.onto.slice(0, 9)}`);
        const rebase = spawnSync('git', ['rebase', '--onto', step.onto, upstream], {
          stdio: 'inherit',
        });
        if (rebase.status !== 0) {
          spawnSync('git', ['rebase', '--abort'], { stdio: 'inherit' });
          console.error(
            `[push-queue] not pushed: the rebase onto ${step.onto.slice(0, 9)} hit a conflict; resolve it and run again.`,
          );
          process.exit(1);
        }
        lastBase = step.onto === 'origin/main' ? null : step.onto;
        continue;
      }
      if (step.action === 'preflight') {
        const pushed = spawnSync(process.execPath, [join(import.meta.dirname, 'preflight.mjs')], {
          stdio: 'inherit',
        });
        if (pushed.status !== 0) {
          console.error('[push-queue] could not push the preflight ref; fix that and run again.');
          process.exit(1);
        }
        armedTree = headTree;
        continue;
      }
      if (Date.now() > deadline) {
        console.error(
          `[push-queue] still waiting on ${current?.slice(0, 9) ?? 'green evidence'} after ${waitMinutes} minutes; rerun to keep waiting.`,
        );
        process.exit(2);
      }
      sleep(POLL_SECONDS);
    }
  }

  const preStampSha = git(['rev-parse', 'HEAD']);
  const commits = git(['log', '--reverse', '--format=%H%x1f%B%x1e', 'origin/main..HEAD'])
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, body] = entry.split('\x1f');
      return { sha, body };
    });
  if (unownedCommits(commits).length > 0) {
    const lane = laneName(hostname(), basename(git(['rev-parse', '--show-toplevel'])));
    console.log(`[push-queue] stamping the commits that have no owner trailer with Lane: ${lane}`);
    const stamp = spawnSync('git', ['rebase', '--exec', stampCommand(lane), 'origin/main'], {
      stdio: 'inherit',
    });
    if (stamp.status !== 0) {
      spawnSync('git', ['rebase', '--abort'], { stdio: 'inherit' });
      console.error(
        '[push-queue] could not stamp the owner trailer (a dirty tree or a conflict); fix that and run it again. Nothing was pushed.',
      );
      process.exit(1);
    }
  }
  const english = spawnSync(
    process.execPath,
    [join(import.meta.dirname, '..', 'english-only-gate.mjs')],
    { stdio: 'inherit' },
  );
  if (english.status !== 0) {
    console.error(
      '[push-queue] a commit message or added line has Chinese text, which fails ci; reword it and run again. Nothing was pushed.',
    );
    process.exit(1);
  }
  const pushedSha = git(['rev-parse', 'HEAD']);
  let evidence;
  try {
    evidence = preflightEvidence({
      shas: [...new Set([pushedSha, preStampSha])],
      pushedTree: git(['rev-parse', 'HEAD^{tree}']),
      treeOf,
      checkRunsOf,
    });
  } catch (error) {
    console.error(
      `[push-queue] not pushed: the check-runs lookup failed (${error.message}); retry when the GitHub API answers.`,
    );
    process.exit(1);
  }
  if (!evidence.ok) {
    console.error(
      `[push-queue] not pushed: ${pushedSha.slice(0, 9)} has no green ci evidence for ${GREEN_CONTEXTS.join(' + ')}.\n` +
        'Run node scripts/ops/preflight.mjs --wait — it pushes HEAD to refs/heads/preflight/<lane> and waits for the ci run.\n' +
        'A green run on a commit with the same tree also counts; local pnpm prepush stays optional.',
    );
    process.exit(1);
  }
  const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/queue/main'], {
    stdio: 'inherit',
  });
  process.exit(push.status ?? 1);
}
