import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ALLOWLIST_PATH = resolve(import.meta.dirname, 'dead-runtime-exports-allowlist.json');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  '.vite',
  '.turbo',
  'drizzle',
]);
const REF_EXT = /\.(?:[cm]?[jt]sx?|html)$/;
const DECL_ROOTS = ['packages/shared/src', 'apps/server/src', 'apps/daemon/src', 'apps/web/src'];
const REF_ROOTS = ['apps', 'packages', 'integration', 'eval', 'scripts', 'ops', '.claude'];
const DECL_RE =
  /^export\s+(?:(?:async\s+)?function|(?:abstract\s+)?class|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/;
const REEXPORT_RE = /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+/;
const IDENT_RE = /\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (REF_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

function normalizeRel(rootDir, fullPath) {
  return relative(rootDir, fullPath).replaceAll('\\', '/');
}

export function scanDeadRuntimeExports(rootDir = ROOT, allowlist = []) {
  if (
    !Array.isArray(allowlist) ||
    allowlist.some(
      (entry) =>
        typeof entry?.path !== 'string' ||
        typeof entry?.name !== 'string' ||
        typeof entry?.reason !== 'string' ||
        !entry.reason.trim(),
    )
  ) {
    throw new Error('Allowlist entries require path, name and reason');
  }

  const refFiles = REF_ROOTS.flatMap((rel) => walk(join(rootDir, rel)));
  const decls = [];
  const counts = new Map();

  for (const full of refFiles) {
    const rel = normalizeRel(rootDir, full);
    const lines = readFileSync(full, 'utf8').split('\n');
    const isDeclScope =
      DECL_ROOTS.some((prefix) => rel.startsWith(`${prefix}/`)) &&
      !rel.endsWith('.d.ts') &&
      !rel.startsWith('apps/web/src/components/ui/');

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (REEXPORT_RE.test(line.trimStart())) continue;
      let declName = null;
      if (isDeclScope) {
        const match = DECL_RE.exec(line);
        if (match) {
          declName = match[1];
          decls.push({ path: rel, line: index + 1, name: declName });
        }
      }
      let skippedDecl = false;
      for (const match of line.matchAll(IDENT_RE)) {
        const id = match[0];
        if (!skippedDecl && id === declName) {
          skippedDecl = true;
          continue;
        }
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }

  const dead = decls.filter((decl) => (counts.get(decl.name) ?? 0) === 0);
  const deadKeys = new Set(dead.map((decl) => `${decl.path}:${decl.name}`));
  const allowKeys = new Set(allowlist.map((entry) => `${entry.path}:${entry.name}`));

  const violations = dead.filter((decl) => !allowKeys.has(`${decl.path}:${decl.name}`));
  const stale = allowlist.filter((entry) => !deadKeys.has(`${entry.path}:${entry.name}`));
  return { totalExports: decls.length, violations, stale };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
    const { totalExports, violations, stale } = scanDeadRuntimeExports(ROOT, allowlist);
    for (const item of violations) {
      console.error(`${item.path}:${item.line}: dead runtime export ${item.name}`);
    }
    for (const entry of stale) {
      console.error(
        `scripts/dead-runtime-exports-allowlist.json: stale entry ${entry.path}:${entry.name}`,
      );
    }
    console.log(
      `dead-runtime-exports-gate: ${violations.length} dead runtime export(s), ${stale.length} stale allowlist entry(ies) (${totalExports} exports scanned)`,
    );
    process.exitCode = violations.length > 0 || stale.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`dead-runtime-exports-gate: ${error.message}`);
    process.exitCode = 2;
  }
}
