#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import { isLivingDoc, livingText } from './living-docs.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';

export const REGISTRY_REL = 'scripts/doc-retired-terms.json';

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    env: scrubGitEnv({ ...process.env }),
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

const nulList = (buffer) => buffer.toString('utf8').split('\0').filter(Boolean);

const livingFiles = (listing) =>
  nulList(listing)
    .filter((entry) => !entry.startsWith('120000'))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1))
    .filter(isLivingDoc);

function workingDocs(root) {
  const docs = new Map();
  for (const path of livingFiles(git(root, ['ls-files', '-s', '-z']))) {
    try {
      docs.set(path, livingText(path, readFileSync(join(root, path), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return docs;
}

export function treeDocs(root, rev) {
  const paths = livingFiles(git(root, ['ls-tree', '-r', '-z', rev]));
  const blobs = git(root, ['cat-file', '--batch'], {
    input: paths.map((path) => `${rev}:${path}\n`).join(''),
  });
  const docs = new Map();
  let offset = 0;
  for (const path of paths) {
    const headerEnd = blobs.indexOf('\n', offset);
    const size = Number(blobs.subarray(offset, headerEnd).toString().split(' ')[2]);
    docs.set(
      path,
      livingText(path, blobs.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8')),
    );
    offset = headerEnd + size + 2;
  }
  return docs;
}

export function countTerm(docs, pattern) {
  const regex = new RegExp(pattern, 'g');
  const counts = new Map();
  for (const [path, text] of docs) {
    const count = text.match(regex)?.length ?? 0;
    if (count > 0) counts.set(path, count);
  }
  return counts;
}

export function registryFailures(registry) {
  if (!Array.isArray(registry.terms) || registry.terms.length === 0)
    return [`${REGISTRY_REL}: terms must be a non-empty array`];
  const failures = [];
  const ids = new Set();
  for (const { id, pattern, canary, reason } of registry.terms) {
    if ([id, pattern, canary, reason].some((value) => typeof value !== 'string' || !value.trim())) {
      failures.push(`${id ?? 'term'}: id, pattern, canary and reason are required`);
      continue;
    }
    if (ids.has(id)) failures.push(`${id}: duplicate term id`);
    ids.add(id);
    const regex = new RegExp(pattern);
    if (regex.test('')) failures.push(`${id}: pattern matches empty text`);
    else if (!regex.test(canary)) failures.push(`${id}: pattern does not match its canary`);
  }
  return failures;
}

export function evaluate({ registry, headDocs, base, renames }) {
  const failures = registryFailures(registry);
  if (failures.length > 0) return { failures, total: 0, slack: 0 };
  const before = (path) => renames.get(path) ?? path;
  const committed = (id, path) => registry.baseline?.[id]?.[path] ?? 0;
  let total = 0;
  let slack = 0;
  const enforce = (term, allowedFor) => {
    const head = countTerm(headDocs, term.pattern);
    const prior = base ? countTerm(base.docs, term.pattern) : null;
    for (const [path, count] of head) {
      const limits = [allowedFor(path), prior ? (prior.get(before(path)) ?? 0) : null];
      const allowed = Math.min(...limits.filter((limit) => limit !== null));
      if (count > allowed)
        failures.push(
          `${path} has ${count} of retired term ${term.id}, ${allowed} allowed: ${term.reason}`,
        );
    }
    return head;
  };
  for (const term of registry.terms) {
    const head = enforce(term, (path) => committed(term.id, path));
    for (const [path, allowed] of Object.entries(registry.baseline?.[term.id] ?? {})) {
      const count = head.get(path) ?? 0;
      total += count;
      if (count < allowed) slack += allowed - count;
    }
    const known = base?.registry?.terms.some((entry) => entry.id === term.id);
    if (!known) continue;
    for (const [path, count] of Object.entries(registry.baseline?.[term.id] ?? {})) {
      const previous = base.registry.baseline?.[term.id]?.[before(path)] ?? 0;
      if (count > previous)
        failures.push(`${REGISTRY_REL}: baseline grew for ${term.id} in ${path}`);
    }
  }
  for (const term of base?.registry?.terms ?? []) {
    if (!registry.terms.some((entry) => entry.pattern === term.pattern)) enforce(term, () => null);
  }
  return { failures: [...new Set(failures)], total, slack };
}

function renamePairs(root, from, to) {
  const fields = nulList(
    git(root, [
      'diff',
      '--find-renames',
      '--name-status',
      '--diff-filter=R',
      '-z',
      from,
      ...(to ? [to] : []),
    ]),
  );
  const pairs = [];
  for (let i = 0; i + 2 < fields.length; i += 3) pairs.push([fields[i + 1], fields[i + 2]]);
  return pairs;
}

export function renamesSince(root, rev, head, carries = isLivingDoc) {
  const commits = git(root, [
    'rev-list',
    '--first-parent',
    '--reverse',
    `${rev}..${head ?? 'HEAD'}`,
  ])
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
  const steps = [rev, ...commits];
  const spans = commits.map((commit, i) => [steps[i], commit]);
  if (!head) spans.push([steps.at(-1)]);
  const origins = new Map();
  for (const [from, to] of spans) {
    const moved = renamePairs(root, from, to).map(([source, target]) => {
      const origin = origins.get(source) ?? source;
      return [source, target, origin];
    });
    for (const [source] of moved) origins.delete(source);
    for (const [, target, origin] of moved) origins.set(target, origin);
  }
  const present = new Set(
    nulList(git(root, head ? ['ls-tree', '-r', '-z', '--name-only', head] : ['ls-files', '-z'])),
  );
  return new Map([...origins].filter(([, origin]) => carries(origin) && !present.has(origin)));
}

function registryAt(root, rev) {
  if (nulList(git(root, ['ls-tree', '-z', '--name-only', rev, '--', REGISTRY_REL])).length === 0)
    return null;
  return JSON.parse(git(root, ['show', `${rev}:${REGISTRY_REL}`]).toString('utf8'));
}

const readRegistry = (root) => JSON.parse(readFileSync(join(root, REGISTRY_REL), 'utf8'));

export function checkRepo(root, baseRev) {
  const headDocs = workingDocs(root);
  const result = evaluate({
    registry: readRegistry(root),
    headDocs,
    base: baseRev ? { docs: treeDocs(root, baseRev), registry: registryAt(root, baseRev) } : null,
    renames: baseRev ? renamesSince(root, baseRev) : new Map(),
  });
  if (headDocs.size === 0) result.failures.push('no living document found');
  return { ...result, docs: headDocs.size };
}

export function nextBaseline(registry, counts, renames = new Map()) {
  const baseline = {};
  for (const { id } of registry.terms) {
    const previous = registry.baseline?.[id];
    const entries = [...(counts.get(id) ?? [])].sort(([a], [b]) => a.localeCompare(b));
    for (const [path, count] of previous ? entries : []) {
      const allowed = previous[renames.get(path)] ?? previous[path] ?? 0;
      if (count > allowed)
        throw new Error(
          `--write-baseline refuses to grow ${id} in ${path} (${allowed} to ${count}); remove the retired term instead`,
        );
    }
    baseline[id] = Object.fromEntries(entries);
  }
  return { ...registry, baseline };
}

function resolveBase(root) {
  const configured = process.env.PREPUSH_BASE_SHA ?? 'origin/main';
  if (/^0{40}$/.test(configured)) return null;
  const base = mergeBase(root, configured);
  if (!base) throw new Error(`no merge-base between HEAD and ${configured}`);
  return base;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const baseRev = resolveBase(root);
  if (process.argv.includes('--write-baseline')) {
    const registry = readRegistry(root);
    const docs = workingDocs(root);
    const counts = new Map(registry.terms.map((term) => [term.id, countTerm(docs, term.pattern)]));
    const renames = baseRev ? renamesSince(root, baseRev) : new Map();
    writeFileSync(
      join(root, REGISTRY_REL),
      `${JSON.stringify(nextBaseline(registry, counts, renames), null, 2)}\n`,
    );
    console.log(`[doc-retired-terms-gate] wrote ${REGISTRY_REL}`);
    process.exit(0);
  }
  const { failures, total, slack, docs } = checkRepo(root, baseRev);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    console.error(
      `[doc-retired-terms-gate] ${failures.length} failures; living documents describe what is true today, so replace the retired wording, also in text you move or merge`,
    );
    process.exit(1);
  }
  console.log(
    `[doc-retired-terms-gate] ${docs} living docs: ${total} baselined mentions, none new` +
      (slack > 0 ? `; ${slack} resolved, run with --write-baseline to shrink` : ''),
  );
}
