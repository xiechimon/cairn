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

export function watchVerdict(status, conclusion) {
  if (status !== 'completed' || !conclusion) return { verdict: 'unreadable' };
  return { verdict: conclusion === 'success' ? 'green' : 'red', conclusion };
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
      const latest = JSON.parse(
        execFileSync('gh', ['api', `repos/${repo}/actions/runs/${run.id}`], { encoding: 'utf8' }),
      );
      return { status: latest.status ?? null, conclusion: latest.conclusion ?? null };
    } catch {
      return null;
    }
  };
  spawnSync('gh', ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'], {
    stdio: 'inherit',
  });
  let state = currentStatus();
  const WATCH_RETRIES = 5;
  for (let attempt = 0; attempt <= WATCH_RETRIES; attempt++) {
    const outcome = watchVerdict(state?.status ?? null, state?.conclusion ?? null);
    if (outcome.verdict === 'green') {
      console.log('[preflight] green — push-queue will accept this head');
      process.exit(0);
    }
    if (outcome.verdict === 'red') {
      console.error(
        `[preflight] the run went ${outcome.conclusion}: ${run.html_url}; fix the failing jobs and push again`,
      );
      process.exit(1);
    }
    if (attempt === WATCH_RETRIES) break;
    console.error(
      state
        ? `[preflight] no verdict yet: the run is ${state.status}; waiting for it to finish`
        : '[preflight] no verdict yet: could not read the run; retrying',
    );
    sleep(5);
    state = currentStatus();
    if (state !== null && state.status !== 'completed') {
      spawnSync('gh', ['run', 'watch', String(run.id), '--exit-status', '--interval', '30'], {
        stdio: 'inherit',
      });
      state = currentStatus();
    }
  }
  console.error(
    `[preflight] could not read the run at ${run.html_url}; rerun node scripts/ops/preflight.mjs --wait`,
  );
  process.exit(1);
}
