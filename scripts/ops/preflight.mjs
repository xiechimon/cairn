#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import { commandReader, sleep } from './poll-read.mjs';

export function laneName(host, worktree) {
  return `${host}/${worktree}`.replace(/[^A-Za-z0-9._/-]/g, '-');
}

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRun(runs, sha, ref) {
  return (
    runs.find((run) => run.name === 'ci' && run.head_sha === sha && run.head_branch === ref) ?? null
  );
}

export function watchVerdict(state) {
  if (state.kind === 'unreadable') return { verdict: 'unreadable', detail: state.source };
  const { status, conclusion } = state.value;
  if (status !== 'completed') return { verdict: 'pending', detail: `run status is ${status}` };
  if (!conclusion) return { verdict: 'pending', detail: 'run is completed without a conclusion' };
  return { verdict: conclusion === 'success' ? 'green' : 'red', conclusion };
}

export function pushPreflight(head, lane) {
  const ref = preflightRef(lane);
  const push = spawnSync('git', ['push', `--force-with-lease=${ref}`, 'origin', `HEAD:${ref}`], {
    stdio: 'inherit',
  });
  if (push.status === 0) console.log(`[preflight] pushed ${head.slice(0, 9)} to ${ref}`);
  else console.error(`[preflight] git push to ${ref} did not succeed`);
  return push.status ?? 1;
}

function main({ wait, repo }) {
  const read = commandReader();
  const worktree = read('git', ['rev-parse', '--show-toplevel'], 'worktree path');
  const head = read('git', ['rev-parse', 'HEAD'], 'HEAD');
  for (const result of [worktree, head]) {
    if (result.kind === 'unreadable') {
      console.error(`[preflight] could not read ${result.source}; not pushed`);
      return 1;
    }
  }
  const lane = laneName(hostname(), basename(worktree.value));
  const pushed = pushPreflight(head.value, lane);
  if (pushed !== 0) return pushed;

  let run = null;
  let attempts = 12;
  let watch = true;
  for (;;) {
    let detail;
    if (run === null) {
      const discovery = read(
        'gh',
        ['api', `repos/${repo}/actions/runs?head_sha=${head.value}&per_page=20`],
        'the ci run list',
        (text) => {
          const { workflow_runs: runs } = JSON.parse(text);
          if (!Array.isArray(runs)) return undefined;
          const found = preflightRun(runs, head.value, `preflight/${lane}`);
          return found === null || (Number.isSafeInteger(found.id) && found.html_url)
            ? found
            : undefined;
        },
      );
      if (discovery.kind === 'value' && discovery.value !== null) {
        run = discovery.value;
        console.log(`[preflight] ci run: ${run.html_url}`);
        if (!wait) {
          console.log('[preflight] use --wait to wait for the conclusion');
          return 0;
        }
        attempts = 6;
        continue;
      }
      detail =
        discovery.kind === 'unreadable'
          ? `could not read ${discovery.source}`
          : 'the ci run has not appeared';
    } else {
      if (watch) {
        spawnSync(
          'gh',
          ['run', 'watch', String(run.id), '--repo', repo, '--exit-status', '--interval', '30'],
          {
            stdio: 'inherit',
          },
        );
      }
      const state = read(
        'gh',
        ['api', `repos/${repo}/actions/runs/${run.id}`],
        'the run state',
        (text) => {
          const current = JSON.parse(text);
          return current?.id === run.id &&
            typeof current.status === 'string' &&
            (current.conclusion == null || typeof current.conclusion === 'string')
            ? current
            : undefined;
        },
      );
      const outcome = watchVerdict(state);
      if (outcome.verdict === 'green') {
        console.log('[preflight] green — the ci run concluded success');
        return 0;
      }
      if (outcome.verdict === 'red') {
        console.error(
          `[preflight] the run went ${outcome.conclusion}: ${run.html_url}; inspect the run before retrying`,
        );
        return 1;
      }
      watch = state.kind === 'value' && state.value.status !== 'completed';
      detail =
        outcome.verdict === 'unreadable' ? `could not read ${outcome.detail}` : outcome.detail;
    }
    attempts--;
    if (attempts === 0) {
      const location = run ? ` at ${run.html_url}` : ' after pushing the preflight ref';
      console.error(`[preflight] ${detail}${location}; no verdict available`);
      return 1;
    }
    console.error(`[preflight] ${detail}; retrying (${attempts} remaining)`);
    sleep(5000);
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = main({
    wait: process.argv.includes('--wait'),
    repo: process.env.CAIRN_REPO ?? 'xiechimon/cairn',
  });
}
