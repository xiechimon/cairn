import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  baselineRef,
  computeChangedSurfaces,
  matchDispatchedRun,
  parseArgs,
  resolveRequestedSurfaces,
  validateRenderedBaselines,
} from './render-visual-baselines.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

test('parseArgs parses --surfaces forms, --no-apply, --keep-ref, and rejects invalid flags', () => {
  assert.deepEqual(parseArgs([]), {
    ok: true,
    surfaces: [],
    apply: true,
    keepRef: false,
  });
  assert.deepEqual(parseArgs(['--surfaces', 'workbench,thread', '--no-apply', '--keep-ref']), {
    ok: true,
    surfaces: ['workbench', 'thread'],
    apply: false,
    keepRef: true,
  });
  assert.deepEqual(parseArgs(['--surfaces', 'workbench', 'thread', '--no-apply']), {
    ok: true,
    surfaces: ['workbench', 'thread'],
    apply: false,
    keepRef: false,
  });
  assert.deepEqual(parseArgs(['--surfaces=providers,vault']), {
    ok: true,
    surfaces: ['providers', 'vault'],
    apply: true,
    keepRef: false,
  });
  assert.equal(parseArgs(['--surfaces']).ok, false);
  assert.equal(parseArgs(['--surfaces=']).ok, false);
  assert.equal(parseArgs(['--unknown-flag']).ok, false);
});

test('resolveRequestedSurfaces validates against registry surfaces and deduplicates', () => {
  const registry = [{ id: 'workbench' }, { id: 'thread' }, { id: 'vault' }];
  assert.deepEqual(resolveRequestedSurfaces([], registry), []);
  assert.deepEqual(resolveRequestedSurfaces(['thread', 'workbench', 'thread'], registry), [
    'thread',
    'workbench',
  ]);
  assert.throws(
    () => resolveRequestedSurfaces(['workbench', 'missing-surface'], registry),
    /missing-surface/,
  );
});

test('baselineRef scopes push target per invocation under refs/heads/baselines/ and never preflight/', () => {
  const explicit = baselineRef('m-0123abcd/feature-lane', 'deadbeef0102');
  assert.equal(explicit, 'refs/heads/baselines/m-0123abcd/feature-lane/deadbeef0102');
  assert.ok(!explicit.startsWith('refs/heads/preflight/'));
  const first = baselineRef('m-0123abcd/feature-lane');
  const second = baselineRef('m-0123abcd/feature-lane');
  assert.notEqual(first, second);
  assert.match(first, /^refs\/heads\/baselines\/m-0123abcd\/feature-lane\/[0-9a-f]{12}$/);
});

test('matchDispatchedRun requires exact sha and ref title and avoids prefix collisions', () => {
  const sha = 'a'.repeat(40);
  const ref = 'refs/heads/baselines/m-0123abcd/lane';
  const matched = matchDispatchedRun(
    [
      {
        id: 10,
        event: 'workflow_dispatch',
        display_title: `visual-baselines ${sha} refs/heads/baselines/m-0123abcd/lane-other`,
      },
      {
        id: 11,
        event: 'workflow_dispatch',
        display_title: `visual-baselines ${sha} ${ref}/other-token`,
      },
      {
        id: 12,
        event: 'workflow_dispatch',
        display_title: `visual-baselines ${'b'.repeat(40)} ${ref}`,
      },
      {
        id: 13,
        event: 'push',
        display_title: `visual-baselines ${sha} ${ref}`,
      },
      {
        id: 14,
        event: 'workflow_dispatch',
        display_title: `visual-baselines ${sha} ${ref}`,
      },
    ],
    { sha, ref },
  );
  assert.equal(matched?.id, 14);
  assert.equal(
    matchDispatchedRun(
      [
        {
          id: 10,
          event: 'workflow_dispatch',
          display_title: `visual-baselines ${sha} refs/heads/baselines/m-0123abcd/lane-other`,
        },
      ],
      { sha, ref },
    ),
    null,
  );
});

test('validateRenderedBaselines requires both themes for every expected surface', () => {
  validateRenderedBaselines(
    [{ name: 'workbench-light-linux.png' }, { name: 'workbench-dark-linux.png' }],
    ['workbench'],
  );
  assert.throws(
    () => validateRenderedBaselines([{ name: 'workbench-dark-linux.png' }], ['workbench']),
    /workbench-light-linux\.png/,
  );
  assert.throws(() => validateRenderedBaselines([], ['workbench']), /workbench-light-linux\.png/);
  assert.throws(() => validateRenderedBaselines([], []), /no expected surface/i);
});

