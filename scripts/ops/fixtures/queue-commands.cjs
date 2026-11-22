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
  if (['repo', 'progress'].includes(scenario) && state.watches < 2) return pending;
  return {
    status: 'completed',
    conclusion: ['duplicate-run', 'retry-exit', 'last-retry'].includes(scenario)
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
      if (subject === 'HEAD') return response(`${head}\n`);
    }
    if (action === 'ls-remote') {
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
      return response(active ? `${candidate}\t${args[2]}\n` : '');
    }
    if (action === 'fetch') {
      if (scenario.startsWith('slow') && state.snapshots === 1) state.now += 25_000;
      return response('', scenario === 'fetch' && state.snapshots <= 2 ? 128 : 0);
    }
    if (action === 'merge-base') {
      if (args[3] === 'HEAD') return response('', scenario.startsWith('slow') ? 0 : 1);
      if (scenario === 'ancestry') return response('', state.snapshots <= 2 ? 128 : 0);
      return response('', scenario === 'fetch' && state.snapshots > 2 ? 0 : 1);
    }
    if (action === 'log') return response(`${head}\x1fowned\n\nLane: test-host/test-worktree\x1e`);
    if (action === 'rebase') return response('', subject === '--abort' ? 0 : 128);
    if (action === 'push') {
      state.pushedPreflight ||= args.some((arg) => arg.startsWith('HEAD:refs/heads/preflight/'));
      return response();
    }
  }
  if (file === 'gh') {
    if (action === 'run' && subject === 'watch') {
      state.watches++;
      if (scenario === 'last-retry') return response('', 17);
      if (['retry-exit', 'repo', 'progress'].includes(scenario) && state.watches === 1)
        return response('', 17);
      return response();
    }
    if (action === 'api' && subject.includes('/actions/runs?')) {
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
      };
      const run = initial ? original : { ...original, ...runState() };
      if (!initial && scenario === 'duplicate-run')
        return response({ workflow_runs: [{ ...run, id: 101, conclusion: 'success' }, run] });
      return response({ workflow_runs: [run] });
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
      }
      return response({
        check_runs:
          scenario === 'no-child-run' && !state.pushedPreflight
            ? []
            : ['check', 'pack-smoke', 'e2e-gate'].map((name) => ({ name, conclusion: 'success' })),
      });
    }
  }
  if (file === process.execPath && basename(action) === 'english-only-gate.mjs') {
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
