#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mergeBase } from './diff-base.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const FEATURE_MAP = '.claude/skills/verify-cairn/feature-map.json';
const REGISTRY = '.claude/skills/verify-cairn/packaged-journeys.json';
const MODES = ['local-server', 'remote-server'];
const JOURNEY_DIR = 'apps/desktop/scripts/journeys';
const RUNNER_CALL = 'scripts/packaged-journey.mjs';
const PACKAGED_APP_WORKFLOWS = [
  '.github/workflows/desktop-mac.yml',
  '.github/workflows/desktop-release.yml',
];

function git(args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function readAt(ref, path, cwd) {
  if (ref === 'HEAD') {
    return existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), 'utf8') : null;
  }
  return git(['show', `${ref}:${path}`], { cwd, allowFailure: true });
}

function readJsonAt(ref, path, cwd) {
  const text = readAt(ref, path, cwd);
  return text === null ? null : JSON.parse(text);
}

function changedPaths(base, head, cwd = REPO_ROOT) {
  return git(['diff', '--name-only', '--no-renames', `${base}..${head}`], { cwd })
    .split('\n')
    .filter(Boolean);
}

function ownsPath(feature, path) {
  const owned = [
    ...Object.values(feature.code ?? {}).flat(),
    ...(feature.verify ?? []),
    ...(feature.evidence ?? []),
  ];
  return owned.some((entry) => {
    if (path === entry) return true;
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(entry);
    return !looksLikeFile && path.startsWith(`${entry}/`);
  });
}

function featureRowsChanged(base, head, cwd) {
  const before = readJsonAt(base, FEATURE_MAP, cwd);
  const after = readJsonAt(head, FEATURE_MAP, cwd);
  if (before === null || after === null)
    return new Set((after?.features ?? []).map((row) => row.id));
  const changed = new Set();
  const byId = new Map((before.features ?? []).map((row) => [row.id, row]));
  for (const row of after.features ?? []) {
    const old = byId.get(row.id);
    if (old === undefined || JSON.stringify(old) !== JSON.stringify(row)) changed.add(row.id);
  }
  return changed;
}

function featureAnchors(feature) {
  const testIds = (feature.reach ?? []).flatMap((step) => /testid:([\w-]+)/.exec(step)?.[1] ?? []);
  const routes = Object.values(feature.routes || {})
    .flat()
    .filter((route) => route.startsWith('/') && !/[:*$]/.test(route) && route !== '/app');
  const anchors = [...testIds, ...routes];
  return anchors.length > 0 ? anchors : [feature.id];
}

function validateRegistry(registry, features, read) {
  if (registry === null) return [];
  const errors = [];
  const byId = new Map(features.map((row) => [row.id, row]));
  const journeys = registry.journeys;
  if (journeys === null || typeof journeys !== 'object' || Array.isArray(journeys)) {
    return [`${REGISTRY}: journeys must be an object`];
  }
  for (const [id, journey] of Object.entries(journeys)) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))
      errors.push(`${REGISTRY}: journey id ${id} is not kebab-case`);
    if (!Array.isArray(journey.features) || journey.features.length === 0)
      errors.push(`${REGISTRY}: ${id} needs at least one feature`);
    if (!Array.isArray(journey.modes) || journey.modes.length === 0)
      errors.push(`${REGISTRY}: ${id} needs at least one mode`);
    for (const mode of journey.modes ?? []) {
      if (!MODES.includes(mode)) errors.push(`${REGISTRY}: ${id} names unknown mode ${mode}`);
    }
    const script = `${JOURNEY_DIR}/${id}.mjs`;
    const source = read(script);
    if (source === null) errors.push(`${REGISTRY}: ${id} has no walk at ${script}`);
    for (const featureId of journey.features ?? []) {
      const feature = byId.get(featureId);
      if (feature === undefined) {
        errors.push(`${REGISTRY}: ${id} names unknown feature ${featureId}`);
        continue;
      }
      const anchors = featureAnchors(feature);
      if (
        source !== null &&
        !anchors.some((anchor) => new RegExp(`['"\`:]${anchor}['"\`?\\]]`).test(source))
      ) {
        errors.push(
          `${REGISTRY}: ${id} claims ${featureId} but ${script} drives none of its anchors (${anchors.join(', ')})`,
        );
      }
    }
  }
  for (const workflow of PACKAGED_APP_WORKFLOWS) {
    if (!read(workflow)?.includes(RUNNER_CALL))
      errors.push(`${workflow} does not run ${RUNNER_CALL}, so registered journeys never walk`);
  }
  return errors;
}

