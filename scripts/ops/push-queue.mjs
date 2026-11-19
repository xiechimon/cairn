#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { busyMessage } from './guard-queue.mjs';

export function planPush({ queueHead, queueHeadLanded }) {
  if (!queueHead || queueHeadLanded) return { action: 'push' };
  return { action: 'wait', sha: queueHead };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const queueHead = git(['ls-remote', 'origin', 'refs/heads/queue/main']).split(/\s+/)[0] || null;
  spawnSync('git', ['fetch', '--quiet', 'origin', 'main', ...(queueHead ? [queueHead] : [])], {
    stdio: 'inherit',
  });
  const queueHeadLanded =
    queueHead !== null &&
    spawnSync('git', ['merge-base', '--is-ancestor', queueHead, 'origin/main']).status === 0;
  const plan = planPush({ queueHead, queueHeadLanded });
  if (plan.action === 'wait') {
    const [subject, body] = git(['log', '-1', '--format=%s%x1f%B', plan.sha]).split('\x1f');
    let run;
    try {
      const { workflow_runs: runs } = JSON.parse(
        execFileSync(
          'gh',
          ['api', `repos/${repo}/actions/runs?head_sha=${plan.sha}&event=push&per_page=5`],
          { encoding: 'utf8' },
        ),
      );
      run = runs[0];
    } catch {
      run = undefined;
    }
    console.error(
      `[push-queue] not pushed.\n${busyMessage({ sha: plan.sha, subject, body, run })}`,
    );
    process.exit(1);
  }
  const push = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/queue/main'], {
    stdio: 'inherit',
  });
  process.exit(push.status ?? 1);
}
