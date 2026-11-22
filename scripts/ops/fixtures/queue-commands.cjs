const { readFileSync, writeFileSync } = require('node:fs');
const child = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const os = require('node:os');
const { basename } = require('node:path');

const realSpawn = child.spawnSync;
os.hostname = () => 'test-host';
const scenario = process.env.QUEUE_TEST_SCENARIO;
const preflight = basename(process.argv[1]) === 'preflight.mjs';
const head = 'a'.repeat(40);
const candidate = 'b'.repeat(40);
const stacked = 'c'.repeat(40);
const rebased = 'd'.repeat(40);
const ref = 'preflight/test-host/test-worktree';
const active = ['fetch', 'ancestry', 'release', 'slow', 'slow-error'].includes(scenario);
const data = () => JSON.parse(readFileSync('state.json', 'utf8'));
const state = data();
const persist = () => writeFileSync('state.json', JSON.stringify(state));
process.on('exit', persist);
Date.now = () => state.now;
Object.defineProperty(performance, 'now', { value: Date.now });
Atomics.wait = (_array, _index, _value, ms) => {
  state.now += ms;
};

function response(value = '', status = 0, stderr = '') {
  return { status, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr };
}

function runState() {
  const pending = { status: 'in_progress', conclusion: null };
  if (scenario === 'retry-exit' && state.watches < 2) return pending;
  if (scenario === 'missing-conclusion' && state.verdictReads === 1)
    return { status: 'completed', conclusion: null };
  if (scenario === 'last-retry' && state.watches < 6) return pending;
  if (['no-verdict', 'watch-timeout'].includes(scenario)) return pending;
  if (['repo', 'progress'].includes(scenario) && state.watches < 2) return pending;
  return {
    status: 'completed',
    conclusion: ['duplicate-run', 'retry-exit', 'last-retry', 'stale-run'].includes(scenario)
      ? 'failure'
      : 'success',
  };
}

