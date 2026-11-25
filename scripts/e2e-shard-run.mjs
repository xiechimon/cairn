import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  args.push('--workers', process.env.E2E_AFFECTED_WORKERS ?? (process.env.GITHUB_ACTIONS ? '4' : '2'));
  process.exit(await runOwned('pnpm', args, { cwd: WEB_DIR, env, name: 'e2e' }));
}
