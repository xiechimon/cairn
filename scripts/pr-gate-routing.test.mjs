import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const between = (start, end) => {
  const from = source.indexOf(start);
  return source.slice(from, source.indexOf(end, from));
};
const constants = between('const AUTO_MERGE =', 'const FILES_CMD =');
const routing = between('const safety = reviewed.find', 'const checked =');
const sandbox = { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } };

const route = ({ changedFiles, linesChanged = 1, binaryFiles = [], deletedFiles = [] }) =>
  Array.from(
    runInNewContext(
      `${constants}
const matchedProtected = changedFiles.filter(isProtected);
const reviewed = [];
${routing}
humanReasons`,
      { changedFiles, deletedFiles, binaryFiles, linesChanged },
      sandbox,
    ),
  );
const sourceFiles = (n) => Array.from({ length: n }, (_, i) => `apps/web/src/page${i}.ts`);
const evidenceFiles = (n) => Array.from({ length: n }, (_, i) => `docs/verify/2371/run-${i}.txt`);

test('evidence beyond the file cap does not make a patch oversize', () => {
  assert.deepEqual(route({ changedFiles: [...sourceFiles(40), ...evidenceFiles(60)] }), []);
});

test('one source file over the file cap still routes to the owner', () => {
  const reasons = route({ changedFiles: [...sourceFiles(41), ...evidenceFiles(60)] });
  assert.deepEqual(reasons, ['41 files changed (over 40)']);
});

test('the line cap is the caller sum and 801 still routes to the owner', () => {
  assert.deepEqual(route({ changedFiles: sourceFiles(1), linesChanged: 800 }), []);
  assert.deepEqual(route({ changedFiles: sourceFiles(1), linesChanged: 801 }), [
    '801 lines changed (over 800)',
  ]);
});

test('binary files outside docs/verify still route to the owner', () => {
  const [reason] = route({
    changedFiles: [...sourceFiles(1), ...evidenceFiles(1)],
    binaryFiles: [sourceFiles(1)[0], evidenceFiles(1)[0]],
  });
  assert.match(reason, /^binary files outside docs\/verify .*apps\/web\/src\/page0\.ts$/);
});

test('the line command named for callers leaves docs/verify out of the sum', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-gate-lines-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    const write = (path, lines) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), `${'x\n'.repeat(lines)}`);
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    write('seed.txt', 1);
    git('add', 'seed.txt');
    git('commit', '-q', '-m', 'seed');
    write('apps/web/src/page.ts', 5);
    write('docs/verify/2371/run.txt', 900);
    git('add', 'apps/web/src/page.ts', 'docs/verify/2371/run.txt');
    git('commit', '-q', '-m', 'change');
    const { linesCommand, pathspec } = runInNewContext(
      `${source.slice(source.indexOf('const LINES_CMD ='), source.indexOf('// The shared clone'))}
;({ linesCommand: LINES_CMD, pathspec: LINES_PATHSPEC })`,
      {},
      sandbox,
    );
    const [, ...gitArgs] = linesCommand.split(' ');
    const spec = pathspec.split(' ').map((part) => part.replace(/^'|'$/g, ''));
    const rows = git(...gitArgs, 'HEAD~1...HEAD', ...spec)
      .trim()
      .split('\n');
    assert.deepEqual(rows, ['5\t0\tapps/web/src/page.ts']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
