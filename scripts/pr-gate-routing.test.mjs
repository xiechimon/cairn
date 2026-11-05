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
const gatePaths = JSON.parse(readFileSync('packages/shared/merge-gate-paths.json', 'utf8'));
const sandbox = { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } };

const decide = ({ changedFiles, linesChanged = 1, binaryFiles = [], deletedFiles = [] }) =>
  runInNewContext(
    `${constants}
const matchedProtected = changedFiles.filter(isProtected);
const reviewed = [];
${routing}
;({ humanReasons, size: typeof sizeReview })`,
    { args: { gatePaths }, changedFiles, deletedFiles, binaryFiles, linesChanged },
    sandbox,
  );
const route = (input) => Array.from(decide(input).humanReasons);
const sourceFiles = (n) => Array.from({ length: n }, (_, i) => `apps/web/src/page${i}.ts`);
const evidenceFiles = (n) => Array.from({ length: n }, (_, i) => `docs/verify/2371/run-${i}.txt`);

test('a large patch neither routes to the owner nor reports a size review (D68)', () => {
  const decision = decide({ changedFiles: sourceFiles(120), linesChanged: 5000 });
  assert.deepEqual(Array.from(decision.humanReasons), []);
  assert.equal(decision.size, 'undefined');
});

test('a large patch touching a security surface does not route to the owner', () => {
  for (const surface of [
    'apps/server/src/services/secrets.ts',
    'apps/server/src/routes-machine.ts',
    'apps/daemon/src/backend/command-gate.ts',
    'apps/server/src/services/mcp-face.ts',
  ]) {
    const reasons = route({ changedFiles: [...sourceFiles(41), surface], linesChanged: 900 });
    assert.deepEqual(reasons, []);
  }
});

test('binary files outside docs/verify do not route to the owner', () => {
  assert.deepEqual(
    route({
      changedFiles: [...sourceFiles(1), ...evidenceFiles(1)],
      binaryFiles: [sourceFiles(1)[0], evidenceFiles(1)[0]],
    }),
    [],
  );
});

const BASELINES = 'apps/web/e2e/gallery-snapshots.spec.ts-snapshots';

test('gallery snapshot baselines may be binary without the owner', () => {
  const pngs = [
    `${BASELINES}/side-panel-dark-linux.png`,
    `${BASELINES}/side-panel-light-linux.png`,
  ];
  assert.deepEqual(route({ changedFiles: [...sourceFiles(1), ...pngs], binaryFiles: pngs }), []);
});

test('other binaries beside or near the gallery baselines do not route to the owner', () => {
  for (const path of [
    `${BASELINES}/side-panel-dark-linux.js`,
    `${BASELINES}/nested/side-panel-dark-linux.png`,
    'apps/web/e2e/visual-polish.spec.ts-snapshots/rail-linux.png',
    'apps/web/src/gallery-snapshots.spec.ts-snapshots/x.png',
  ])
    assert.deepEqual(route({ changedFiles: [path], binaryFiles: [path] }), [], path);
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
