#!/usr/bin/env node

import { hostname } from 'node:os';
import { basename } from 'node:path';
import { commandReader, readable, runCommand, sleep, unreadable } from './poll-read.mjs';

const CI_WORKFLOW = '.github/workflows/ci.yml';
const WAIT_MS = 120 * 60_000;

export function laneName(host, worktree) {
  return `${host}/${worktree}`.replace(/[^A-Za-z0-9._/-]/g, '-');
}

export function preflightRef(lane) {
  return `refs/heads/preflight/${lane}`;
}

export function preflightRuns(runs, sha, branch, startedAt) {
  return runs.filter(
    (run) =>
      run.path === CI_WORKFLOW &&
      run.event === 'push' &&
      run.head_sha === sha &&
      run.head_branch === branch &&
      Date.parse(run.created_at) > startedAt,
  );
}

export function watchVerdict(state) {
  if (state.kind === 'unreadable') return { verdict: 'unreadable', detail: state.source };
  const { status, conclusion } = state.value;
  if (status !== 'completed') return { verdict: 'pending', detail: `run status is ${status}` };
  if (!conclusion) return { verdict: 'pending', detail: 'run is completed without a conclusion' };
  return { verdict: conclusion === 'success' ? 'green' : 'red', conclusion };
}

export function pushPreflight(read, remaining, head, lane) {
  const ref = preflightRef(lane);
  const previous = read(
    'git',
    ['ls-remote', '--refs', 'origin', ref],
    `the preflight ref ${ref}`,
    (text) => {
      if (!text.trim()) return null;
      const [sha, remoteRef] = text.trim().split('\t');
      return remoteRef === ref && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha) ? sha : undefined;
    },
  );
  if (previous.kind === 'unreadable') return previous;
  const startedAt = Date.now();
  const pushed = runCommand(
    remaining,
    'git',
    [
      'push',
      '--porcelain',
      `--force-with-lease=${ref}:${previous.value ?? ''}`,
      'origin',
      `${head}:${ref}`,
    ],
    {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    },
  );
  if (pushed.error?.code === 'ETIMEDOUT') {
    console.error(`[preflight] git push to ${ref} timed out; the ref update was not confirmed`);
    return readable({ action: 'timeout' });
  }
  const status = pushed.stdout
    ?.split('\n')
    .map((line) => line.split('\t'))
    .find(([, refspec]) => refspec?.endsWith(`:${ref}`))?.[0];
  if (pushed.status === 0 && status === '=') {
    console.log(
      `[preflight] ${ref} is already at ${head.slice(0, 9)}; no new ci run was triggered`,
    );
    return readable({ action: 'unchanged' });
  }
  if (pushed.status !== 0 || ![' ', '+', '*'].includes(status)) {
    console.error(`[preflight] git push to ${ref} did not confirm a ref update`);
    return readable({ action: 'failed', status: pushed.status || 1 });
  }
  console.log(`[preflight] pushed ${head.slice(0, 9)} to ${ref}`);
  return readable({
    action: 'updated',
    before: previous.value ?? '0'.repeat(head.length),
    startedAt,
  });
}

function discoverRun(read, repo, head, branch, { startedAt, before }) {
  const runs = read(
    'gh',
    [
      'api',
      `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${head}&event=push&branch=${encodeURIComponent(branch)}&per_page=20`,
    ],
    'the ci run list',
    (text) => {
      const { workflow_runs } = JSON.parse(text);
      return Array.isArray(workflow_runs)
        ? preflightRuns(workflow_runs, head, branch, startedAt)
        : undefined;
    },
  );
  if (runs.kind === 'unreadable') return runs;
  const matches = [];
  for (const run of runs.value) {
    if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.check_suite_id) || !run.html_url)
      continue;
    const suite = read(
      'gh',
      ['api', `repos/${repo}/check-suites/${run.check_suite_id}`],
      'the ci run push range',
      (text) => {
        const record = JSON.parse(text);
        if (
          record.id !== run.check_suite_id ||
          typeof record.before !== 'string' ||
          typeof record.after !== 'string'
        )
          return undefined;
        return record.before === before && record.after === head && record.head_branch === branch;
      },
    );
    if (suite.kind === 'unreadable') return suite;
    if (suite.value) matches.push(run);
  }
  if (matches.length > 1) return unreadable('an unambiguous ci run for this push');
  return readable(matches[0] ?? null);
}

function main({ wait, repo }) {
  const deadline = performance.now() + WAIT_MS;
  const remaining = () => deadline - performance.now();
  const read = commandReader(remaining);
  const worktree = read('git', ['rev-parse', '--show-toplevel'], 'worktree path');
  const head = read('git', ['rev-parse', 'HEAD'], 'HEAD');
  for (const result of [worktree, head]) {
    if (result.kind === 'unreadable') {
      console.error(`[preflight] could not read ${result.source}; no verdict available`);
      return 2;
    }
  }
  const lane = laneName(hostname(), basename(worktree.value));
  const pushed = pushPreflight(read, remaining, head.value, lane);
  if (pushed.kind === 'unreadable') {
    console.error(`[preflight] could not read ${pushed.source}; no verdict available`);
    return 2;
  }
  if (pushed.value.action !== 'updated') return 2;

  let run = null;
  let attempts = 12;
  let watch = true;
  let detail = 'the ci run has not appeared';
  while (attempts > 0 && remaining() > 0) {
    if (run === null) {
      const discovery = discoverRun(read, repo, head.value, `preflight/${lane}`, pushed.value);
      if (discovery.kind === 'value' && discovery.value !== null) {
        run = discovery.value;
        console.log(`[preflight] ci run: ${run.html_url}`);
        if (!wait) {
          console.log('[preflight] use --wait when pushing a new SHA to wait for its conclusion');
          return 0;
        }
        attempts = 6;
        continue;
      }
      detail =
        discovery.kind === 'unreadable'
          ? `could not read ${discovery.source}`
          : 'the ci run for this push has not appeared';
    } else {
      if (watch) {
        const watched = runCommand(remaining, 'gh', [
          'run',
          'watch',
          String(run.id),
          '--repo',
          repo,
          '--exit-status',
          '--interval',
          '30',
        ]);
        if (watched.error?.code === 'ETIMEDOUT') {
          detail = 'the watch reached its deadline';
          break;
        }
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
      if (remaining() <= 0) {
        detail = 'the run state read reached the wait deadline';
        break;
      }
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
    if (attempts === 0 || remaining() <= 0) break;
    console.error(`[preflight] ${detail}; retrying (${attempts} remaining)`);
    sleep(Math.min(5000, remaining()));
  }
  const location = run ? ` at ${run.html_url}` : ' after pushing the preflight ref';
  console.error(`[preflight] ${detail}${location}; no verdict available`);
  return 2;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exitCode = main({
    wait: process.argv.includes('--wait'),
    repo: process.env.CAIRN_REPO ?? 'xiechimon/cairn',
  });
}
