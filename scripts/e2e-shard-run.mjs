import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  contextFromEnv,
  readPlaywrightLastFailed,
  readPrevState,
  recordStepState,
} from './ci-failed-only-state.mjs';
import { playwrightSpecFilesFromIds, reportRetryGreen } from './flake-ledger.mjs';
import { runOwned } from './owned-process.mjs';
import { partitionByWeight } from './timed-partition.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');

export function shardOf(selection, shard) {
  const [index, count] = shard.split('/').map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error(`[e2e] --shard expects i/n with 1 <= i <= n, got ${shard}`);
    process.exit(2);
  }
  const weights = JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts/e2e-shard-weights.json'), 'utf8'),
  );
  return partitionByWeight(selection, weights, count)[index - 1];
}

export async function runPlaywright(specs, { full = false, port = '8398' } = {}) {
  const args = ['exec', 'playwright', 'test'];
  const env = { ...process.env, E2E_PORT: port };
  args.push('--reporter=list', ...specs.map((spec) => `e2e/${spec}`));
  if (!full) args.push('--workers', process.env.E2E_AFFECTED_WORKERS ?? '2');
  const ctx = contextFromEnv();
  if (!ctx.currDir) {
    process.exit(await runOwned('pnpm', args, { cwd: WEB_DIR, env, name: 'e2e' }));
  }
  const prev = readPrevState(ctx);
  if (prev?.steps?.playwright?.status === 'passed') {
    console.log(`[failed-only] skipping playwright: passed in attempt ${ctx.attempt - 1}`);
    recordStepState({
      ...ctx,
      stepKey: 'playwright',
      outcome: { status: 'passed', failedTestsCount: 0 },
    });
    if (full && !existsSync(join(WEB_DIR, 'dist/index.html'))) {
      const built = await runOwned('pnpm', ['exec', 'vite', 'build', '--mode', 'fixture'], {
        cwd: WEB_DIR,
        env,
        name: 'e2e-fixture-build',
      });
      if (built !== 0) process.exit(built);
    }
    process.exit(0);
  }
  const currLastRun = join(ctx.currDir, 'playwright-last-run.json');
  const prevLastRun = ctx.prevDir ? join(ctx.prevDir, 'playwright-last-run.json') : '';
  const failedIds =
    prev?.steps?.playwright?.status === 'failed' ? readPlaywrightLastFailed(prevLastRun) : null;
  if (failedIds) {
    copyFileSync(prevLastRun, currLastRun);
    args.push('--last-failed', '--last-failed-file', currLastRun);
    console.log(
      `[failed-only] rerunning ${failedIds.length} failed Playwright test(s) from attempt ${ctx.attempt - 1}`,
    );
  } else {
    args.push('--last-failed-file', currLastRun);
  }
  let code = await runOwned('pnpm', args, { cwd: WEB_DIR, env, name: 'e2e' });
  if (code === 0 && failedIds) {
    const retry = reportRetryGreen(playwrightSpecFilesFromIds(failedIds, WEB_DIR), {
      cwd: REPO_ROOT,
      label: 'Playwright spec',
    });
    if (retry.failed) code = 1;
  }
  const nextFailed = code === 0 ? null : readPlaywrightLastFailed(currLastRun);
  recordStepState({
    ...ctx,
    stepKey: 'playwright',
    outcome: {
      status: code === 0 ? 'passed' : 'failed',
      failedTestsCount: nextFailed?.length ?? 0,
    },
  });
  process.exit(code);
}