function command(file, args, options) {
  if (state.calls.length > 200) throw new Error('CLI polling did not stop');
  state.calls.push([basename(file), ...args]);
  const [action, subject] = args;
  if (file === 'sleep') {
    state.now += Number(action) * 1000;
    return response();
  }
  if (file === 'git') {
    if (action === 'rev-parse') {
      if (subject === '--show-toplevel') return response('/test/test-worktree\n');
      if (subject.endsWith('^{tree}')) return response('tree\n');
      if (subject === 'HEAD') return response(`${state.head ?? head}\n`);
    }
    if (action === 'ls-remote') {
      if (subject === '--refs') {
        const sha = scenario === 'noop' ? head : scenario === 'stale-run' ? candidate : null;
        return response(sha ? `${sha}\t${args.at(-1)}\n` : '');
      }
      if (args[2] === 'refs/heads/queue-state/main') {
        if (scenario.startsWith('slow') && state.snapshots === 1) state.now += 15_000;
        return response();
      }
      state.snapshots++;
      if (scenario.startsWith('slow') && state.snapshots === 1) state.now += 15_000;
      if (scenario === 'initial-read' && state.snapshots === 1)
        return response('', 128, 'temporary ls-remote failure');
      if (scenario === 'sleep-limit') {
        state.now += 7000;
        return response('', 128, 'temporary ls-remote failure');
      }
      const hasLive =
        active ||
        (scenario.startsWith('startup-base') && state.snapshots === 1) ||
        (scenario === 'rebase-same-tree' && !state.pushedPreflight);
      return response(hasLive ? `${candidate}\t${args[2]}\n` : '');
    }
    if (action === 'fetch') {
      if (scenario.startsWith('slow') && state.snapshots === 1) state.now += 25_000;
      return response('', scenario === 'fetch' && state.snapshots <= 2 ? 128 : 0);
    }
    if (action === 'merge-base') {
      if (args[3] !== 'origin/main') {
        if (scenario === 'startup-base-unreadable' && state.snapshots === 1)
          return response('', 128);
        const onLive =
          scenario.startsWith('slow') ||
          (scenario.startsWith('startup-base') && !state.head) ||
          state.head === stacked;
        return response('', onLive ? 0 : 1);
      }
      if (scenario === 'ancestry') return response('', state.snapshots <= 2 ? 128 : 0);
      return response('', scenario === 'fetch' && state.snapshots > 2 ? 0 : 1);
    }
    if (action === 'log') return response(`${head}\x1fowned\n\nLane: test-host/test-worktree\x1e`);
    if (action === 'rebase') {
      if (
        subject === '--onto' &&
        (scenario.startsWith('startup-base') || scenario === 'rebase-same-tree')
      ) {
        state.head = args[2] === candidate ? stacked : rebased;
        return response();
      }
      return response('', subject === '--abort' ? 0 : 128);
    }
    if (action === 'push') {
      const refspec = args.at(-1);
      if (refspec.includes(':refs/heads/preflight/')) {
        state.pushedPreflight = true;
        state.preflightSha = state.head ?? head;
        state.pushedAt = state.now;
        const flag = scenario === 'noop' ? '=' : ' ';
        return response(
          `To fake-origin\n${flag}\t${refspec}\t[${flag === '=' ? 'up to date' : 'updated'}]\nDone\n`,
        );
      }
      return response();
    }
  }
  if (file === 'gh') {
    if (action === 'run' && subject === 'watch') {
      state.watches++;
      if (scenario === 'watch-timeout') {
        state.now += options.timeout ?? 8_000_000;
        return { ...response('', null), error: { code: 'ETIMEDOUT' } };
      }
      if (scenario === 'last-retry') return response('', 17);
      if (['retry-exit', 'repo', 'progress'].includes(scenario) && state.watches === 1)
        return response('', 17);
      return response();
    }
    if (
      action === 'api' &&
      (subject.includes('/actions/runs?') || subject.includes('/actions/workflows/ci.yml/runs?'))
    ) {
      if (!preflight || scenario === 'no-child-run') return response({ workflow_runs: [] });
      const initial = !state.discovered;
      state.discovered = true;
      if (!initial) state.verdictReads++;
      const original = {
        id: 100,
        name: 'ci',
        head_sha: head,
        head_branch: ref,
        html_url: 'https://example.test/runs/100',
        check_suite_id: 200,
        created_at: new Date((state.pushedAt ?? state.now) + 2000).toISOString(),
        event: 'push',
        path: '.github/workflows/ci.yml',
      };
      const run = initial ? original : { ...original, ...runState() };
      if (scenario === 'stale-run') {
        const old = {
          ...original,
          id: 101,
          html_url: 'https://example.test/runs/101',
          created_at: new Date(state.now - 60_000).toISOString(),
        };
        const manual = { ...original, id: 102, event: 'workflow_dispatch' };
        const other = { ...original, id: 103, path: '.github/workflows/other.yml' };
        const wrongRange = { ...original, id: 104, check_suite_id: 204 };
        return response({
          workflow_runs: initial
            ? [old, manual, other, wrongRange]
            : [old, manual, other, wrongRange, run],
        });
      }
      if (!initial && scenario === 'duplicate-run')
        return response({ workflow_runs: [{ ...run, id: 101, conclusion: 'success' }, run] });
      return response({ workflow_runs: [run] });
    }
    if (action === 'api' && subject.includes('/check-suites/')) {
      const id = Number(subject.split('/').at(-1));
      const before = id === 204 ? rebased : scenario === 'stale-run' ? candidate : '0'.repeat(40);
      return response({ id, before, after: head, head_branch: ref });
    }
    if (action === 'api' && /\/actions\/runs\/10[1234]$/.test(subject)) {
      return response({
        id: Number(subject.split('/').at(-1)),
        status: 'completed',
        conclusion: 'success',
      });
    }
    if (action === 'api' && subject.endsWith('/actions/runs/100')) {
      state.verdictReads++;
      return response({ id: 100, ...runState() });
    }
    if (action === 'api' && subject.includes('/comments?')) {
      if (scenario !== 'release') return response([]);
      if (state.snapshots <= 2) return response('', 1, 'temporary comments failure');
      return response([{ body: 'queue/main release: test candidate dropped' }]);
    }
    if (action === 'api' && subject.includes('/check-runs?')) {
      state.checks++;
      const lastReadFails = scenario === 'final-read' && state.prepared && !state.failedFinal;
      state.failedFinal ||= lastReadFails;
      if (lastReadFails || (scenario === 'duplicate-check-read' && state.checks === 2))
        return response('', 1, 'temporary check-runs failure');
      if (scenario.startsWith('slow') && state.checks === 1) {
        const duration = 90_000;
        state.now += Math.min(duration, options.timeout ?? duration);
        if (scenario === 'slow-error') return response('', 1, 'slow check-runs failure');
        if (scenario === 'slow-red')
          return response({ check_runs: [{ name: 'pack-smoke', conclusion: 'failure' }] });
      }
      return response({
        check_runs:
          (scenario === 'no-child-run' && !state.pushedPreflight) ||
          (scenario === 'rebase-same-tree' && state.preflightSha !== state.head)
            ? []
            : ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' })),
      });
    }
  }
  if (file === process.execPath && basename(action) === 'english-only-gate.mjs') {
    if (scenario === 'gate-timeout') {
      state.now += options.timeout ?? 90_000;
      return { ...response('', null), error: { code: 'ETIMEDOUT' } };
    }
    state.prepared = true;
    return response();
  }
  if (file === process.execPath && basename(action) === 'preflight.mjs') {
    persist();
    const result = realSpawn(file, ['--require', __filename, ...args], options);
    Object.assign(state, data());
    return result;
  }
  throw new Error(`Unexpected command: ${file} ${args.join(' ')}`);
}

child.spawnSync = (file, args, options = {}) => {
  const result = command(file, args, options);
  if (options.stdio === 'inherit') {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
};
child.execFileSync = (file, args, options = {}) => {
  const result = command(file, args, options);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};
syncBuiltinESMExports();