export function coverageByFeature(registry) {
  const coverage = new Map();
  for (const journey of Object.values(registry?.journeys ?? {})) {
    for (const feature of journey.features ?? []) {
      const entry = coverage.get(feature) ?? new Set();
      for (const mode of journey.modes ?? []) entry.add(mode);
      coverage.set(feature, entry);
    }
  }
  return coverage;
}

export function missingCoverage({ registry, features, touched }) {
  const coverage = coverageByFeature(registry);
  const missing = [];
  for (const feature of features) {
    if (!touched.has(feature.id)) continue;
    if (feature.status === 'planned') continue;
    const modes = coverage.get(feature.id) ?? new Set();
    const absent = MODES.filter((mode) => !modes.has(mode));
    if (absent.length > 0) missing.push({ id: feature.id, name: feature.name, modes: absent });
  }
  return missing;
}

export function analyze({ base, head, cwd = REPO_ROOT, coverageFrom = head }) {
  const paths = changedPaths(base, head, cwd);
  const map = readJsonAt(head, FEATURE_MAP, cwd);
  if (map === null) throw new Error(`${FEATURE_MAP} is missing at ${head}`);
  const registry = readJsonAt(coverageFrom, REGISTRY, cwd);
  const registryErrors = validateRegistry(
    registry,
    readJsonAt(coverageFrom, FEATURE_MAP, cwd)?.features ?? [],
    (path) => readAt(coverageFrom, path, cwd),
  );
  const touched = new Set();
  for (const feature of map.features ?? []) {
    if (paths.some((path) => ownsPath(feature, path))) touched.add(feature.id);
  }
  if (paths.includes(FEATURE_MAP)) {
    for (const id of featureRowsChanged(base, head, cwd)) touched.add(id);
  }
  const missing =
    registryErrors.length > 0
      ? []
      : missingCoverage({ registry, features: map.features ?? [], touched });
  return { paths, touched: [...touched].sort(), missing, registryErrors };
}

function main(argv) {
  const take = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const cwd = resolve(take('--cwd') ?? REPO_ROOT);
  const head = take('--head') ?? 'HEAD';
  const configured = take('--base') ?? process.env.PREPUSH_BASE_SHA ?? 'origin/main';
  const base = /^0{40}$/.test(configured) ? null : mergeBase(cwd, configured);
  if (base === null || base === '') {
    console.error(`packaged-journey-gate: no merge-base for ${configured}; refusing to guess`);
    return 1;
  }
  const result = analyze({ base, head, cwd });
  for (const error of result.registryErrors) console.error(`packaged-journey-gate: ${error}`);
  for (const row of result.missing) {
    console.error(
      `packaged-journey-gate: ${row.id} (${row.name}) is touched by this diff but has no current packaged-app journey for ${row.modes.join(' and ')}`,
    );
  }
  if (result.registryErrors.length > 0 || result.missing.length > 0) {
    console.error(
      `packaged-journey-gate: write ${JOURNEY_DIR}/<id>.mjs that walks the feature and register it in ${REGISTRY}, or narrow the diff`,
    );
    return 1;
  }
  console.log(
    `packaged-journey-gate: ok (${result.touched.length} touched feature row(s): ${result.touched.join(', ') || 'none'})`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
