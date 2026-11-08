#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  DEPENDENCY_FILES,
  DIR_RULES,
  dependencyImpact,
  E2E_PREFIX,
  FILE_RULES,
  listSpecs,
  SHARED_SURFACE_ONLY,
  selectSpecs,
  workspacePackages,
} from './e2e-affected-select.mjs';
import {
  acquireSlot,
  leaseEnv,
  slotPortReport,
  writeSlotPlaywrightConfig,
} from './heavy-slots.mjs';
import { runOwned } from './owned-process.mjs';
import { partitionByWeight } from './timed-partition.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_DIR = join(REPO_ROOT, 'apps/web');
const PORT = process.env.E2E_PORT ?? process.env.E2E_AFFECTED_PORT ?? '8398';

function git(args) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : '';
}

function changedPaths(explicit) {
  const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  if (explicit.length > 0) return { paths: explicit, source: 'explicit', base };
  const paths = new Set();
  for (const line of git(['status', '--porcelain=v1']).split('\n')) {
    if (line === '') continue;
    const entry = line.slice(3).trim();
    for (const side of entry.split(' -> ')) paths.add(side.trim());
  }
  if (base !== '') {
    for (const p of git(['diff', '--name-only', `${base}..HEAD`]).split('\n')) {
      if (p !== '') paths.add(p);
    }
  }
  return { paths: [...paths], source: 'git (working tree + branch vs origin/main)', base };
}

function readAtBase(base, path) {
  if (base === '') return null;
  const res = spawnSync('git', ['show', `${base}:${path}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return res.status === 0 ? res.stdout : null;
}

function readInTree(path) {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

function shardOf(selection, shard) {
  const [index, count] = shard.split('/').map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error(`[e2e:affected] --shard expects i/n with 1 <= i <= n, got ${shard}`);
    process.exit(2);
  }
  const weights = JSON.parse(
    readFileSync(join(REPO_ROOT, 'scripts/e2e-shard-weights.json'), 'utf8'),
  );
  return partitionByWeight(selection, weights, count)[index - 1];
}

async function runPlaywright(specs, full) {
  const args = ['exec', 'playwright', 'test'];
  const env = { ...leaseEnv(lease), E2E_PORT: PORT };
  if (lease !== null) {
    const conflict = slotPortReport({ slot: lease.slot });
    if (conflict !== null) {
      console.error(conflict);
      process.exit(1);
    }
    const slotRun = writeSlotPlaywrightConfig({
      slot: lease.slot,
      env: process.env,
      webDir: WEB_DIR,
    });
    args.push('--config', slotRun.path);
    env.E2E_PORT = String(slotRun.port);
    env.E2E_DIST_DIR = slotRun.distDir;
    console.log(
      `[e2e:affected] slot ${lease.slot}: E2E_PORT=${slotRun.port}, build output ${slotRun.distDir}`,
    );
  }
  args.push('--reporter=list', ...specs.map((spec) => `e2e/${spec}`));
  if (!full) args.push('--workers', process.env.E2E_AFFECTED_WORKERS ?? '2');
  process.exit(await runOwned('pnpm', args, { cwd: WEB_DIR, env, name: 'e2e' }));
}

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const explicit = argv.filter((a) => !a.startsWith('--'));
const shard = argv.find((a) => a.startsWith('--shard='))?.slice('--shard='.length);

if (argv.includes('--check-coverage')) {
  const prefixes = [...FILE_RULES.values(), ...DIR_RULES.map((rule) => rule.specs)].flat();
  prefixes.push('a11y-axe', 'gallery-snapshots', ...SHARED_SURFACE_ONLY);
  const specNames = (explicit.length > 0 ? explicit : listSpecs()).map((path) => basename(path));
  const notSpecs = specNames.filter((name) => !name.endsWith('.spec.ts'));
  const missing = specNames.filter(
    (name) => name.endsWith('.spec.ts') && !prefixes.some((prefix) => name.startsWith(prefix)),
  );
  for (const name of notSpecs)
    console.log(`[e2e:affected] ${name}: not an e2e spec file (expected *.spec.ts)`);
  for (const name of missing)
    console.log(`[e2e:affected] ${E2E_PREFIX}${name}: no family table entry reaches this spec`);
  console.log(`[e2e:affected] coverage: ${missing.length} uncovered spec(s)`);
  process.exit(missing.length + notSpecs.length > 0 ? 1 : 0);
}

const { paths, source, base } = changedPaths(explicit);
if (paths.length === 0) {
  console.log('[e2e:affected] no changed paths — nothing to run.');
  process.exit(0);
}

const allSpecs = listSpecs();
const { full, selection, reasons } = selectSpecs({
  paths,
  allSpecs,
  dependencies: () => {
    const [lockfile, workspace] = DEPENDENCY_FILES;
    return dependencyImpact({
      base: { lockfile: readAtBase(base, lockfile), workspace: readAtBase(base, workspace) },
      head: { lockfile: readInTree(lockfile), workspace: readInTree(workspace) },
    });
  },
  workspace: () => workspacePackages(readInTree(DEPENDENCY_FILES[0])),
});
console.log(`[e2e:affected] changed paths (${source}):`);
console.log(reasons.join('\n'));
if (selection.length === 0) {
  console.log(
    '[e2e:affected] no web e2e surface touched — vitest (`pnpm exec vitest run --changed origin/main`) and CI cover this change.',
  );
  process.exit(0);
}

console.log(
  `[e2e:affected] ${full ? `${selection.length}/${allSpecs.length} specs (full-suite fallback for shared surfaces)` : `${selection.length}/${allSpecs.length} specs`} on the standard fixture-build config, E2E_PORT=${PORT}`,
);
const run = shard === undefined ? selection : shardOf(selection, shard);
if (shard !== undefined) {
  console.log(`[e2e:affected] shard ${shard} runs ${run.length} of them by recorded spec times`);
}
console.log(`  ${run.join(' ')}`);

if (dryRun || run.length === 0) process.exit(0);
const lease = await acquireSlot();
await runPlaywright(run, full);