test('computeChangedSurfaces extracts unique sorted ids for Visual-Surfaces trailer', () => {
  const ids = computeChangedSurfaces([
    'apps/web/e2e/visual-baseline.spec.ts-snapshots/thread-dark-linux.png',
    'apps/web/e2e/visual-baseline.spec.ts-snapshots/workbench-light-linux.png',
    'apps/web/e2e/visual-baseline.spec.ts-snapshots/thread-light-linux.png',
    'apps/web/src/board/home-c.tsx',
  ]);
  assert.deepEqual(ids, ['thread', 'workbench']);
});

test('visual-baselines workflow uses read-only dispatch, pinned actions, env inputs, and uploads PNGs', () => {
  const raw = readFileSync(join(REPO_ROOT, '.github/workflows/visual-baselines.yml'), 'utf8');
  const doc = parse(raw);
  assert.equal(doc.name, 'visual-baselines');
  const ghExpr = (expr) => `$${`{{ ${expr} }}`}`;
  assert.equal(doc['run-name'], `visual-baselines ${ghExpr('inputs.sha')} ${ghExpr('inputs.ref')}`);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.deepEqual(doc.concurrency, {
    group: `visual-baselines-${ghExpr('inputs.ref')}`,
    'cancel-in-progress': true,
  });
  const job = doc.jobs?.render;
  assert.ok(job, 'render job missing');
  assert.equal(job['runs-on'], 'ubuntu-latest');
  for (const step of job.steps ?? []) {
    if (step.uses && !step.uses.startsWith('./')) {
      assert.match(step.uses, /@[0-9a-f]{40}\b/, `action ${step.uses} must be SHA-pinned`);
    }
    if (typeof step.run === 'string') {
      assert.ok(
        !step.run.includes(`$${'{{ inputs.'}`),
        'shell steps must read inputs via env, not ${{',
      );
    }
  }
  const hasPlaywrightInstall = (job.steps ?? []).some(
    (step) => step.uses === './.github/actions/playwright-chromium',
  );
  assert.ok(hasPlaywrightInstall, 'must use ./.github/actions/playwright-chromium');
  const renderStep = (job.steps ?? []).find(
    (step) => typeof step.run === 'string' && step.run.includes('--update-snapshots'),
  );
  assert.ok(renderStep, 'must run playwright --update-snapshots');
  assert.match(renderStep.run, /e2e\/visual-baseline\.spec\.ts/);
  const uploadStep = (job.steps ?? []).find(
    (step) => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact@'),
  );
  assert.ok(uploadStep, 'must upload rendered PNG artifact');
  assert.equal(uploadStep.with?.path, 'apps/web/e2e/visual-baseline.spec.ts-snapshots/*.png');
});

test('visual-baseline spec collects filtered surfaces and rejects unknown ids via playwright --list', () => {
  const root = makeTestTempDir('visual-baseline-spec-list-');
  const webRoot = join(REPO_ROOT, 'apps/web');
  const cfgPath = join(root, 'list-only.config.mjs');
  const registry = JSON.parse(
    readFileSync(join(webRoot, 'e2e/visual-surfaces.json'), 'utf8'),
  ).surfaces;
  try {
    writeFileSync(
      cfgPath,
      `export default { testDir: ${JSON.stringify(join(webRoot, 'e2e'))} };\n`,
    );
    const listWithFilter = (value) =>
      spawnSync(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', cfgPath, '--list', 'visual-baseline.spec.ts'],
        {
          cwd: webRoot,
          encoding: 'utf8',
          env: { ...process.env, VISUAL_SURFACES: value },
        },
      );

    const filtered = listWithFilter('workbench');
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.match(filtered.stdout, /workbench light pixels stay on baseline/);
    assert.match(filtered.stdout, /workbench dark pixels stay on baseline/);
    assert.doesNotMatch(filtered.stdout, /thread light pixels stay on baseline/);
    assert.match(filtered.stdout, /Total: 2 tests in 1 file/);

    const unknown = listWithFilter('nonexistent-surface');
    assert.notEqual(unknown.status, 0);
    assert.match(
      `${unknown.stdout}\n${unknown.stderr}`,
      /Unknown VISUAL_SURFACES id\(s\): nonexistent-surface/,
    );

    const unfiltered = listWithFilter('');
    assert.equal(unfiltered.status, 0, unfiltered.stderr);
    assert.match(unfiltered.stdout, new RegExp(`Total: ${registry.length * 2} tests in 1 file`));
  } finally {
    releaseTestTempDir(root);
  }
});

