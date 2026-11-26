#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { mergeBase } from './diff-base.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_PATH = 'apps/web/e2e/visual-surfaces.json';
const SNAPSHOT_DIR = 'apps/web/e2e/visual-baseline.spec.ts-snapshots';
const THEMES = ['light', 'dark'];

function git(args, allowFailure = false) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function registry() {
  return JSON.parse(readFileSync(join(REPO_ROOT, REGISTRY_PATH), 'utf8')).surfaces;
}

export function baselineSurfaceId(file) {
  const match = /^(.+)-(light|dark)-linux\.png$/.exec(basename(file));
  return match === null ? null : { id: match[1], theme: match[2] };
}

function checkedInBaselineExists(id, theme) {
  return existsSync(join(REPO_ROOT, SNAPSHOT_DIR, `${id}-${theme}-linux.png`));
}

function declaredSurfaces(base, head) {
  const declared = new Set();
  for (const line of git(['log', '--format=%B', `${base}..${head}`]).split('\n')) {
    const match = /^Visual-Surfaces:\s*(.+)$/.exec(line.trim());
    if (match === null) continue;
    for (const entry of match[1].split(/[\s,]+/).filter(Boolean)) declared.add(entry);
  }
  return declared;
}

export function baselineDiffErrors({ rows, declared, registered }) {
  const errors = [];
  for (const [status, file] of rows) {
    const parsed = baselineSurfaceId(file);
    if (parsed === null) {
      if (status !== 'D') errors.push(`${file} is not a <surface>-<theme>-linux.png baseline`);
      continue;
    }
    if (status === 'A') {
      if (!registered.has(parsed.id))
        errors.push(`${file} adds a baseline for unregistered surface ${parsed.id}`);
      continue;
    }
    if (status === 'D' && registered.has(parsed.id)) {
      errors.push(`${file} deletes coverage for registered surface ${parsed.id}`);
      continue;
    }
    if (!declared.has(parsed.id) && !declared.has('all')) {
      errors.push(
        `${file} changes ${parsed.id} pixels but no commit in this diff declares Visual-Surfaces: ${parsed.id} (or all)`,
      );
    }
  }
  return errors;
}

export function analyzeBaselineDiff({ base, head = 'HEAD' }) {
  const rows = git([
    'diff',
    '--name-status',
    '--no-renames',
    `${base}..${head}`,
    '--',
    SNAPSHOT_DIR,
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const declared = declaredSurfaces(base, head);
  const registered = new Set(registry().map((surface) => surface.id));
  return baselineDiffErrors({ rows, declared, registered });
}

const SOURCE_EXT = ['.tsx', '.ts'];
const WEB_SRC = 'apps/web/src';
const COMPONENT_FILE = /^apps\/web\/src\/components\/.+\.(tsx|ts)$/;
const PAGE_FILE = /-page\.tsx$/;
const PAGES_WITHOUT_THE_SUFFIX = [
  'apps/web/src/board/home-c.tsx',
  'apps/web/src/board/side-chat.tsx',
  'apps/web/src/chief/chief-conversation.tsx',
];
const RUNTIME_IMPORT =
  /(?:\b(?:import|export)\s+(?!type\b)(?:[\w$*{}\s,]+?\s+from\s+)?|\bimport\(\s*)(['"])(\.[^'"]+)\1/g;

function sourceFiles(dir = join(REPO_ROOT, WEB_SRC)) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE_EXT.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out;
}

function resolveSourceImport(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier.replace(/\.(js|ts|tsx)$/, ''));
  for (const ext of SOURCE_EXT) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of SOURCE_EXT) {
    if (existsSync(join(base, `index${ext}`))) return join(base, `index${ext}`);
  }
  return null;
}

export function importGraph() {
  const dependencies = new Map();
  for (const file of sourceFiles()) {
    const deps = [];
    for (const match of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) {
      const resolved = resolveSourceImport(file, match[2]);
      if (resolved !== null) deps.push(relative(REPO_ROOT, resolved));
    }
    dependencies.set(relative(REPO_ROOT, file), deps);
  }
  return dependencies;
}

export function pageRoots(dependencies) {
  return [...dependencies.keys()]
    .filter((file) => PAGE_FILE.test(file) || PAGES_WITHOUT_THE_SUFFIX.includes(file))
    .sort();
}

export function pagesUsing(componentPath, dependencies) {
  const roots = new Set(pageRoots(dependencies));
  return [...roots].filter((root) => {
    const seen = new Set();
    const queue = [root];
    while (queue.length > 0) {
      const file = queue.pop();
      for (const dependency of dependencies.get(file) ?? []) {
        if (dependency === componentPath) return true;
        if (seen.has(dependency) || roots.has(dependency)) continue;
        seen.add(dependency);
        queue.push(dependency);
      }
    }
    return false;
  });
}

export function sharedComponentCoverageErrors({
  files,
  surfaces,
  dependencies,
  baselineExists = checkedInBaselineExists,
}) {
  const errors = [];
  for (const file of files) {
    if (!COMPONENT_FILE.test(file)) continue;
    const pages = pagesUsing(file, dependencies);
    if (pages.length < 2) continue;
    for (const page of pages) {
      const covering = surfaces.filter((surface) => (surface.sources ?? []).includes(page));
      if (covering.length === 0) {
        errors.push(
          `${file} is used by ${pages.length} pages and ${page} has no visual surface (add one to ${REGISTRY_PATH} with light and dark baselines)`,
        );
        continue;
      }
      for (const surface of covering) {
        for (const theme of THEMES) {
          if (!baselineExists(surface.id, theme)) {
            errors.push(
              `${file} is used by ${page}; surface ${surface.id} ${theme} has no screenshot baseline`,
            );
          }
        }
      }
    }
  }
  return errors;
}

function registryErrors() {
  const errors = [];
  for (const surface of registry()) {
    for (const source of surface.sources ?? []) {
      if (!existsSync(join(REPO_ROOT, source)))
        errors.push(`${REGISTRY_PATH}: ${surface.id} source ${source} does not exist`);
    }
    for (const theme of THEMES) {
      if (!checkedInBaselineExists(surface.id, theme)) {
        errors.push(`${surface.id} ${theme} has no checked-in baseline image`);
      }
    }
  }
  return errors;
}

function main(argv) {
  const take = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const head = take('--head') ?? 'HEAD';
  const configured = take('--base') ?? process.env.PREPUSH_BASE_SHA ?? 'origin/main';
  const base = /^0{40}$/.test(configured) ? null : mergeBase(REPO_ROOT, configured);
  if (base === null || base === '') {
    console.error(`visual-baseline-gate: no merge-base for ${configured}; refusing to guess`);
    return 1;
  }
  const changedFiles = git([
    'diff',
    '--name-only',
    '--no-renames',
    `${base}..${head}`,
    '--',
    'apps/web/src/components',
  ])
    .split('\n')
    .filter(Boolean);
  const errors = [
    ...registryErrors(),
    ...analyzeBaselineDiff({ base, head }),
    ...sharedComponentCoverageErrors({
      files: changedFiles,
      surfaces: registry(),
      dependencies: importGraph(),
    }),
  ];
  for (const error of errors) console.error(`visual-baseline-gate: ${error}`);
  if (errors.length > 0) {
    console.error(
      'visual-baseline-gate: either restore the unnamed baseline, add missing shared-component surface coverage, or name the intended surface in a commit trailer such as Visual-Surfaces: workbench',
    );
    return 1;
  }
  console.log('visual-baseline-gate: ok');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
