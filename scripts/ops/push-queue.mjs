#!/usr/bin/env node

import { hostname } from 'node:os';
import { basename, join } from 'node:path';
import { busyMessage, RELEASE_MARKER } from './guard-queue.mjs';
import { commandReader, readable, runCommand, sleep } from './poll-read.mjs';
import { laneName, pushPreflight } from './preflight.mjs';
import { ownerOf } from './promote-queue.mjs';

export function planPush({ live, queueHead }) {
  if (!live) return { action: 'push' };
  return { action: 'wait', sha: live, restoring: queueHead === null };
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

export const RED_CONCLUSIONS = ['failure', 'timed_out', 'cancelled'];

export function failedGreenContexts(checkRuns) {
  const byName = new Map(checkRuns.map((run) => [run.name, run.conclusion]));
  return GREEN_CONTEXTS.filter((name) => RED_CONCLUSIONS.includes(byName.get(name) ?? ''));
}

export function preflightEvidence({ shas, pushedTree, treeOf, checkRunsOf }) {
  for (const sha of shas) {
    const tree = treeOf(sha);
    if (tree.kind === 'unreadable') return tree;
    if (tree.value !== pushedTree) continue;
    const runs = checkRunsOf(sha);
    if (runs.kind === 'unreadable') return runs;
    const failed = sha === shas[0] ? failedGreenContexts(runs.value) : [];
    if (failed.length > 0) return readable({ ok: false, failed });
    if (missingGreenContexts(runs.value).length === 0) return readable({ ok: true, sha, failed });
  }
  return readable({ ok: false, failed: [] });
}

export function nextWaitAction({ live, headOnLive, deadBase, head, armedSha, evidence, failed }) {
  if (live && !headOnLive) return { action: 'rebase', onto: live };
  if (deadBase) return { action: 'rebase', onto: 'origin/main' };
  if (failed.length > 0) return { action: 'fail', contexts: failed };
  if (evidence.ok && !live) return { action: 'push' };
  if (!evidence.ok && head !== armedSha) return { action: 'preflight' };
  return { action: 'poll' };
}

export function unownedCommits(commits) {
  return commits.filter((commit) => ownerOf(commit.body) === null).map((commit) => commit.sha);
}

export function stampCommand(lane) {
  return `git log -1 --format=%B | grep -Eq '^(Amp-Thread-ID|Lane):' || git commit -q --amend --allow-empty --no-edit --trailer 'Lane: ${lane}'`;
}

function ancestorOf(read, a, b) {
  return read(
    'git',
    ['merge-base', '--is-ancestor', a, b],
    `whether ${a} is an ancestor of ${b}`,
    (_, status) => status === 0,
    [0, 1],
  );
}

function findLive(read, repo) {
  const refs = [];
  for (const ref of ['refs/heads/queue/main', 'refs/heads/queue-state/main']) {
    const remote = read(
      'git',
      ['ls-remote', 'origin', ref],
      `the queue state (${ref})`,
      (text) => text.split(/\s+/)[0] || null,
    );
    if (remote.kind === 'unreadable') return remote;
    refs.push(remote.value);
  }
  const [queueHead] = refs;
  const candidates = [...new Set(refs.filter(Boolean))];
  const fetched = read(
    'git',
    ['fetch', '--quiet', 'origin', 'main', ...candidates],
    'the queue state (git fetch)',
  );
  if (fetched.kind === 'unreadable') return fetched;
  for (const sha of candidates) {
    const landed = ancestorOf(read, sha, 'origin/main');
    if (landed.kind === 'unreadable') return landed;
    if (landed.value) continue;
    const released = read(
      'gh',
      ['api', `repos/${repo}/commits/${sha}/comments?per_page=100`],
      `release markers for ${sha}`,
      (text) => {
        const comments = JSON.parse(text);
        return comments.some((entry) => entry.body.startsWith(RELEASE_MARKER));
      },
    );
    if (released.kind === 'unreadable') return released;
    if (!released.value) return readable({ queueHead, live: sha });
  }
  return readable({ queueHead, live: null });
}

function checkRunsFor(read, repo, sha) {
  return read(
    'gh',
    ['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`],
    `check runs for ${sha.slice(0, 9)}`,
    (text, status) => {
      const response = JSON.parse(text);
      if (
        status === 1 &&
        ['404', '422'].includes(String(response.status)) &&
        response.message === `No commit found for SHA: ${sha}`
      )
        return [];
      if (
        status === 0 &&
        Array.isArray(response.check_runs) &&
        response.check_runs.every(
          (run) =>
            typeof run?.name === 'string' &&
            (run.conclusion === null || typeof run.conclusion === 'string'),
        )
      )
        return response.check_runs;
      return undefined;
    },
    [0, 1],
  );
}

function assess(read, repo, { live, wait, lane }) {
  const head = read('git', ['rev-parse', 'HEAD'], 'HEAD');
  if (head.kind === 'unreadable') return head;
  const prepared = lane.prepared?.head === head.value ? lane.prepared : null;
  if (!wait && !prepared) return readable({ action: 'prepare', head: head.value });

  const candidate = live ?? (lane.observed !== lane.lastBase ? lane.observed : null);
  const headOnCandidate = candidate ? ancestorOf(read, candidate, head.value) : readable(false);
  if (headOnCandidate.kind === 'unreadable') return headOnCandidate;
  if (headOnCandidate.value) lane.lastBase = candidate;
  if (!live) lane.observed = null;
  const baseLanded =
    !live && lane.lastBase ? ancestorOf(read, lane.lastBase, 'origin/main') : readable(true);
  if (baseLanded.kind === 'unreadable') return baseLanded;
  const treeOf = (sha) => read('git', ['rev-parse', `${sha}^{tree}`], `the tree of ${sha}`);
  const headTree = treeOf(head.value);
  if (headTree.kind === 'unreadable') return headTree;
  const evidence = preflightEvidence({
    shas: [...new Set([head.value, prepared?.before].filter(Boolean))],
    pushedTree: headTree.value,
    treeOf: (sha) => (sha === head.value ? headTree : treeOf(sha)),
    checkRunsOf: (sha) => checkRunsFor(read, repo, sha),
  });
  if (evidence.kind === 'unreadable') return evidence;
  const { failed, ok } = evidence.value;
  const step = wait
    ? nextWaitAction({
        live,
        headOnLive: live !== null && headOnCandidate.value,
        deadBase: !baseLanded.value,
        head: head.value,
        armedSha: lane.armedSha,
        evidence: evidence.value,
        failed,
      })
    : failed.length > 0
      ? { action: 'fail', contexts: failed }
      : { action: ok ? 'push' : 'missing' };
  return readable({
    ...step,
    action: step.action === 'push' && !prepared ? 'prepare' : step.action,
    head: head.value,
    waitingOnEvidence: !ok,
  });
}

function reportBusy(read, repo, plan) {
  const commit = read(
    'git',
    ['log', '-1', '--format=%s%x1f%B', plan.sha],
    'the live candidate commit',
  );
  const run = read(
    'gh',
    ['api', `repos/${repo}/actions/runs?head_sha=${plan.sha}&event=push&per_page=30`],
    'the live candidate ci state',
    (text) => {
      const { workflow_runs: runs } = JSON.parse(text);
      return runs.find((candidate) => candidate.name === 'ci') ?? null;
    },
  );
  const restoring = plan.restoring
    ? '\nqueue/main is missing; the guard protects the candidate stored in queue-state/main.'
    : '';
  if (commit.kind === 'unreadable' || run.kind === 'unreadable') {
    const source = commit.kind === 'unreadable' ? commit.source : run.source;
    console.error(
      `[push-queue] not pushed: ${plan.sha.slice(0, 9)} holds the queue; could not read ${source}.${restoring}`,
    );
    return;
  }
  const [subject, body] = commit.value.split('\x1f');
  console.error(
    `[push-queue] not pushed.\n${busyMessage({ sha: plan.sha, subject, body, run: run.value })}${restoring}`,
  );
}

function runRebase(run, args) {
  const result = run('git', ['rebase', ...args]);
  if (result.error?.code === 'ETIMEDOUT') return 'timeout';
  if (result.status === 0) return 'ok';
  const abort = run('git', ['rebase', '--abort']);
  return abort.error?.code === 'ETIMEDOUT' ? 'timeout' : 'failed';
}

function preparePush(read, run) {
  const commits = read(
    'git',
    ['log', '--reverse', '--format=%H%x1f%B%x1e', 'origin/main..HEAD'],
    'commits to stamp',
    (text) =>
      text
        .split('\x1e')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [sha, body] = entry.split('\x1f');
          return { sha, body };
        }),
  );
  if (commits.kind === 'unreadable') return commits;
  if (unownedCommits(commits.value).length > 0) {
    const worktree = read('git', ['rev-parse', '--show-toplevel'], 'worktree path');
    if (worktree.kind === 'unreadable') return worktree;
    const lane = laneName(hostname(), basename(worktree.value));
    console.log(`[push-queue] stamping the commits that have no owner trailer with Lane: ${lane}`);
    const stamp = runRebase(run, ['--exec', stampCommand(lane), 'origin/main']);
    if (stamp !== 'ok') return readable({ action: stamp, operation: 'owner-trailer rebase' });
  }
  const head = read('git', ['rev-parse', 'HEAD'], 'the prepared HEAD');
  if (head.kind === 'unreadable') return head;
  const english = run(process.execPath, [join(import.meta.dirname, '..', 'english-only-gate.mjs')]);
  if (english.status === 0) return readable({ action: 'ok', head: head.value });
  return readable({
    action: english.error?.code === 'ETIMEDOUT' ? 'timeout' : 'failed',
    operation: 'English-only gate',
  });
}