test('CLI protects uncommitted snapshots, requires complete theme pairs, and cleans only its own remote ref', () => {
  const root = makeTestTempDir('render-visual-baselines-');
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const artifact = join(root, 'artifact');
  const ghCalls = join(root, 'gh-calls.jsonl');
  try {
    mkdirSync(bare, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(artifact, { recursive: true });
    execFileSync('git', ['init', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
    execFileSync('git', ['clone', bare, work], { encoding: 'utf8' });
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 'xiechimon',
      GIT_AUTHOR_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'xiechimon',
      GIT_COMMITTER_EMAIL: '157263579+xiechimon@users.noreply.github.com',
      VISUAL_BASELINES_POLL_SECONDS: '0.02',
    };
    const git = (args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', env }).trim();

    mkdirSync(join(work, 'apps/web/src/board'), { recursive: true });
    mkdirSync(join(work, 'apps/web/e2e/visual-baseline.spec.ts-snapshots'), { recursive: true });
    writeFileSync(
      join(work, 'apps/web/e2e/visual-surfaces.json'),
      JSON.stringify({ surfaces: [{ id: 'workbench' }, { id: 'thread' }] }),
    );
    writeFileSync(join(work, 'apps/web/src/board/home-c.tsx'), 'export const HomeC = 1;\n');
    const wbDark = join(
      work,
      'apps/web/e2e/visual-baseline.spec.ts-snapshots/workbench-dark-linux.png',
    );
    const wbLight = join(
      work,
      'apps/web/e2e/visual-baseline.spec.ts-snapshots/workbench-light-linux.png',
    );
    const threadDark = join(
      work,
      'apps/web/e2e/visual-baseline.spec.ts-snapshots/thread-dark-linux.png',
    );
    writeFileSync(wbDark, 'old-wb-dark');
    writeFileSync(wbLight, 'old-wb-light');
    writeFileSync(threadDark, 'old-thread-dark');
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'chore: seed visual surfaces']);
    git(['push', '--quiet', '-u', 'origin', 'main']);

    writeFileSync(join(artifact, 'workbench-dark-linux.png'), 'new-wb-dark');
    writeFileSync(join(artifact, 'workbench-light-linux.png'), 'new-wb-light');
    writeFileSync(join(artifact, 'thread-dark-linux.png'), 'new-thread-dark');

    const dispatchState = join(root, 'last-dispatch.json');
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghCalls)}, JSON.stringify(args) + '\\n');
if (args[0] === 'workflow' && args[1] === 'run') {
  const fields = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-f' && args[i + 1]) {
      const [k, ...rest] = args[i + 1].split('=');
      fields[k] = rest.join('=');
      i += 1;
    }
  }
  fs.writeFileSync(${JSON.stringify(dispatchState)}, JSON.stringify(fields));
  process.exit(0);
}
if (args[0] === 'api' && args[1].includes('/workflows/visual-baselines.yml/runs')) {
  const fields = JSON.parse(fs.readFileSync(${JSON.stringify(dispatchState)}, 'utf8'));
  const sha = fields.sha || '';
  const ref = fields.ref || '';
  console.log(JSON.stringify({ workflow_runs: [
    { id: 404, event: 'workflow_dispatch', display_title: 'visual-baselines ' + sha + ' ' + ref + '-other' },
    { id: 505, event: 'workflow_dispatch', display_title: 'visual-baselines ' + sha + ' ' + ref },
  ] }));
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'watch') {
  if (process.env.STUB_DIRTY_DURING_WATCH === '1') {
    fs.writeFileSync(${JSON.stringify(wbDark)}, 'concurrent-local-edit');
  }
  if (process.env.STUB_WATCH_FAIL === '1') process.exit(1);
  process.exit(0);
}
if (args[0] === 'run' && args[1] === 'download') {
  const dirAt = args.indexOf('-D');
  const dest = args[dirAt + 1];
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(${JSON.stringify(artifact)})) {
    if (process.env.STUB_MISSING_LIGHT === '1' && name === 'workbench-light-linux.png') continue;
    fs.copyFileSync(path.join(${JSON.stringify(artifact)}, name), path.join(dest, name));
  }
  process.exit(0);
}
process.exit(1);
`,
      { mode: 0o755 },
    );

    const cliScript = join(REPO_ROOT, 'scripts/ops/render-visual-baselines.mjs');
    writeFileSync(join(work, 'apps/web/src/board/home-c.tsx'), 'export const HomeC = 2;\n');
    const dirtySrc = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(dirtySrc.status, 0);
    assert.match(dirtySrc.stderr, /uncommitted/i);

    git(['add', 'apps/web/src/board/home-c.tsx']);
    git(['commit', '--quiet', '-m', 'fix(web): tweak workbench']);
    const headSha = git(['rev-parse', 'HEAD']);

    writeFileSync(wbDark, 'local-uncommitted-png');
    const dirtySnap = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env,
    });
    assert.notEqual(dirtySnap.status, 0);
    assert.match(dirtySnap.stderr, /uncommitted/i);
    assert.equal(readFileSync(wbDark, 'utf8'), 'local-uncommitted-png');
    writeFileSync(wbDark, 'old-wb-dark');

    const failInit = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...env, STUB_WATCH_FAIL: '1' },
    });
    assert.notEqual(failInit.status, 0);
    const id = readFileSync(join(home, '.config/cairn-dev/lane-machine-id'), 'utf8').trim();
    const siblingRef = `refs/heads/baselines/${id}/work/keep-sibling`;
    git(['push', '--quiet', 'origin', `${headSha}:${siblingRef}`]);

    const failMissingLight = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...env, STUB_MISSING_LIGHT: '1' },
    });
    assert.notEqual(failMissingLight.status, 0);
    assert.match(failMissingLight.stderr, /workbench-light-linux\.png/);
    assert.equal(readFileSync(wbDark, 'utf8'), 'old-wb-dark');
    assert.equal(git(['ls-remote', 'origin', 'refs/heads/baselines/*']).split('\n').length, 1);

    const failConcurrentEdit = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...env, STUB_DIRTY_DURING_WATCH: '1' },
    });
    assert.notEqual(failConcurrentEdit.status, 0);
    assert.match(failConcurrentEdit.stderr, /uncommitted snapshot edits appeared/i);
    assert.equal(readFileSync(wbDark, 'utf8'), 'concurrent-local-edit');
    writeFileSync(wbDark, 'old-wb-dark');

    const okResult = spawnSync(process.execPath, [cliScript, '--surfaces', 'workbench'], {
      cwd: work,
      encoding: 'utf8',
      env,
    });
    assert.equal(okResult.status, 0, okResult.stderr);
    assert.match(okResult.stdout, /watching visual-baselines\.yml run 505/);
    assert.match(okResult.stdout, /Visual-Surfaces: workbench/);
    assert.equal(readFileSync(wbDark, 'utf8'), 'new-wb-dark');
    assert.equal(readFileSync(wbLight, 'utf8'), 'new-wb-light');
    assert.equal(readFileSync(threadDark, 'utf8'), 'old-thread-dark');

    const remainingRefs = git(['ls-remote', 'origin', 'refs/heads/baselines/*'])
      .split('\n')
      .filter(Boolean);
    assert.equal(remainingRefs.length, 1);
    assert.ok(remainingRefs[0].endsWith(siblingRef));

    const calls = readFileSync(ghCalls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const dispatch = calls.filter((entry) => entry[0] === 'workflow' && entry[1] === 'run').at(-1);
    assert.ok(dispatch, 'expected gh workflow run invocation');
    assert.ok(dispatch.includes('--ref') && dispatch.includes('main'));
    assert.ok(
      dispatch.some((item) =>
        new RegExp(`^ref=refs/heads/baselines/${id}/work/[0-9a-f]{12}$`).test(item),
      ),
    );
    assert.ok(dispatch.includes(`sha=${headSha}`));
    assert.ok(dispatch.includes('surfaces=workbench'));
  } finally {
    releaseTestTempDir(root);
  }
});
