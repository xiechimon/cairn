#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { RELEASE_MARKER } from './guard-queue.mjs';
import { closeIssuesAfterLanding, landingState, ownerOf, pushToMain } from './promote-queue.mjs';
import { ENQUEUE_PREFIX, makeEnqueueId, sortEnqueueEntries } from './speculative-queue.mjs';

export const DEFAULT_POLL_SECONDS = 15;

export function planPush({ live, queueHead }) {
  if (!live) return { action: 'push' };
  return { action: 'wait', sha: live, restoring: queueHead === null };
}

export function planEnqueueOrLand({
  activeEnqueueCount,
  hasLegacyLive = false,
  pushedSha,
  evidenceSha,
  containsMain,
}) {
  if (!hasLegacyLive && activeEnqueueCount === 0 && containsMain && evidenceSha === pushedSha) {
    return { action: 'fast-forward-main', sha: pushedSha };
  }
  return { action: 'enqueue', sha: pushedSha };
}

export function classifyWaitStatus({
  stillQueued,
  onMain,
  cherryHasUnapplied,
  ejectedByComment = false,
  mainMoved = false,
}) {
  if (onMain || cherryHasUnapplied === false) return { state: 'landed' };
  if (stillQueued) return { state: 'queued' };
  if (ejectedByComment) return { state: 'ejected' };
  if (mainMoved) return { state: 'landed' };
  return { state: 'ejected' };
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

export function fetchCheckRuns({ repo, sha, gh }) {
  try {
    return gh([
      'api',
      '--paginate',
      '--slurp',
      `repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    ]).flatMap((page) => page?.check_runs ?? []);
  } catch (error) {
    if (/No commit found|HTTP (404|422)/.test(error.message)) return null;
    throw error;
  }
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
  headOnMain,
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
  if (deadBase || headOnMain === false) return { action: 'rebase', onto: 'origin/main' };
  if (failed.length > 0) return { action: 'fail', contexts: failed };
  if (!evidence.ok) {
    if (headTree !== armedTree) return { action: 'preflight' };
    return { action: 'poll' };
  }
  return { action: 'push' };
}

export function landingTarget({ pushedSha, evidenceSha, containsMain }) {
  if (!containsMain) return { action: 'reject-stale' };
  if (evidenceSha === pushedSha) return { action: 'fast-forward-main', sha: pushedSha };
  return { action: 'queue', sha: pushedSha };
}

export function unownedCommits(commits) {
  return commits.filter((commit) => ownerOf(commit.body) === null).map((commit) => commit.sha);
}

export function stampCommand(lane) {
  return `git log -1 --format=%B | grep -Eq '^(Amp-Thread-ID|Lane):' || git commit -q --amend --allow-empty --no-edit --trailer 'Lane: ${lane}'`;
}

export function stampUnownedCommits({
  lane,
  upstream = 'origin/main',
  prefix = '[push-queue]',
  cwd,
} = {}) {
  const execOpts = cwd ? { encoding: 'utf8', cwd } : { encoding: 'utf8' };
  const spawnOpts = cwd ? { stdio: 'inherit', cwd } : { stdio: 'inherit' };
  const git = (args) => execFileSync('git', args, execOpts).trim();
  const commits = git(['log', '--reverse', '--format=%H%x1f%B%x1e', `${upstream}..HEAD`])
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, body] = entry.split('\x1f');
      return { sha, body };
    });
  if (unownedCommits(commits).length === 0) {
    return { ok: true, stamped: false, sha: git(['rev-parse', 'HEAD']) };
  }
  console.log(`${prefix} stamping the commits that have no owner trailer with Lane: ${lane}`);
  const stamp = spawnSync('git', ['rebase', '--exec', stampCommand(lane), upstream], spawnOpts);
  if (stamp.status !== 0) {
    spawnSync('git', ['rebase', '--abort'], spawnOpts);
    return { ok: false, stamped: false, sha: git(['rev-parse', 'HEAD']) };
  }
  return { ok: true, stamped: true, sha: git(['rev-parse', 'HEAD']) };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const wait = process.argv.includes('--wait');
  const enqueueOnly = process.argv.includes('--enqueue');
  const POLL_SECONDS = Number(process.env.PUSH_QUEUE_POLL_SECONDS ?? DEFAULT_POLL_SECONDS);
  const waitMinutes = Number(process.env.PUSH_QUEUE_WAIT_MINUTES ?? 120);
  const deadline = Date.now() + waitMinutes * 60_000;
  const ancestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b]).status === 0;
  const listRemoteQueue = () => {
    const out = git(['ls-remote', 'origin', `${ENQUEUE_PREFIX}*`, 'refs/heads/main']);
    const enqueueRaw = [];
    let mainSha = null;
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [sha, ref] = line.split(/\s+/);
      if (ref === 'refs/heads/main') mainSha = sha;
      else if (ref.startsWith(ENQUEUE_PREFIX)) enqueueRaw.push({ ref, sha });
    }
    return { mainSha, entries: sortEnqueueEntries(enqueueRaw), legacyLive: null };
  };
  const treeOf = (sha) => git(['rev-parse', `${sha}^{tree}`]);
  const ghJson = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  const checkRunsOf = (sha) => fetchCheckRuns({ repo, sha, gh: ghJson });
  const sleep = (seconds) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

  if (wait) {
    let armedTree = null;
    for (;;) {
      if (Date.now() > deadline) {
        console.error(
          `[push-queue] still waiting for preflight evidence after ${waitMinutes} minutes; rerun to keep waiting.`,
        );
        process.exit(2);
      }
      const head = git(['rev-parse', 'HEAD']);
      const headTree = treeOf(head);
      let runs;
      try {
        runs = checkRunsOf(head);
      } catch {
        console.error('[push-queue] could not read the check runs; retrying');
        sleep(POLL_SECONDS);
        continue;
      }
      const failed = failedGreenContexts(runs ?? []);
      if (failed.length > 0) {
        console.error(
          `[push-queue] not pushed: the preflight run for ${head.slice(0, 9)} went red in ${failed.join(', ')}. Fix the failures and push again.`,
        );
        process.exit(1);
      }
      const ev = preflightEvidence({
        shas: [head],
        pushedTree: headTree,
        treeOf,
        checkRunsOf: (sha) => {
          try {
            return checkRunsOf(sha);
          } catch {
            return null;
          }
        },
      });
      if (ev.ok) break;
      if (headTree !== armedTree) {
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
      sleep(POLL_SECONDS);
    }
  }

  const preStampSha = git(['rev-parse', 'HEAD']);
  const lane = laneName(hostname(), basename(git(['rev-parse', '--show-toplevel'])));
  const stamped = stampUnownedCommits({ lane, prefix: '[push-queue]' });
  if (!stamped.ok) {
    console.error(
      '[push-queue] could not stamp the owner trailer (a dirty tree or a conflict); fix that and run it again. Nothing was pushed.',
    );
    process.exit(1);
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
        'Run node scripts/ops/preflight.mjs --wait — it pushes HEAD to refs/heads/preflight/<lane> and waits for the ci run.',
    );
    process.exit(1);
  }

  const { entries, legacyLive } = listRemoteQueue();
  const plan = enqueueOnly
    ? { action: 'enqueue', sha: pushedSha }
    : planEnqueueOrLand({
        activeEnqueueCount: entries.length,
        hasLegacyLive: legacyLive !== null,
        pushedSha,
        evidenceSha: evidence.sha,
        containsMain: ancestor('origin/main', pushedSha),
      });

  if (plan.action === 'fast-forward-main') {
    const before = git(['rev-parse', 'origin/main']);
    const ff = spawnSync('git', ['push', 'origin', `${plan.sha}:refs/heads/main`], {
      encoding: 'utf8',
    });
    process.stdout.write(ff.stdout ?? '');
    process.stderr.write(ff.stderr ?? '');
    if (ff.status === 0) {
      console.log(
        `[push-queue] fast-forwarded main to ${plan.sha.slice(0, 9)} (empty queue, preflight-green)`,
      );
      closeIssuesAfterLanding({ repo, before, after: plan.sha, logPrefix: '[push-queue]' });
      process.exit(0);
    }
    const output = `${ff.stdout ?? ''}\n${ff.stderr ?? ''}`;
    if (/GH013/i.test(output)) {
      pushToMain({
        sha: plan.sha,
        mainTip: before,
        expectedQueueHead: null,
        push: () =>
          spawnSync('git', ['push', 'origin', `${plan.sha}:refs/heads/main`], { encoding: 'utf8' }),
        recheck: () => landingState(repo, plan.sha),
        sleep,
      });
      console.log(`[push-queue] fast-forwarded main to ${plan.sha.slice(0, 9)}`);
      closeIssuesAfterLanding({ repo, before, after: plan.sha, logPrefix: '[push-queue]' });
      process.exit(0);
    }
    console.log('[push-queue] main moved concurrently; enqueueing into speculative queue');
  }

  spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
  if (evidence.sha !== pushedSha) {
    console.error(
      `[push-queue] not pushed: ${pushedSha.slice(0, 9)} lacks exact-SHA green evidence (e.g. Lane: trailer stamped a new SHA); run node scripts/ops/preflight.mjs --wait first.`,
    );
    process.exit(1);
  }

  const refreshed = listRemoteQueue();
  const initialMainSha = refreshed.mainSha;
  const already = refreshed.entries.find((item) => item.sha === pushedSha);
  const enqueueRef = already?.ref ?? `${ENQUEUE_PREFIX}${makeEnqueueId(pushedSha)}`;
  if (!already) {
    const pushEnq = spawnSync('git', ['push', 'origin', `${pushedSha}:${enqueueRef}`], {
      stdio: 'inherit',
    });
    if (pushEnq.status !== 0) {
      console.error(`[push-queue] failed to push ${enqueueRef}`);
      process.exit(pushEnq.status ?? 1);
    }
  }
  console.log(
    `[push-queue] enqueued ${pushedSha.slice(0, 9)} -> ${enqueueRef} (queue depth ${already ? refreshed.entries.length : refreshed.entries.length + 1})`,
  );

  const dispatch = spawnSync(
    'gh',
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/actions/workflows/promote.yml/dispatches`,
      '-f',
      'ref=main',
    ],
    { encoding: 'utf8' },
  );
  if (dispatch.status !== 0) {
    console.log(
      '[push-queue] note: promote dispatch skipped (scheduled backstop will advance queue)',
    );
  }

  if (!wait) process.exit(0);

  const readRemovalComment = () => {
    try {
      const comments = ghJson([`repos/${repo}/commits/${pushedSha}/comments?per_page=20`]);
      const match = comments.findLast(
        (comment) =>
          comment.body.startsWith('Removed from merge queue:') ||
          comment.body.startsWith(RELEASE_MARKER),
      );
      return match?.body ?? null;
    } catch {
      return null;
    }
  };

  for (;;) {
    if (Date.now() > deadline) {
      console.error(
        `[push-queue] still waiting on ${enqueueRef} after ${waitMinutes} minutes; rerun to keep waiting.`,
      );
      process.exit(2);
    }
    spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
    let latest = listRemoteQueue();
    let stillQueued = latest.entries.some((item) => item.ref === enqueueRef);
    let onMain = ancestor(pushedSha, 'origin/main');
    let cherryOut = git(['cherry', 'origin/main', pushedSha]);
    let cherryHasUnapplied = cherryOut.split('\n').some((line) => line.startsWith('+ '));
    let removalNote = null;
    if (!stillQueued && !onMain && cherryHasUnapplied) {
      sleep(2);
      spawnSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
      latest = listRemoteQueue();
      stillQueued = latest.entries.some((item) => item.ref === enqueueRef);
      onMain = ancestor(pushedSha, 'origin/main');
      cherryOut = git(['cherry', 'origin/main', pushedSha]);
      cherryHasUnapplied = cherryOut.split('\n').some((line) => line.startsWith('+ '));
      removalNote = readRemovalComment();
    }
    const status = classifyWaitStatus({
      stillQueued,
      onMain,
      cherryHasUnapplied,
      ejectedByComment: removalNote !== null,
      mainMoved: Boolean(initialMainSha && latest.mainSha && latest.mainSha !== initialMainSha),
    });
    if (status.state === 'landed') {
      console.log(
        `[push-queue] landed ${pushedSha.slice(0, 9)} on origin/main (${latest.mainSha?.slice(0, 9)})`,
      );
      process.exit(0);
    }
    if (status.state === 'ejected') {
      console.error(
        `[push-queue] ${pushedSha.slice(0, 9)} was ejected from the merge queue.\n${removalNote || 'Check the promote workflow run for details.'}`,
      );
      process.exit(1);
    }
    sleep(POLL_SECONDS);
  }
}
