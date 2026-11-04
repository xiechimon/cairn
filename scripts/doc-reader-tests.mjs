import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function docReaderTests(docPaths, grep, knownRed) {
  const readers = new Set();
  for (const doc of docPaths.filter((path) => path.includes('/'))) {
    for (const file of grep(doc)) {
      if (!file.startsWith('integration/') && !knownRed.includes(file)) readers.add(file);
    }
  }
  const all = [...readers].sort();
  return {
    node: all.filter((file) => file.endsWith('.test.mjs')),
    vitest: all.filter((file) => file.endsWith('.test.ts')),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const knownRed = JSON.parse(
    readFileSync(join(root, 'scripts/prepush-known-red.json'), 'utf8'),
  ).map((entry) => entry.file);
  const { node, vitest } = docReaderTests(
    process.argv.slice(2),
    (doc) => {
      const result = spawnSync(
        'git',
        ['-c', 'color.ui=never', 'grep', '-l', '-F', '-e', doc, '--', '*.test.ts', '*.test.mjs'],
        { cwd: root, encoding: 'utf8' },
      );
      if (result.status === 1) return [];
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.split('\n').filter(Boolean);
    },
    knownRed,
  );
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
