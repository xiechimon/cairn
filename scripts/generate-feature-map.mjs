#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadRepoEvalCoverage, renderEvalCoverage } from './eval-coverage.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SKILL_REL = '.claude/skills/verify-cairn';
const REGISTRY_REL = `${SKILL_REL}/feature-map.json`;
const SKILL_MAP_REL = `${SKILL_REL}/feature-map.md`;
const DOC_REL = 'docs/feature-map.md';
const WEB_SRC_REL = 'apps/web/src';
const APP_REL = `${WEB_SRC_REL}/App.tsx`;
const SETTINGS_REL = `${WEB_SRC_REL}/settings/settings-page.tsx`;
const EN_REL = `${WEB_SRC_REL}/i18n/en.ts`;
const SERVER_SRC_REL = 'apps/server/src';
const WEB_SKIP = new Set(['design', 'fixtures', 'i18n']);

const SLOTS = [
  ['research', 'Research'],
  ['frontendDesign', 'Frontend design'],
  ['backendDesign', 'Backend design'],
];
const STATUSES = ['shipped', 'partial', 'planned'];
const CENTRALITY = {
  1: 'Core loop: phase 1 graduation and the three differentiators',
  2: 'Self-host: phase 2, a stranger installs the app and gets a PR in 10 minutes',
  3: 'Supporting surfaces used every day',
  4: 'Later: phase 3 or peripheral',
};
const FEATURE_KEYS = new Set([
  'id',
  'name',
  'summary',
  'states',
  'centrality',
  'status',
  'code',
  'routes',
  'reach',
  'verify',
  'research',
  'frontendDesign',
  'backendDesign',
  'evidence',
  'batch',
]);
const CODE_KEYS = ['web', 'server', 'daemon', 'other'];
const ROUTE_KINDS = ['web', 'server'];
const STEP = /^(open|settings|click|hover|press|type) (.+)$/;

function fail(lines) {
  for (const line of [lines].flat()) process.stderr.write(`generate-feature-map: ${line}\n`);
  process.exit(1);
}

function exists(rel) {
  return existsSync(join(REPO_ROOT, rel));
}

function read(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

function sourceFiles(rel, out = []) {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) return out;
  if (statSync(abs).isFile()) {
    if (/\.(tsx?|mjs)$/.test(rel)) out.push(rel);
    return out;
  }
  for (const name of readdirSync(abs).sort()) {
    if (WEB_SKIP.has(name) && rel === WEB_SRC_REL) continue;
    sourceFiles(`${rel}/${name}`, out);
  }
  return out;
}

function moduleFile(fromRel, specifier) {
  const base = join(dirname(fromRel), specifier).replace(/\.js$/, '');
  return ['.tsx', '.ts'].map((ext) => `${base}${ext}`).find(exists);
}

function englishTable() {
  const table = new Map();
  if (!exists(EN_REL)) return table;
  for (const match of read(EN_REL).matchAll(
    /^[ \t]*'?([^'\s:][^':\n]*?)'?:[ \t]*'([^'\n]*)',?$/gm,
  )) {
    table.set(match[1], match[2]);
  }
  return table;
}

function settingsSections() {
  if (!exists(SETTINGS_REL)) return [];
  const sections = [];
  let heading = null;
  const text = read(SETTINGS_REL);
  for (const match of text.matchAll(
    /heading:\s*(null|'([^']*)')|\{\s*id:\s*'([a-z0-9-]+)',\s*label:\s*'([^']*)'/g,
  )) {
    if (match[1] !== undefined) heading = match[2] ?? null;
    else sections.push({ id: match[3], label: match[4], heading });
  }
  return sections;
}

function webRoutes(errors) {
  const routes = new Set();
  if (exists(APP_REL)) {
    const app = read(APP_REL);
    const imports = new Map();
    for (const match of app.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)'/g)) {
      for (const name of match[1].split(',').map((part) =>
        part
          .trim()
          .split(/\s+as\s+/)
          .at(-1),
      )) {
        if (name) imports.set(name, match[2]);
      }
    }
    const constant = (name) => {
      const rel = imports.has(name) ? moduleFile(APP_REL, imports.get(name)) : undefined;
      const found = rel
        ? read(rel).match(new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`))
        : null;
      if (!found) errors.push(`cannot resolve the web route constant ${name} in ${APP_REL}`);
      return found ? found[1] : `<${name}>`;
    };
    for (const match of app.matchAll(/\bpath:\s*(?:'([^']*)'|`([^`]*)`|([A-Za-z_$][\w$]*))/g)) {
      const path =
        match[1] ??
        match[2]?.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_, name) => constant(name)) ??
        constant(match[3]);
      if (path !== '*') routes.add(path);
    }
  }
  for (const section of settingsSections()) routes.add(`settings:${section.id}`);
  return [...routes].sort().map((key) => ({ key, label: key }));
}

