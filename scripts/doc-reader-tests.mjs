import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GENERATED_DOCS = new Set([
  'docs/feature-map.md',
  '.claude/skills/verify-cairn/feature-map.md',
  'docs/CANON.md',
]);

const LOCALLY_RED = new Set([
  'apps/daemon/test/local-executor.test.ts',
  'apps/daemon/test/workspace-hooks.test.ts',
  'apps/daemon/test/local-merge.test.ts',
  'integration/test/g2t2-local-lifecycle.test.ts',
  'integration/test/routing-boundary.test.ts',
  'docs/research/assets/2136/review-check.test.mjs',
]);

export function docReaderTests(docPaths, grep) {
  const readers = new Set();
  for (const doc of docPaths.filter((path) => path.includes('/') && !GENERATED_DOCS.has(path))) {
    for (const file of grep(doc)) {
      if (!file.startsWith('integration/') && !LOCALLY_RED.has(file)) readers.add(file);
    }
  }
  const all = [...readers].sort();
  return {
    node: all.filter((file) => file.endsWith('.test.mjs')),
    vitest: all.filter((file) => file.endsWith('.test.ts')),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { node, vitest } = docReaderTests(process.argv.slice(2), (doc) => {
    const result = spawnSync(
      'git',
      ['-c', 'color.ui=never', 'grep', '-l', '-F', '-e', doc, '--', '*.test.ts', '*.test.mjs'],
      { cwd: root, encoding: 'utf8' },
    );
    if (result.status === 1) return [];
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.split('\n').filter(Boolean);
  });
  const runs = [
    ...(node.length ? [['node', '--test', ...node]] : []),
    ...(vitest.length ? [['pnpm', 'exec', 'vitest', 'run', ...vitest]] : []),
  ];
  if (runs.length === 0) console.log('[doc-reader-tests] no test reads the changed docs');
  for (const [command, ...args] of runs) {
    console.log(`[doc-reader-tests] ${command} ${args.join(' ')}`);
    const run = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
