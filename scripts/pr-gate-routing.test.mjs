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

const decide = ({
  changedFiles,
  linesChanged = 1,
  binaryFiles = [],
  deletedFiles = [],
  unlisted = [],
}) =>
  runInNewContext(
    `${constants}
const matchedProtected = changedFiles.filter(isProtected);
const reviewed = unlisted.length
  ? [{ key: 'safety', review: { changedFiles: [...changedFiles, ...unlisted], deletedFiles: [], binaryFiles: [] } }]
  : [];
${routing}
;({ humanReasons, size: typeof sizeReview })`,
    {
      args: { gatePaths },
      changedFiles,
      deletedFiles,
      binaryFiles,
      linesChanged,
      unlisted,
      log: () => {},
    },
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

const sampleOf = (glob) =>
  glob.endsWith('/**') ? `${glob.slice(0, -3)}/owner-route.txt` : glob.replaceAll('*', 'sample');

const ownerClasses = () => {
  const named = gatePaths.ownerRoute;
  const queue = gatePaths.humanQueue;
  return {
    'ci and merge machinery': named.ciAndMergeMachinery,
    'eval ruler': named.evalRuler,
    credentials: queue.credentials,
    machineAndCommandBoundary: queue.machineAndCommandBoundary,
    externalEntryAuth: queue.externalEntryAuth,
  };
};

test('each owner-route class routes to the owner and names the class', () => {
  for (const [label, globs] of Object.entries(ownerClasses())) {
    for (const glob of globs) {
      const path = sampleOf(glob);
      assert.deepEqual(route({ changedFiles: [path] }), [`owner route (${label}): ${path}`], glob);
    }
  }
});

test('a non-sensitive path still auto-merges, including other protected paths', () => {
  for (const path of [
    'apps/web/src/a.ts',
    'scripts/x.mjs',
    'docs/spec/28.md',
    'apps/server/src/db/client.ts',
    'scripts/ops/deploy-self.sh',
    'apps/server/src/services/harness-eval-sample.ts',
    '.github/CODEOWNERS',
    'README.md',
    'scripts/ops/review-gate-extra/foo.mjs',
  ])
    assert.deepEqual(route({ changedFiles: [path] }), [], path);
});

test('a sensitive file beside product source routes only for that file', () => {
  assert.deepEqual(
    route({
      changedFiles: [...sourceFiles(41), 'apps/server/src/services/secrets.ts'],
      linesChanged: 900,
    }),
    ['owner route (credentials): apps/server/src/services/secrets.ts'],
  );
});

test('owner-route matching folds case', () => {
  const path = 'apps/server/src/services/Secrets.ts';
  assert.deepEqual(route({ changedFiles: [path] }), [`owner route (credentials): ${path}`]);
});

test('a sensitive file the caller omitted still routes to the owner', () => {
  assert.deepEqual(
    route({ changedFiles: ['apps/web/src/a.ts'], unlisted: ['apps/server/src/lib/keys.ts'] }),
    ['owner route (credentials): apps/server/src/lib/keys.ts'],
  );
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