function serverRoutes() {
  const dir = join(REPO_ROOT, SERVER_SRC_REL);
  if (!existsSync(dir)) return [];
  const methods = new Map();
  for (const name of readdirSync(dir).sort()) {
    if (!/^(app|routes.*)\.ts$/.test(name)) continue;
    const text = read(`${SERVER_SRC_REL}/${name}`);
    for (const match of text.matchAll(
      /\.(get|post|put|patch|delete|all)\(\s*(['`])(\/[^'`]*)\2/g,
    )) {
      if (!methods.has(match[3])) methods.set(match[3], new Set());
      methods.get(match[3]).add(match[1].toUpperCase());
    }
  }
  return [...methods.keys()]
    .sort()
    .map((key) => ({ key, label: `${[...methods.get(key)].sort().join(',')} ${key}` }));
}

function testIdsIn(files) {
  const ids = new Set();
  for (const rel of files) {
    const text = read(rel);
    for (const match of text.matchAll(/\b(?:data-testid|testId)=(?:"([^"]+)"|\{([^{}]*)\})/g)) {
      if (match[1] !== undefined) {
        ids.add(match[1]);
        continue;
      }
      for (const literal of match[2].matchAll(/'([^'\n]+)'|"([^"\n]+)"/g)) {
        ids.add(literal[1] ?? literal[2]);
      }
    }
    for (const match of text.matchAll(/\b(?:data-testid|testId)=\{\s*`([^`]+)`/g)) {
      ids.add(match[1].replace(/\$\{.*$/, '*'));
    }
  }
  return [...ids].sort();
}

function routePattern(key) {
  const source = key
    .split('/')
    .map((part) => {
      if (/^:[\w]+\?$/.test(part)) return '(?:/[^/]+)?';
      if (/^:[\w]+$/.test(part)) return '/[^/]+';
      return part ? `/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : '';
    })
    .join('');
  return new RegExp(`^${source || '/'}$`);
}

function labelsIn(files) {
  const labels = new Set();
  for (const rel of files) {
    for (const match of read(rel).matchAll(/\bt\(\s*'([^'\n]+)'/g)) labels.add(match[1]);
  }
  return labels;
}

function shortcutsIn(files) {
  const keys = new Set();
  for (const rel of files) {
    const text = read(rel);
    for (const match of text.matchAll(/aria-keyshortcuts="([^"]+)"/g)) keys.add(match[1]);
    for (const match of text.matchAll(/\bshortcut(?:=|:\s*)["']([^"']+)["']/g)) {
      keys.add(match[1].toUpperCase());
    }
    for (const match of text.matchAll(
      /(?:metaKey|ctrlKey)[^\n]{0,160}?\.key(?:\.toLowerCase\(\))?\s*===\s*'([a-z0-9])'/g,
    )) {
      keys.add(`Mod+${match[1].toUpperCase()}`);
    }
  }
  return [...keys].sort();
}

function testIdKnown(id, all) {
  return all.some((known) =>
    known.endsWith('*') ? id.startsWith(known.slice(0, -1)) : known === id,
  );
}

function matches(pattern, key) {
  return pattern.endsWith('**') ? key.startsWith(pattern.slice(0, -2)) : pattern === key;
}

function slotKind(value) {
  if (Array.isArray(value)) return value.length > 0 ? 'links' : 'empty';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length !== 1) return 'empty';
    if (keys[0] === 'gap' && typeof value.gap === 'string' && value.gap.trim()) return 'gap';
    if (keys[0] === 'na' && typeof value.na === 'string' && value.na.trim()) return 'na';
  }
  return 'empty';
}

function hasGap(feature) {
  return SLOTS.some(([slot]) => slotKind(feature[slot]) === 'gap');
}

function gapSlots(registry) {
  const slots = new Set();
  for (const feature of registry.features ?? []) {
    for (const [slot] of SLOTS) {
      if (slotKind(feature[slot]) === 'gap') slots.add(`${feature.id}:${slot}`);
    }
  }
  return slots;
}

function collect(registry, errors) {
  const web = webRoutes(errors);
  const server = serverRoutes();
  const appFiles = sourceFiles(WEB_SRC_REL);
  const perFeature = new Map();
  for (const feature of registry.features ?? []) {
    const files = [...new Set((feature.code?.web ?? []).flatMap((rel) => sourceFiles(rel)))];
    perFeature.set(feature.id, {
      testIds: testIdsIn(files),
      shortcuts: shortcutsIn(files),
      webRoutes: web.filter((route) =>
        (feature.routes?.web ?? []).some((p) => matches(p, route.key)),
      ),
    });
  }
  return {
    routes: { web, server },
    sections: settingsSections(),
    english: englishTable(),
    testIds: testIdsIn(appFiles),
    labels: labelsIn(appFiles),
    shortcuts: shortcutsIn(appFiles),
    perFeature,
  };
}

function validateStep(id, step, facts, errors) {
  const parsed = STEP.exec(step);
  if (!parsed) {
    errors.push(
      `${id}: reach step "${step}" must start with open, settings, click, hover, press or type`,
    );
    return;
  }
  const [, verb, arg] = parsed;
  if (
    verb === 'open' &&
    !facts.routes.web.some((route) => route.key === arg || routePattern(route.key).test(arg))
  ) {
    errors.push(`${id}: reach step "${step}" opens ${arg}, which is not a web route`);
  }
  if (verb === 'settings' && !facts.sections.some((section) => section.id === arg)) {
    errors.push(`${id}: reach step "${step}" names settings section ${arg}, which does not exist`);
  }
  if (verb === 'click' || verb === 'hover') {
    const testId = /^testid:([\w-]+)$/.exec(arg)?.[1];
    const named = /^label:(.+)$/.exec(arg)?.[1];
    if (!testId && !named) {
      errors.push(
        `${id}: reach step "${step}" must target testid:<id> or label:<t() source string>`,
      );
    } else if (testId && !testIdKnown(testId, facts.testIds)) {
      errors.push(
        `${id}: reach step "${step}" targets data-testid ${testId}, which no web source sets`,
      );
    } else if (named && !facts.labels.has(named)) {
      errors.push(
        `${id}: reach step "${step}" targets label ${named}, which no t() call in web source has`,
      );
    }
  }
  if (verb === 'press' && !facts.shortcuts.includes(arg)) {
    errors.push(`${id}: reach step "${step}" presses ${arg}, which no web source declares`);
  }
}

function validate(registry, facts, base) {
  const errors = [];
  if (typeof registry.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(registry.repo)) {
    errors.push('repo must be an owner/name slug');
  }
  const pending = registry.pending ?? {};
  const batches = registry.batches ?? [];
  const features = registry.features ?? [];
  if (!Array.isArray(features) || features.length === 0) {
    errors.push('features must be a non-empty array');
  }
  const batchIds = new Set();
  for (const batch of batches) {
    if (!batch?.id || !batch.title || !batch.scope) {
      errors.push('every batch needs id, title and scope');
    }
    if (batchIds.has(batch.id)) errors.push(`duplicate batch id ${batch.id}`);
    batchIds.add(batch.id);
  }
  const ids = new Set();
  const cited = new Set();
  for (const feature of features) {
    const id = feature.id;
    if (typeof id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
      errors.push(`feature id ${JSON.stringify(id)} must be kebab-case`);
    }
    if (ids.has(id)) errors.push(`duplicate feature id ${id}`);
    ids.add(id);
    for (const key of Object.keys(feature)) {
      if (!FEATURE_KEYS.has(key)) errors.push(`${id}: unknown key ${key}`);
    }
    for (const key of ['name', 'summary']) {
      if (typeof feature[key] !== 'string' || !feature[key].trim()) {
        errors.push(`${id}: ${key} is required`);
      }
    }
    if (!CENTRALITY[feature.centrality]) errors.push(`${id}: centrality must be 1, 2, 3 or 4`);
    if (!STATUSES.includes(feature.status)) {
      errors.push(`${id}: status must be one of ${STATUSES.join(', ')}`);
    }
    const built = feature.status !== 'planned';
    const code = feature.code ?? {};
    for (const key of Object.keys(code)) {
      if (!CODE_KEYS.includes(key)) errors.push(`${id}: unknown code area ${key}`);
      for (const rel of code[key] ?? []) {
        if (!exists(rel)) errors.push(`${id}: code.${key} path ${rel} does not exist`);
      }
    }
    if (built && Object.values(code).flat().length === 0) {
      errors.push(`${id}: a ${feature.status} feature needs at least one code path`);
    }
    if (built && (typeof feature.states !== 'string' || !feature.states.trim())) {
      errors.push(
        `${id}: a ${feature.status} feature needs states: one sentence on what the user sees in each state`,
      );
    }
    if (built && (!Array.isArray(feature.reach) || feature.reach.length === 0)) {
      errors.push(`${id}: a ${feature.status} feature needs reach steps from a fresh page load`);
    }
    for (const step of feature.reach ?? []) validateStep(id, step, facts, errors);
    for (const rel of feature.verify ?? []) {
      if (!exists(rel)) errors.push(`${id}: verify recipe ${rel} does not exist`);
    }
    for (const kind of Object.keys(feature.routes ?? {})) {
      if (!ROUTE_KINDS.includes(kind)) errors.push(`${id}: unknown route kind ${kind}`);
    }
    for (const [slot] of SLOTS) {
      const kind = slotKind(feature[slot]);
      if (kind === 'empty') {
        errors.push(
          `${id}: ${slot} needs links, or an explicit {"gap": "<what is missing>"} or {"na": "<why it does not apply>"}`,
        );
      }
      if (kind !== 'links') continue;
      for (const rel of feature[slot]) {
        cited.add(rel);
        if (!exists(rel) && !(rel in pending)) {
          errors.push(
            `${id}: ${slot} links ${rel}, which does not exist; land it or list it under pending`,
          );
        }
      }
    }
    for (const rel of feature.evidence ?? []) {
      if (!exists(rel)) errors.push(`${id}: evidence path ${rel} does not exist`);
    }
    if (feature.status === 'shipped' && (feature.evidence ?? []).length === 0) {
      errors.push(`${id}: a shipped feature needs at least one evidence path`);
    }
    if (hasGap(feature)) {
      if (!feature.batch) errors.push(`${id}: has gaps, so it needs a batch`);
      else if (!batchIds.has(feature.batch)) {
        errors.push(`${id}: batch ${feature.batch} is not defined`);
      }
    } else if (feature.batch) {
      errors.push(`${id}: has no gaps, so it must not carry a batch`);
    }
  }
  for (const batch of batches) {
    if (!features.some((feature) => feature.batch === batch.id && hasGap(feature))) {
      errors.push(`batch ${batch.id} holds no feature with a gap; remove it`);
    }
  }
  for (const rel of Object.keys(pending).sort()) {
    if (!cited.has(rel)) errors.push(`pending note ${rel} is not cited by any feature; remove it`);
  }
  for (const kind of ROUTE_KINDS) {
    for (const route of facts.routes[kind]) {
      const owned = features.some((feature) =>
        (feature.routes?.[kind] ?? []).some((p) => matches(p, route.key)),
      );
      if (!owned) {
        errors.push(
          `${kind} route ${route.label} maps to no feature; add it to a feature's routes.${kind}`,
        );
      }
    }
    for (const feature of features) {
      for (const pattern of feature.routes?.[kind] ?? []) {
        if (!facts.routes[kind].some((route) => matches(pattern, route.key))) {
          errors.push(`${feature.id}: ${kind} route pattern ${pattern} matches no route`);
        }
      }
    }
  }
  if (base) {
    const inherited = gapSlots(base);
    for (const slot of [...gapSlots(registry)].sort()) {
      if (inherited.has(slot)) continue;
      const [id, name] = slot.split(':');
      errors.push(
        `${id}: ${name} is a new gap; link the research or design before adding or changing the feature`,
      );
    }
  }
  return errors;
}

function cell(text) {
  return String(text)
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function linker(fromDirRel, pending) {
  return (rel) => {
    const href = relative(fromDirRel, rel) || rel;
    return `[${rel}](${href})${rel in pending ? ' (not on main)' : ''}`;
  };
}

function slotText(value, link) {
  const kind = slotKind(value);
  if (kind === 'gap') return `**gap**: ${cell(value.gap)}`;
  if (kind === 'na') return `n/a: ${cell(value.na)}`;
  return value.map(link).join(', ');
}

function slotMark(value, pending) {
  const kind = slotKind(value);
  if (kind === 'gap') return 'gap';
  if (kind === 'na') return 'n/a';
  return value.every((rel) => rel in pending) ? 'yes (not on main)' : 'yes';
}

function sortedFeatures(registry) {
  return [...registry.features].sort(
    (a, b) => a.centrality - b.centrality || (a.id < b.id ? -1 : 1),
  );
}

function label(text, english) {
  const en = english.get(text);
  return en && en !== text ? `\`${text}\` (${en})` : `\`${text}\``;
}

function settingsPath(section, english) {
  return [english.has('设置') ? '设置' : 'Settings', section.heading, section.label]
    .filter(Boolean)
    .map((part) => label(part, english))
    .join(' › ');
}

function codeList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(', ') : 'none';
}

function renderSkillMap(registry, facts) {
  const pending = registry.pending ?? {};
  const link = linker(SKILL_REL, pending);
  const out = [];
  out.push('# Feature map');
  out.push('');
  out.push(
    '> Generated from `feature-map.json` in this directory by `scripts/generate-feature-map.mjs`. Edit the JSON, then run `node scripts/generate-feature-map.mjs`. The `gates` CI job runs it with `--check` and fails when this file drifts from the code.',
  );
  out.push('');
  out.push(
    'Use it to turn a vague report or screenshot into exact steps: find the feature by what is on screen (test ids, labels, routes), follow its reach steps on the stack from `vp.mjs launch`, then drive the recipe under `features/` when one is listed. Reach steps use `open <route>`, `settings <section>`, `click testid:<id>`, `click label:<source label>`, `hover ...`, `press <keys>` and `type <text>`; every route, section, test id, label and key in them is checked against the source. A label is the zh source string passed to `t()`; the English UI shows the translation printed next to it.',
  );
  out.push('');
  out.push(
    'Routes, settings paths, keyboard shortcuts and test ids below are extracted from `apps/web/src`, never typed by hand. `Mod` is Cmd on macOS and Ctrl elsewhere; a single letter is a menu key that works while its menu is open.',
  );
  out.push('');
  out.push('## Settings sections');
  out.push('');
  out.push('| Section | Path in the settings window | Feature |');
  out.push('|---|---|---|');
  for (const section of facts.sections) {
    const owner = registry.features.find((f) =>
      (f.routes?.web ?? []).some((p) => matches(p, `settings:${section.id}`)),
    );
    out.push(
      `| \`${section.id}\` | ${settingsPath(section, facts.english)} | ${owner ? `[${cell(owner.name)}](#${owner.id})` : ''} |`,
    );
  }
  out.push('');
  out.push('## Features');
  out.push('');
  for (const f of sortedFeatures(registry)) {
    const found = facts.perFeature.get(f.id);
    out.push(`### ${f.id}`);
    out.push('');
    out.push(`**${cell(f.name)}** (${f.status}, centrality ${f.centrality}). ${cell(f.summary)}`);
    out.push('');
    if (f.states) out.push(`States: ${cell(f.states)}`);
    out.push('');
    const reach = f.reach ?? [];
    if (reach.length > 0) {
      out.push('Reach:');
      out.push('');
      for (const [index, step] of reach.entries()) out.push(`${index + 1}. \`${step}\``);
      out.push('');
    }
    const settings = facts.sections.filter((section) =>
      (f.routes?.web ?? []).some((p) => matches(p, `settings:${section.id}`)),
    );
    const pages = found.webRoutes.filter((route) => !route.key.startsWith('settings:'));
    out.push(`- Web routes: ${codeList(pages.map((route) => route.key))}`);
    if (settings.length > 0) {
      out.push(`- Settings: ${settings.map((s) => settingsPath(s, facts.english)).join('; ')}`);
    }
    out.push(`- Keyboard shortcuts in its code: ${codeList(found.shortcuts)}`);
    out.push(`- Test ids in its code: ${codeList(found.testIds)}`);
    const verify = f.verify ?? [];
    if (verify.length > 0) out.push(`- Verify recipes: ${verify.map(link).join(', ')}`);
    for (const [slot, name] of SLOTS) out.push(`- ${name}: ${slotText(f[slot], link)}`);
    out.push(`- Evidence: ${codeList(f.evidence ?? [])}`);
    out.push('');
  }
  return out.join('\n');
}

function renderDocMap(registry, evalRows) {
  const pending = registry.pending ?? {};
  const link = linker('docs', pending);
  const features = sortedFeatures(registry);
  const complete = features.filter((f) => !hasGap(f));
  const out = [];
  out.push('# Feature map');
  out.push('');
  out.push(
    `> Generated from \`${REGISTRY_REL}\` by \`scripts/generate-feature-map.mjs\`; do not edit. The agent-facing map with entry points, shortcuts and test ids is \`${SKILL_MAP_REL}\`.`,
  );
  out.push(
    '> `node scripts/generate-feature-map.mjs --check` runs in the CI `gates` job. It fails when a web route, settings section or server route maps to no feature, a route pattern matches nothing, a reach step names a route, section, test id or key the source does not have, a research or design slot is empty, a linked path does not exist, a shipped feature has no evidence, a generated file is stale, or the PR adds a gap its base did not have.',
  );
  out.push('');
  out.push('## Rules');
  out.push('');
  out.push(
    '- A feature is a user-facing capability. Each row names its code, routes, reach steps and states, research, frontend design, backend design and the tests that verify it.',
  );
  out.push(
    '- Each of the three slots holds repository links, or `{"gap": "..."}` when the work is missing, or `{"na": "..."}` when the slot does not apply. A gap needs a batch, and a new feature may not add a gap: research and design come first.',
  );
  out.push(
    '- A note that exists but is not on main yet goes under `pending` with where it lives; it counts as a link and renders as `(not on main)`.',
  );
  out.push(
    '- Route patterns match exactly, or by prefix when they end in `**`. Web routes come from `apps/web/src/App.tsx` and the settings sections from `apps/web/src/settings/settings-page.tsx`; server routes are the literal paths registered in `apps/server/src/app.ts` and `apps/server/src/routes*.ts`.',
  );
  out.push('- Centrality follows the plan: 1 is the core loop and 4 is later or peripheral.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Item | Count |');
  out.push('|---|---|');
  out.push(`| Features | ${features.length} |`);
  for (const status of STATUSES) {
    out.push(`| status ${status} | ${features.filter((f) => f.status === status).length} |`);
  }
  out.push(
    `| research, frontend design and backend design all present or not applicable | ${complete.length} |`,
  );
  for (const [slot, name] of SLOTS) {
    out.push(`| ${name} gaps | ${features.filter((f) => slotKind(f[slot]) === 'gap').length} |`);
  }
  out.push(`| notes cited but not on main | ${Object.keys(pending).length} |`);
  out.push('');
  out.push('## Coverage');
  out.push('');
  out.push(
    '| Feature | Centrality | Status | Research | Frontend design | Backend design | Batch |',
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const f of features) {
    const marks = SLOTS.map(([slot]) => slotMark(f[slot], pending));
    out.push(
      `| [${cell(f.name)}](#${f.id}) | ${f.centrality} | ${f.status} | ${marks.join(' | ')} | ${f.batch ?? ''} |`,
    );
  }
  out.push('');
  out.push('## Gaps by batch');
  out.push('');
  out.push(
    'Batches are ordered by how central their features are. One agent session researches and designs one batch.',
  );
  out.push('');
  for (const batch of registry.batches ?? []) {
    out.push(`### ${batch.id} · ${batch.title}`);
    out.push('');
    out.push(cell(batch.scope));
    out.push('');
    out.push('| Feature | Centrality | Missing |');
    out.push('|---|---|---|');
    for (const f of features.filter((feature) => feature.batch === batch.id)) {
      const missing = SLOTS.filter(([slot]) => slotKind(f[slot]) === 'gap').map(
        ([slot, name]) => `${name}: ${cell(f[slot].gap)}`,
      );
      out.push(`| [${cell(f.name)}](#${f.id}) | ${f.centrality} | ${missing.join('<br>')} |`);
    }
    out.push('');
  }
  out.push('## Research and design links');
  out.push('');
  for (const f of features) {
    out.push(`### ${f.id}`);
    out.push('');
    out.push(`**${cell(f.name)}** (${f.status}). ${cell(f.summary)}`);
    out.push('');
    for (const [slot, name] of SLOTS) out.push(`- ${name}: ${slotText(f[slot], link)}`);
    out.push('');
  }
  out.push('## Notes cited but not on main');
  out.push('');
  const rows = Object.entries(pending).sort(([a], [b]) => (a < b ? -1 : 1));
  if (rows.length === 0) {
    out.push('(None.)');
  } else {
    out.push('| Note | Where it is |');
    out.push('|---|---|');
    for (const [rel, where] of rows) out.push(`| \`${rel}\` | ${cell(where)} |`);
  }
  out.push('');
  out.push(renderEvalCoverage(evalRows, registry.repo).trimEnd());
  out.push('');
  return out.join('\n');
}

function baseRegistry(sha) {
  if (!sha) return null;
  try {
    const text = execFileSync('git', ['show', `${sha}:${REGISTRY_REL}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(text);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? '');
    if (/does not exist|exists on disk, but not in/.test(detail)) return null;
    fail(
      `cannot read ${REGISTRY_REL} at base ${sha}: ${detail.trim()}; fetch the base commit first`,
    );
  }
}

const mode = process.argv[2];
if (mode !== undefined && mode !== '--check') {
  fail(`unknown argument "${mode}" (usage: generate-feature-map.mjs [--check])`);
}

let registry;
try {
  registry = JSON.parse(read(REGISTRY_REL));
} catch (error) {
  fail(`cannot read ${REGISTRY_REL}: ${error.message}`);
}

let coverage;
try {
  coverage = loadRepoEvalCoverage(REPO_ROOT);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (coverage.unlisted.length > 0) {
  fail(
    `hillclimb flow ${coverage.unlisted.map((name) => `"${name}"`).join(', ')} has no capability row`,
  );
}

const extractionErrors = [];
const facts = collect(registry, extractionErrors);
const errors = [
  ...extractionErrors,
  ...validate(registry, facts, baseRegistry(process.env.FEATURE_REGISTRY_BASE_SHA)),
];
if (errors.length > 0) fail(errors);

const outputs = [
  [SKILL_MAP_REL, renderSkillMap(registry, facts)],
  [DOC_REL, renderDocMap(registry, coverage.rows)],
];
if (mode === '--check') {
  const stale = outputs.filter(([rel, content]) => !exists(rel) || read(rel) !== content);
  if (stale.length > 0) {
    fail(
      stale.map(
        ([rel]) =>
          `${rel} differs from ${REGISTRY_REL} and the code; run node scripts/generate-feature-map.mjs and commit the result`,
      ),
    );
  }
  process.stdout.write(
    `feature map: ${registry.features.length} features, registry, code and maps agree\n`,
  );
} else {
  for (const [rel, content] of outputs) writeFileSync(join(REPO_ROOT, rel), content);
  process.stdout.write(
    `wrote ${SKILL_MAP_REL} and ${DOC_REL}: ${registry.features.length} features\n`,
  );
}
