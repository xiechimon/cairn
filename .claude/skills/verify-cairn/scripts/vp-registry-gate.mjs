#!/usr/bin/env node
// verify-cairn registry gate (#1402): every file in scripts/ is a registered
// drive case or a support script; no new script is named after a ticket
// (drive-<number>), new cases go into ../vp-registry.json with a script named
// after the feature; the registry has cases, its paths exist, its statuses and
// needs are known; a case that writes into docs/verify needs
// rewrites-evidence; each `vp.mjs drive` line in features/*.md names a
// registered case, and each feature with a recipe is named in it. The
// self-test runs it (vp-selftest.mjs). Pure node stdlib; paths come from this
// file's location, not the caller's cwd.
// Usage: node .claude/skills/verify-cairn/scripts/vp-registry-gate.mjs

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS_DIR = join(SKILL_DIR, 'scripts');
const FEATURES_DIR = join(SKILL_DIR, 'features');
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const COMMITTED = resolve(ROOT, 'docs', 'verify');

// The ticket-named scripts there were when the gate came in. The list does not
// grow: a new case gets a script named after its feature, or reuses one.
const TICKET_NAMED = new Set([
  'drive-1007-pages.mjs',
  'drive-1008-overlay-registry.mjs',
  'drive-1009-a0-live.mjs',
  'drive-1010-select.mjs',
  'drive-1025-plan-first-round.mjs',
  'drive-1030-local-files.mjs',
  'drive-1031-account-controls.mjs',
  'drive-1033-avatar.mjs',
  'drive-1034-thinking-truncate.mjs',
  'drive-1035-zoom-fit.mjs',
  'drive-1050-claude-bin.mjs',
  'drive-1065-zombie-claim.mjs',
  'drive-1094-threads-scroll.mjs',
  'drive-1097-folder-drill.mjs',
  'drive-1102-commit-detail.mjs',
  'drive-1104-unassigned-build.mjs',
  'drive-1106-skill-inject.mjs',
  'drive-1108-concurrency.mjs',
  'drive-1136-stale-sweep.mjs',
  'drive-1137-webhook-tracer.mjs',
  'drive-1138-agent-concurrency.mjs',
  'drive-1169-skills-split.mjs',
  'drive-1170-skill-import.mjs',
  'drive-1171-native-plugin.mjs',
  'drive-1185-import-rollback.mjs',
  'drive-1186-skill-injection.mjs',
  'drive-1208-machine-pin.mjs',
  'drive-1210-local-unreachable.mjs',
  'drive-1213-dual-source.mjs',
  'drive-1241-recommended-concurrency.mjs',
  'drive-1242-project-identity.mjs',
  'drive-1250-persona-verify.mjs',
  'drive-1251-capability-gate.mjs',
  'drive-1257-hang-retry.mjs',
  'drive-1258-fail-links.mjs',
  'drive-1259-1260-binding.mjs',
  'drive-1259-mea-live.mjs',
  'drive-1261-quota-wait.mjs',
  'drive-1262-ansi-error.mjs',
  'drive-1279-restart-combo.mts',
  'drive-1303-chief-unread.mjs',
  'drive-1308-thinking-delta.mjs',
  'drive-1313-empty-review.mjs',
  'drive-1400-chip-word.mjs',
  'drive-902-gate-actor.mjs',
  'drive-903-dispatch-judgment.mjs',
  'drive-904-plan-chain.mjs',
  'drive-918-skill-facts.mjs',
  'drive-919-skills-routing.mjs',
  'drive-920-skills-manifest.mjs',
  'drive-925-pi-policy.mjs',
  'drive-926-convergence.mts',
  'drive-929-930.mjs',
  'drive-943-board-sidebar.mjs',
  'drive-945-detail.mjs',
  'drive-947-secondary.mjs',
  'drive-948-overlay.mjs',
  'drive-949-overlays.mjs',
  'drive-951-detail.mjs',
  'drive-952-finale.mjs',
  'drive-953-sealed.mjs',
]);
const STATUSES = new Set(['current', 'stale', 'host-bound']);
const NEEDS = new Set([
  'stack',
  'fresh-stack',
  'own-stack',
  'daemon',
  'stub-llm',
  'real-llm',
  'github',
  'rewrites-evidence',
  'remote-host',
]);
// `vp.mjs drive <feature> [<case>]`; a placeholder (<feature>) or a flag is not a name.
const DRIVE_LINE = /vp\.mjs drive ([a-z0-9][\w-]*)(?: ([a-z0-9][\w-]*))?/g;

const problems = [];
const problem = (subject, text) => problems.push(`${subject}: ${text}`);

