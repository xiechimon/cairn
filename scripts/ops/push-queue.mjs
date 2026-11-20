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

  const queueHead = remoteSha('refs/heads/queue/main');
  const stateHead = remoteSha('refs/heads/queue-state/main');
  const candidates = [...new Set([queueHead, stateHead].filter(Boolean))];
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', ...candidates], { stdio: 'inherit' });
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
  const live =
    candidates.find(
      (sha) =>
        spawnSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']).status !== 0 &&
        !released(sha),
    ) ?? null;
  const plan = planPush({ live, queueHead });
  if (plan.action === 'wait') {
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
  const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/queue/main'], {
    stdio: 'inherit',
  });
  process.exit(push.status ?? 1);
}
