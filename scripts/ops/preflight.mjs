#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { laneName, stampUnownedCommits } from './push-queue.mjs';

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRun(runs, sha, ref) {
  return (
    runs.find((run) => run.name === 'ci' && run.head_sha === sha && run.head_branch === ref) ?? null
  );
}

export function watchVerdict(status, conclusion, watchStatus) {
  if (status === 'completed')
    return { verdict: conclusion === 'success' ? 'green' : 'red', conclusion };
  return watchStatus === 0 ? { verdict: 'unreadable' } : { verdict: 'unreadable', watchStatus };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const wait = process.argv.includes('--wait');
  const repo = process.env.CAIRN_REPO ?? 'xiechimon/cairn';
  const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const lane = laneName(hostname(), basename(git(['rev-parse', '--show-toplevel'])));
  const ref = `preflight/${lane}`;
  const stamped = stampUnownedCommits({ lane, prefix: '[preflight]' });
  if (!stamped.ok) {
    console.error(
      '[preflight] could not stamp the owner trailer (a dirty tree or a conflict); fix that and run it again. Nothing was pushed.',
    );
    process.exit(1);
  }
  const sha = stamped.sha;
  const push = spawnSync(
    'git',
    ['push', `--force-with-lease=${preflightRef(lane)}`, 'origin', `HEAD:${preflightRef(lane)}`],
    { stdio: 'inherit' },
  );
  if (push.status !== 0) process.exit(push.status ?? 1);
  console.log(`[preflight] pushed ${sha.slice(0, 9)} to ${preflightRef(lane)}`);
  const sleep = (seconds) => spawnSync('sleep', [String(seconds)]);
  const readRun = () => {
    const { workflow_runs: runs } = JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`], {
        encoding: 'utf8',
      }),
    );
    return preflightRun(runs, sha, ref);
  };
  let run = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      run = readRun();
    } catch {
      run = null;
    }
    if (run) break;
    sleep(5);
  }
  if (!run) {
    console.error(
      '[preflight] could not read the run: the ci run did not appear; check that the ci workflow is enabled',
    );
    process.exit(1);
  }
  console.log(`[preflight] ci run: ${run.html_url}`);
  if (!wait) {
    console.log(
      '[preflight] rerun with --wait to block until it finishes, then node scripts/ops/push-queue.mjs',
    );
    process.exit(0);
  }
  const currentStatus = () => {
    try {
      const latest = readRun();
      return { status: latest?.status ?? null, conclusion: latest?.conclusion ?? null };
    } catch {
      return null;
    }
  };
  const watched = spawnSync(
    'gh',
    ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'],
    {
      stdio: 'inherit',
    },
  );
  let state = currentStatus();
  const WATCH_RETRIES = 5;
  for (let attempt = 0; attempt < WATCH_RETRIES; attempt++) {
    const outcome = watchVerdict(state?.status ?? null, state?.conclusion ?? null, watched.status);
    if (outcome.verdict !== 'unreadable') {
      if (outcome.verdict === 'green') {
        console.log('[preflight] green — push-queue will accept this head');
        process.exit(0);
      }
      console.error(
        `[preflight] the run went ${outcome.conclusion}: ${run.html_url}; fix the failing jobs and push again`,
      );
      process.exit(1);
    }
    console.error(
      `[preflight] could not read the run (watch exited ${watched.status ?? 'signal'}, state query failed); retrying ${WATCH_RETRIES - attempt} more time(s)`,
    );
    sleep(5);
    state = currentStatus();
    if (state && state.status !== 'completed') {
      const again = spawnSync(
        'gh',
        ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'],
        {
          stdio: 'inherit',
        },
      );
      if (again.status === 0) {
        console.log('[preflight] green — push-queue will accept this head');
        process.exit(0);
      }
      state = currentStatus();
      if (state && state.status === 'completed') continue;
    }
  }
  console.error(
    `[preflight] could not read the run at ${run.html_url}; rerun node scripts/ops/preflight.mjs --wait`,
  );
  process.exit(1);
}