const registry = JSON.parse(readFileSync(join(SKILL_DIR, 'vp-registry.json'), 'utf8'));
const features = registry.features ?? {};
const support = registry.support ?? {};
const cases = Object.entries(features).flatMap(([feature, entry]) =>
  Object.entries(entry.cases ?? {}).map(([name, c]) => ({ id: `${feature}/${name}`, feature, name, c })),
);
if (process.argv.includes('--check-reach')) {
  const explicit = process.argv.slice(process.argv.indexOf('--check-reach') + 1).filter((arg) => arg !== '--');
  const base = process.env.VP_REACH_BASE_SHA || 'origin/main';
  const paths = explicit.length > 0 ? explicit : [
    ...execFileSync('git', ['diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', base, '--'], { cwd: ROOT, encoding: 'utf8' }).split('\0'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0'),
  ];
  const scripts = new Set(cases.map(({ c }) => resolve(ROOT, c.script ?? '')));
  for (const path of new Set(paths)) {
    if (/(?:^|\/)drive-[^/]+\.(?:[cm]?js|[cm]?ts|tsx)$/.test(path) && !scripts.has(resolve(ROOT, path))) {
      problem(path, 'drive script is not a case in vp-registry.json');
    }
  }
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/e2e-affected.mjs'), '--check-coverage', '--', ...paths.filter(Boolean)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  for (const p of problems) console.log(`vp-registry-gate: ${p}`);
  process.exit(problems.length > 0 || result.status !== 0 ? 1 : 0);
}

if (cases.length === 0) problems.push('vp-registry.json has no cases');

const caseScripts = new Set();
for (const { id, c } of cases) {
  const script = resolve(ROOT, c.script ?? '');
  if (!c.script || !existsSync(script)) problem(id, `script ${c.script} does not exist`);
  if (script.startsWith(`${SCRIPTS_DIR}${sep}`)) caseScripts.add(script.slice(SCRIPTS_DIR.length + 1));
  if (!STATUSES.has(c.status)) problem(id, `status ${c.status} is not current, stale or host-bound`);
  const needs = Array.isArray(c.needs) ? c.needs : [];
  if (!Array.isArray(c.needs)) problem(id, 'needs is not a list');
  for (const need of needs) if (!NEEDS.has(need)) problem(id, `unknown need ${need}`);
  const writes = c.evidence?.writes;
  if (writes !== undefined) {
    const path = resolve(ROOT, writes);
    const inside = path === COMMITTED || path.startsWith(`${COMMITTED}${sep}`);
    if (inside && !needs.includes('rewrites-evidence')) {
      problem(id, `writes ${writes} inside docs/verify but does not need rewrites-evidence`);
    }
  }
}

const files = readdirSync(SCRIPTS_DIR);
for (const name of Object.keys(support)) {
  if (!files.includes(name)) problem(`support ${name}`, 'no such file in scripts/');
}
for (const name of files) {
  if (!caseScripts.has(name) && !Object.hasOwn(support, name)) {
    problem(`scripts/${name}`, 'not registered in vp-registry.json (add it as a case of its feature, or under support)');
  }
  if (/^drive-\d/.test(name) && !TICKET_NAMED.has(name)) {
    problem(
      `scripts/${name}`,
      'named after a ticket (drive-<number>); register the case in vp-registry.json with a script named after the feature',
    );
  }
}

const maps = existsSync(FEATURES_DIR) ? readdirSync(FEATURES_DIR).filter((f) => f.endsWith('.md')) : [];
const named = new Map(maps.map((f) => [f, new Set()]));
for (const file of maps) {
  for (const [line, feature, name] of readFileSync(join(FEATURES_DIR, file), 'utf8').matchAll(DRIVE_LINE)) {
    const entry = Object.hasOwn(features, feature) ? features[feature] : undefined;
    if (entry === undefined || (name !== undefined && !Object.hasOwn(entry.cases ?? {}, name))) {
      problem(`features/${file}`, `${line} names no registered case`);
    }
    named.get(file).add(feature);
  }
}
for (const [feature, entry] of Object.entries(features)) {
  if (entry.recipe === null || entry.recipe === undefined) continue;
  const file = entry.recipe.replace(/^features\//, '');
  if (!existsSync(join(SKILL_DIR, entry.recipe))) problem(feature, `recipe ${entry.recipe} does not exist`);
  else if (!named.get(file)?.has(feature)) problem(`features/${file}`, `names no vp.mjs drive ${feature} line`);
}

for (const p of problems) console.log(`vp-registry-gate: ${p}`);
if (problems.length > 0) {
  console.log(`vp-registry-gate: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`vp-registry-gate: OK (${files.length} scripts, ${cases.length} cases, ${maps.length} feature maps)`);
