#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { laneName } from './push-queue.mjs';

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRun(runs, sha, ref) {
  return (
    runs.find((run) => run.name === 'ci' && run.head_sha === sha && run.head_branch === ref) ?? null
  );
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const wait = process.argv.includes('--wait');
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const lane = laneName(hostname(), basename(git(['rev-parse', '--show-toplevel'])));
  const ref = `preflight/${lane}`;
  const sha = git(['rev-parse', 'HEAD']);
  const push = spawnSync(
    'git',
    ['push', `--force-with-lease=${preflightRef(lane)}`, 'origin', `HEAD:${preflightRef(lane)}`],
    { stdio: 'inherit' },
  );
  if (push.status !== 0) process.exit(push.status ?? 1);
  console.log(`[preflight] pushed ${sha.slice(0, 9)} to ${preflightRef(lane)}`);
  let run = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const { workflow_runs: runs } = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`], {
          encoding: 'utf8',
        }),
      );
      run = preflightRun(runs, sha, ref);
    } catch {
      run = null;
    }
    if (run) break;
    spawnSync('sleep', ['5']);
  }
  if (!run) {
    console.error('[preflight] the ci run did not appear; check that the ci workflow is enabled');
    process.exit(1);
  }
  console.log(`[preflight] ci run: ${run.html_url}`);
  if (!wait) {
    console.log(
      '[preflight] rerun with --wait to block until it finishes, then node scripts/ops/push-queue.mjs',
    );
    process.exit(0);
  }
  const watched = spawnSync(
    'gh',
    ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'],
    {
      stdio: 'inherit',
    },
  );
  if (watched.status === 0) {
    console.log('[preflight] green — push-queue will accept this head');
  } else {
    console.error('[preflight] the run is not green; fix the failing jobs and push again');
  }
  process.exit(watched.status ?? 1);
}
