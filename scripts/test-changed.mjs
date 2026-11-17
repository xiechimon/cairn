import { execFileSync, spawn } from 'node:child_process';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /^(apps|packages)\/[^/]+\/test\/.+\.test\.(ts|tsx|mts|mjs)$/;
const SOURCE_FILE = /^((apps|packages)\/[^/]+)\/src\/.+\.(ts|tsx|mts)$/;
const BUDGET_MS = 10 * 60_000;

export function selectTests(changed, tests) {
  const known = new Set(tests);
  const picked = new Set();
  for (const file of changed) {
    if (TEST_FILE.test(file)) {
      if (known.has(file)) picked.add(file);
      continue;
    }
    const source = SOURCE_FILE.exec(file);
    if (!source) continue;
    const pkg = source[1];
    if (pkg === 'packages/shared') continue;
    const stem = basename(file).replace(/\.(ts|tsx|mts)$/, '');
    if (stem === 'index') continue;
    for (const candidate of tests) {
      if (candidate.startsWith(`${pkg}/test/`) && basename(candidate).includes(stem))
        picked.add(candidate);
    }
  }
  return [...picked].sort();
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function main() {
  const base = process.argv[2] ?? 'origin/main';
  const mergeBase = execFileSync('git', ['merge-base', base, 'HEAD'], { encoding: 'utf8' }).trim();
  const changed = [
    ...git(['diff', '--name-only', mergeBase]),
    ...git(['ls-files', '--others', '--exclude-standard']),
  ];
  const tests = git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'apps',
    'packages',
  ]).filter((file) => TEST_FILE.test(file));
  const selected = selectTests(changed, tests);
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
