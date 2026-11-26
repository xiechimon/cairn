#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mergeBase } from './diff-base.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const FEATURE_MAP = '.claude/skills/verify-cairn/feature-map.json';
const REGISTRY = '.claude/skills/verify-cairn/packaged-journeys.json';
const BASELINE = '.claude/skills/verify-cairn/packaged-journey-baseline.json';
const MODES = ['local-server', 'remote-server'];
const JOURNEY_DIR = 'apps/desktop/scripts/journeys';
const RUNNER_CALL = 'scripts/packaged-journey.mjs';
const PACKAGED_APP_WORKFLOWS = [
  '.github/workflows/desktop-mac.yml',
  '.github/workflows/desktop-release.yml',
];
const UI_ACTION =
  /\.(goto|reload|click|dblclick|fill|press|type|check|uncheck|selectOption|hover|setInputFiles)\(/;
const ASSERTION = /\bassert(\.\w+)?\(|\.waitFor\(/;

function git(args, { cwd = REPO_ROOT, allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function readWorktree(cwd) {
  return (path) => (existsSync(join(cwd, path)) ? readFileSync(join(cwd, path), 'utf8') : null);
}

function drivingPatterns(feature) {
  const testIds = (feature.reach ?? []).flatMap((step) => /testid:([\w-]+)/.exec(step)?.[1] ?? []);
  const routes = Object.values(feature.routes || {})
    .flat()
    .filter((route) => route.startsWith('/') && !/[:*$]/.test(route) && route !== '/app');
  return [
    ...testIds.map((id) => ({
      anchor: id,
      pattern: new RegExp(`getByTestId\\(\\s*['"\`]${id}['"\`]|data-testid=\\\\?["']${id}["'\\\\]`),
    })),
    ...routes.map((route) => ({
      anchor: route,
      pattern: new RegExp(`\\.goto\\([^;]*?['"\`]${route}['"\`?#]`),
    })),
  ];
}

function checkClaim(id, script, source, feature) {
  const patterns = drivingPatterns(feature);
  if (patterns.length === 0) {
    return `${REGISTRY}: ${id} claims ${feature.id}, whose feature-map row has no testid reach step or static route a walk could drive`;
  }
  if (patterns.some(({ pattern }) => pattern.test(source))) return null;
  return `${REGISTRY}: ${id} claims ${feature.id} but ${script} drives none of its test ids or routes in the UI (${patterns.map(({ anchor }) => anchor).join(', ')})`;
}

function validateRegistry(registry, features, read) {
  const errors = [];
  const coverage = new Map();
  const byId = new Map(features.map((row) => [row.id, row]));
  const journeys = registry?.journeys;
  if (journeys === null || typeof journeys !== 'object' || Array.isArray(journeys)) {
    return { errors: [`${REGISTRY}: journeys must be an object`], coverage };
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
    else {
      if (!UI_ACTION.test(source)) errors.push(`${script} performs no UI action`);
      if (!ASSERTION.test(source)) errors.push(`${script} asserts nothing`);
    }
    for (const featureId of journey.features ?? []) {
      const feature = byId.get(featureId);
      if (feature === undefined) {
        errors.push(`${REGISTRY}: ${id} names unknown feature ${featureId}`);
        continue;
      }
      if (source === null) continue;
      const refusal = checkClaim(id, script, source, feature);
      if (refusal !== null) {
        errors.push(refusal);
        continue;
      }
      coverage.set(
        featureId,
        new Set([...(coverage.get(featureId) ?? []), ...(journey.modes ?? [])]),
      );
    }
  }
  for (const workflow of PACKAGED_APP_WORKFLOWS) {
    if (!read(workflow)?.includes(RUNNER_CALL))
      errors.push(`${workflow} does not run ${RUNNER_CALL}, so registered journeys never walk`);
  }
  return { errors, coverage };
}

function ratchetErrors({ features, coverage, baseline, previousBaseline }) {
  const errors = [];
  const listed = new Set(baseline);
  const shipped = new Map(
    features.filter((row) => row.status !== 'planned').map((row) => [row.id, row]),
  );
  for (const id of listed) {
    if (!shipped.has(id))
      errors.push(`${BASELINE}: remove ${id}; it is not a shipped or partial feature`);
  }
  for (const [id, feature] of shipped) {
    const absent = MODES.filter((mode) => !coverage.get(id)?.has(mode));
    if (absent.length === 0) {
      if (listed.has(id))
        errors.push(
          `${BASELINE}: remove ${id}; it now has a journey in both modes and must keep it`,
        );
    } else if (!listed.has(id)) {
      errors.push(
        `${id} (${feature.name}) is not on the baseline and has no packaged-app journey for ${absent.join(' and ')}`,
      );
    }
  }
  if (previousBaseline !== null) {
    const before = new Set(previousBaseline);
    for (const id of listed) {
      if (!before.has(id))
        errors.push(`${BASELINE}: ${id} was added; the list only shrinks, so write its journey`);
    }
  }
  return errors;
}

export function evaluate({ read, previousBaseline = null }) {
  const map = read(FEATURE_MAP);
  const baselineText = read(BASELINE);
  if (map === null) return { errors: [`${FEATURE_MAP} is missing`], covered: [], baseline: [] };
  if (baselineText === null)
    return { errors: [`${BASELINE} is missing`], covered: [], baseline: [] };
  const features = JSON.parse(map).features ?? [];
  const baseline = JSON.parse(baselineText).features;
  const registry = JSON.parse(read(REGISTRY) ?? 'null');
  const { errors, coverage } = validateRegistry(registry, features, read);
  return {
    errors: [...errors, ...ratchetErrors({ features, coverage, baseline, previousBaseline })],
    covered: [...coverage.keys()].sort(),
    baseline,
  };
}

function main(argv) {
  const take = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const cwd = resolve(take('--cwd') ?? REPO_ROOT);
  const configured = take('--base') ?? process.env.PREPUSH_BASE_SHA ?? 'origin/main';
  const base = /^0{40}$/.test(configured) ? null : mergeBase(cwd, configured);
  if (base === null || base === '') {
    console.error(`packaged-journey-gate: no merge-base for ${configured}; refusing to guess`);
    return 1;
  }
  const previous = git(['show', `${base}:${BASELINE}`], { cwd, allowFailure: true });
  const result = evaluate({
    read: readWorktree(cwd),
    previousBaseline: previous === null ? null : JSON.parse(previous).features,
  });
  for (const error of result.errors) console.error(`packaged-journey-gate: ${error}`);
  if (result.errors.length > 0) {
    console.error(
      `packaged-journey-gate: a real walk lives at ${JOURNEY_DIR}/<id>.mjs, is registered in ${REGISTRY}, and drives the feature in the UI`,
    );
    return 1;
  }
  console.log(
    `packaged-journey-gate: ok (${result.covered.length} feature(s) walked, ${result.baseline.length} on the baseline)`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
