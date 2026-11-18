import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /^(apps|packages)\/[^/]+\/test\/.+\.test\.(ts|tsx|mts|mjs)$/;
const SOURCE_FILE = /^((apps|packages)\/[^/]+)\/src\/.+\.(ts|tsx|mts)$/;
const BUDGET_MS = 10 * 60_000;
const CONTRACT_SOURCES = /^(packages\/shared\/src|apps\/server\/src)\//;
const SCHEMA_CHANGE = /^apps\/server\/(drizzle\/|src\/db\/schema\.ts$)/;
const PROTOCOL_FILE = /^packages\/shared\/src\/protocol\//;
const EXPORT_DECLARATION =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;
const TOOL_NAME_LITERAL = /\bname:\s*['"]([a-z][a-z0-9_]*)['"]/;
const MIN_IDENTIFIER_LENGTH = 5;
const MAX_REFERENCING_TESTS = 40;
const CONTRACT_TESTS = ['packages/shared/test/snapshot.test.ts', 'apps/server/test/wire.test.ts'];

export function declaredIdentifiers(content, changedLines = null) {
  const lines = content.split('\n');
  const identifiers = new Set();
  const nearestBefore = (pattern, line) => {
    for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
      const match = pattern.exec(lines[index]);
      if (match) return match[1];
    }
    return null;
  };
  if (changedLines === null) {
    for (const line of lines) {
      const match = EXPORT_DECLARATION.exec(line);
      if (match) identifiers.add(match[1]);
    }
    return [...identifiers].filter((id) => id.length >= MIN_IDENTIFIER_LENGTH);
  }
  for (const line of changedLines) {
    const exported = nearestBefore(EXPORT_DECLARATION, line);
    if (exported) identifiers.add(exported);
    const tool = nearestBefore(TOOL_NAME_LITERAL, line);
    if (tool) identifiers.add(tool);
  }
  return [...identifiers].filter((id) => id.length >= MIN_IDENTIFIER_LENGTH);
}

export function selectTests(changed, tests, migrationTests = [], referencing = () => []) {
  return selectTestsWithReport(changed, tests, migrationTests, referencing).selected;
}

export function selectTestsWithReport(changed, tests, migrationTests = [], referencing = () => []) {
  const known = new Set(tests);
  const picked = new Set();
  const referenceScores = new Map();
  for (const file of changed) {
    if (SCHEMA_CHANGE.test(file))
      for (const migration of migrationTests) if (known.has(migration)) picked.add(migration);
    if (TEST_FILE.test(file)) {
      if (known.has(file)) picked.add(file);
      continue;
    }
    const source = SOURCE_FILE.exec(file);
    if (!source) continue;
    if (CONTRACT_SOURCES.test(file))
      for (const contract of CONTRACT_TESTS) if (known.has(contract)) picked.add(contract);
    for (const [candidate, score] of referencing(file))
      if (known.has(candidate))
        referenceScores.set(candidate, (referenceScores.get(candidate) ?? 0) + score);
    const pkg = source[1];
    if (pkg === 'packages/shared') continue;
    const stem = basename(file).replace(/\.(ts|tsx|mts)$/, '');
    if (stem === 'index') continue;
    for (const candidate of tests) {
      if (candidate.startsWith(`${pkg}/test/`) && basename(candidate).includes(stem))
        picked.add(candidate);
    }
  }
  const extra = [...referenceScores]
    .filter(([candidate]) => !picked.has(candidate))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidate]) => candidate);
  const room = Math.max(0, MAX_REFERENCING_TESTS - picked.size);
  for (const candidate of extra.slice(0, room)) picked.add(candidate);
  return { selected: [...picked].sort(), dropped: extra.slice(room).sort() };
}

function changedLinesOf(diffText) {
  const lines = [];
  for (const match of diffText.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + Math.max(count, 1); line++) lines.push(line);
  }
  return lines;
}

function buildReferencing({ readSource, diffFor, tests }) {
  const known = new Set(tests);
  return (file) => {
    if (!SOURCE_FILE.test(file) || basename(file).startsWith('index.')) return [];
    let content;
    try {
      content = readSource(file);
    } catch {
      return [];
    }
    const hunks = PROTOCOL_FILE.test(file) ? changedLinesOf(diffFor(file)) : null;
    const scores = new Map();
    for (const identifier of declaredIdentifiers(content, hunks?.length ? hunks : null)) {
      let hits = [];
      try {
        hits = git(['grep', '-l', '-w', '-F', '-e', identifier, '--', 'apps', 'packages']);
      } catch {}
      for (const hit of hits) if (known.has(hit)) scores.set(hit, (scores.get(hit) ?? 0) + 1);
    }
    return [...scores];
  };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const commitAt = args.indexOf('--commit');
  const commit = commitAt === -1 ? null : args[commitAt + 1];
  const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== commitAt + 1);
  let changed;
  let readSource;
  let diffFor;
  if (commit) {
    changed = git(['diff', '--name-only', `${commit}^`, commit]);
    readSource = (file) => execFileSync('git', ['show', `${commit}:${file}`], { encoding: 'utf8' });
    diffFor = (file) =>
      execFileSync('git', ['diff', '-U0', `${commit}^`, commit, '--', file], { encoding: 'utf8' });
  } else {
    const base = positional[0] ?? 'origin/main';
    const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    changed = [
      ...git(['diff', '--name-only', mergeBase]),
      ...git(['ls-files', '--others', '--exclude-standard']),
    ];
    readSource = (file) => readFileSync(file, 'utf8');
    diffFor = (file) =>
      execFileSync('git', ['diff', '-U0', mergeBase, '--', file], { encoding: 'utf8' });
  }
  const tests = git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'apps',
    'packages',
  ]).filter((file) => TEST_FILE.test(file));
  const migrationTests = git(['grep', '-l', 'migrateUpTo(', '--', 'apps/server/test']).filter(
    (file) => TEST_FILE.test(file),
  );
  const referencing = buildReferencing({ readSource, diffFor, tests });
  const { selected, dropped } = selectTestsWithReport(changed, tests, migrationTests, referencing);
  if (dropped.length > 0)
    console.log(
      `test:changed: ${dropped.length} referencing file(s) dropped to stay within budget; CI runs them\n${dropped.join('\n')}`,
    );
  if (dryRun) {
    console.log(`test:changed: ${selected.length} file(s)\n${selected.join('\n')}`);
    return;
  }
  if (selected.length === 0) {
    console.log('test:changed: no related test files; CI runs the full suite');
    return;
  }
  console.log(`test:changed: ${selected.length} file(s)\n${selected.join('\n')}`);
  const child = spawn('pnpm', ['exec', 'vitest', 'run', ...selected], { stdio: 'inherit' });
  const timer = setTimeout(() => {
    console.error(
      `test:changed: over the ${BUDGET_MS / 60_000}-minute budget; stopped. Run the slow file alone and fix it.`,
    );
    child.kill('SIGTERM');
  }, BUDGET_MS);
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    process.exit(signal ? 1 : (code ?? 1));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
