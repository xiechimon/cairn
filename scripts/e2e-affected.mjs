#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { mergeBase } from './diff-base.mjs';
import {
  DEPENDENCY_FILES,
  DIR_RULES,
  dependencyImpact,
  E2E_PREFIX,
  FILE_RULES,
  I18N_EN_PATH,
  i18nImpact,
  listSpecs,
  SHARED_SURFACE_ONLY,
  selectSpecs,
  workspacePackages,
} from './e2e-affected-select.mjs';
import { runPlaywright, shardOf } from './e2e-shard-run.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PORT = process.env.E2E_PORT ?? process.env.E2E_AFFECTED_PORT ?? '8398';

function git(args) {
  const res = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return res.status === 0 ? res.stdout : '';
}

function changedPaths(explicit) {
  const target = process.env.PREPUSH_BASE_SHA || 'origin/main';
  if (/^0{40}$/.test(target)) {
    if (explicit.length > 0) return { paths: explicit, source: 'explicit', base: '' };
    return { paths: ['package.json'], source: `initial push fallback (${target})`, base: '' };
  }
  const base = mergeBase(REPO_ROOT, target);
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
  } else if (paths.size === 0) {
    paths.add('package.json');
  }
  const source =
    target === 'origin/main'
      ? 'git (working tree + branch vs origin/main)'
      : `git (working tree + branch vs ${target})`;
  return { paths: [...paths], source, base };
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

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const explicit = argv.filter((a) => !a.startsWith('--'));
const shard = argv.find((a) => a.startsWith('--shard='))?.slice('--shard='.length);

if (argv.includes('--check-coverage')) {
  const prefixes = [...FILE_RULES.values(), ...DIR_RULES.map((rule) => rule.specs)].flat();
  prefixes.push('a11y-axe', ...SHARED_SURFACE_ONLY);
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
  i18n: () => i18nImpact({ base: readAtBase(base, I18N_EN_PATH), head: readInTree(I18N_EN_PATH) }),
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
await runPlaywright(run, { full, port: PORT });