function main({ repo, wait, waitMinutes, pollMs }) {
  for (const [name, value] of [
    ['PUSH_QUEUE_WAIT_MINUTES', waitMinutes * 60_000],
    ['PUSH_QUEUE_POLL_SECONDS', pollMs],
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`[push-queue] ${name} must be a positive finite number`);
      return 1;
    }
  }
  const deadline = wait ? performance.now() + waitMinutes * 60_000 : Infinity;
  const remaining = () => deadline - performance.now();
  const read = commandReader(remaining);
  const run = (file, args) => runCommand(remaining, file, args);
  const lane = { armedSha: null, lastBase: null, observed: null, prepared: null };
  let lastLive;
  let lastStep;
  let timedOutOperation;
  let unreadableSource;
  while (remaining() > 0) {
    const queue = findLive(read, repo);
    let decision = queue;
    if (queue.kind === 'value') {
      lastLive = queue.value.live;
      if (lastLive) lane.observed = lastLive;
      const plan = planPush(queue.value);
      if (!wait && plan.action === 'wait') {
        reportBusy(read, repo, plan);
        return 1;
      }
      decision = assess(read, repo, { live: lastLive, wait, lane });
    }
    unreadableSource = decision.kind === 'unreadable' ? decision.source : null;
    if (decision.kind === 'value') lastStep = decision.value;
    if (remaining() <= 0) break;
    if (decision.kind === 'value') {
      const step = decision.value;
      switch (step.action) {
        case 'push': {
          const push = run('git', ['push', 'origin', `${step.head}:refs/heads/queue/main`]);
          if (push.error?.code === 'ETIMEDOUT') {
            timedOutOperation = 'queue push';
            break;
          }
          return push.status ?? 1;
        }
        case 'missing':
          console.error(
            `[push-queue] not pushed: ${step.head.slice(0, 9)} has no green ci evidence for ${GREEN_CONTEXTS.join(' + ')}.\n` +
              'Run node scripts/ops/preflight.mjs --wait — it pushes HEAD to refs/heads/preflight/<lane> and waits for the ci run.\n' +
              'A green run on a commit with the same tree also counts; local pnpm prepush stays optional.',
          );
          return 1;
        case 'fail':
          console.error(
            `[push-queue] not pushed: preflight checks for ${step.head.slice(0, 9)} ended without success: ${step.contexts.join(', ')}. Inspect the run before retrying.`,
          );
          return 1;
        case 'rebase': {
          const upstream = lane.lastBase ?? 'origin/main';
          console.log(`[push-queue] rebasing ${upstream}..HEAD onto ${step.onto}`);
          const rebase = runRebase(run, ['--onto', step.onto, upstream]);
          if (rebase === 'timeout') {
            timedOutOperation = 'git rebase';
            break;
          }
          if (rebase === 'failed') {
            console.error(
              `[push-queue] not pushed: git could not rebase onto ${step.onto}; see git output above.`,
            );
            return 1;
          }
          lane.lastBase = step.onto === 'origin/main' ? null : step.onto;
          lane.prepared = null;
          continue;
        }
        case 'preflight': {
          const worktree = read('git', ['rev-parse', '--show-toplevel'], 'worktree path');
          if (worktree.kind === 'unreadable') {
            unreadableSource = worktree.source;
            break;
          }
          const pushed = pushPreflight(
            read,
            remaining,
            step.head,
            laneName(hostname(), basename(worktree.value)),
          );
          if (pushed.kind === 'unreadable') {
            unreadableSource = pushed.source;
            break;
          }
          if (pushed.value.action === 'timeout') {
            timedOutOperation = 'preflight push';
            break;
          }
          if (pushed.value.action === 'failed') return pushed.value.status;
          lane.armedSha = step.head;
          continue;
        }
        case 'prepare': {
          const prepared = preparePush(read, run);
          if (prepared.kind === 'unreadable') {
            unreadableSource = prepared.source;
            break;
          }
          if (prepared.value.action === 'timeout') {
            timedOutOperation = prepared.value.operation;
            break;
          }
          if (prepared.value.action === 'failed') {
            console.error(`[push-queue] not pushed: ${prepared.value.operation} did not pass.`);
            return 1;
          }
          lane.prepared = { head: prepared.value.head, before: step.head };
          continue;
        }
      }
    }
    if (timedOutOperation || remaining() <= 0) break;
    if (unreadableSource) {
      console.error(
        `[push-queue] could not read ${unreadableSource}${wait ? '; retrying' : '; not pushed'}`,
      );
      if (!wait) return 1;
    }
    sleep(Math.min(pollMs, remaining()));
  }
  const candidate = lastLive ? ` Last known live candidate: ${lastLive.slice(0, 9)}.` : '';
  const reason =
    lastStep?.action === 'fail'
      ? ` Preflight checks for ${lastStep.head.slice(0, 9)} failed: ${lastStep.contexts.join(', ')}.`
      : lastStep?.action === 'rebase'
        ? ` Last planned rebase: onto ${lastStep.onto}.`
        : lastStep?.action === 'preflight' ||
            (lastStep?.action === 'poll' && lastStep.waitingOnEvidence)
          ? ' Still waiting on green evidence.'
          : '';
  const failedRead = unreadableSource ? ` The last poll could not read ${unreadableSource}.` : '';
  const outcome =
    timedOutOperation === 'queue push' ? 'queue push outcome unconfirmed' : 'not pushed to queue';
  const command = timedOutOperation
    ? ` Timed out during ${timedOutOperation}; check its state before retrying.`
    : '';
  console.error(
    `[push-queue] wait deadline reached after ${waitMinutes} minute(s); ${outcome}.${candidate}${reason}${failedRead}${command}`,
  );
  return 2;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = main({
    repo: process.env.CAIRN_REPO ?? 'xiechimon/cairn',
    wait: process.argv.includes('--wait'),
    waitMinutes: Number(process.env.PUSH_QUEUE_WAIT_MINUTES ?? 120),
    pollMs: Number(process.env.PUSH_QUEUE_POLL_SECONDS ?? 60) * 1000,
  });
}
