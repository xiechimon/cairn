import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../scripts/test-tmpdir.mjs';
import { resolveDevinCap } from './harness/budget.js';
import { resolveDevinBin } from './harness/devin-env.mjs';
import { runLaneTask } from './harness/lane.js';
import { sweepStaleTempDirs } from './harness/snapshot.js';
import type { LaneTask } from './harness/types.js';
import { runEval } from './run.js';
import { scoreLane } from './scorers/lane-checks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

afterAll(cleanupTestTempDirs, 30_000);

const savedEnv: Record<string, string | undefined> = {};
function setEnv(entries: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(entries)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
});

function writeStubDevin(dir: string, scriptBody: string): string {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, 'devin');
  writeFileSync(binPath, `#!/usr/bin/env node\n${scriptBody}\n`);
  chmodSync(binPath, 0o755);
  return binPath;
}

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface FixtureSnapshotRepo {
  repoRoot: string;
  examDir: string;
  parentCommit: string;
  fixCommit: string;
  task: LaneTask;
}

function createFixtureSnapshotRepo(baseDir: string, taskId = 'sample-fix'): FixtureSnapshotRepo {
  const repoRoot = join(baseDir, 'repo');
  const pkgDir = join(repoRoot, 'packages', 'pkg-a');
  const nestedTestDir = join(repoRoot, 'tests', 'nested');
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(nestedTestDir, { recursive: true });
  writeFileSync(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-repo', private: true, type: 'module' }),
  );
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@fixture/pkg-a', type: 'module', main: './index.js' }),
  );
  writeFileSync(
    join(pkgDir, 'index.js'),
    'export function add(a, b) {\n  return String(a) + String(b);\n}\n',
  );
  writeFileSync(
    join(repoRoot, 'existing.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('existing baseline passes', () => {\n  assert.equal(1 + 1, 2);\n});\n",
  );
  writeFileSync(
    join(nestedTestDir, 'regression.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '@fixture/pkg-a';\ntest('existing export exists', () => {\n  assert.equal(typeof add, 'function');\n});\n",
  );

  gitIn(repoRoot, ['init', '-q']);
  gitIn(repoRoot, ['config', 'user.email', 'eval@cairn.dev']);
  gitIn(repoRoot, ['config', 'user.name', 'eval']);
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-qm', 'parent buggy']);
  const parentCommit = gitIn(repoRoot, ['rev-parse', 'HEAD']);

  writeFileSync(
    join(pkgDir, 'index.js'),
    'export function add(a, b) {\n  return Number(a) + Number(b);\n}\n',
  );
  writeFileSync(
    join(nestedTestDir, 'regression.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '@fixture/pkg-a';\ntest('adds numbers numerically', () => {\n  assert.equal(add(2, 3), 5);\n});\n",
  );
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-qm', 'fix add bug']);
  const fixCommit = gitIn(repoRoot, ['rev-parse', 'HEAD']);

  const nmScopeDir = join(repoRoot, 'node_modules', '@fixture');
  mkdirSync(nmScopeDir, { recursive: true });
  symlinkSync(pkgDir, join(nmScopeDir, 'pkg-a'));

  const task: LaneTask = {
    kind: 'lane',
    id: taskId,
    instruction:
      'Fix add in @fixture/pkg-a so add(2, 3) returns numeric 5 instead of concatenating strings.',
    timeoutMs: 20_000,
    source: {
      parentCommit,
      fixCommit,
      testFiles: ['tests/nested/regression.test.mjs'],
      existingTestFiles: ['existing.test.mjs'],
    },
    checks: {
      files: [{ path: 'packages/pkg-a/index.js', contains: 'Number(a)' }],
      commands: ['node --test tests/nested/regression.test.mjs existing.test.mjs'],
    },
    gate: true,
  };

  const examDir = join(repoRoot, 'eval');
  mkdirSync(join(examDir, 'tasks', 'lane', taskId), { recursive: true });
  mkdirSync(join(examDir, 'tasks', 'runtime'), { recursive: true });
  mkdirSync(join(examDir, 'tasks', 'canary'), { recursive: true });
  mkdirSync(join(examDir, 'harness'), { recursive: true });
  mkdirSync(join(examDir, 'scorers'), { recursive: true });
  writeFileSync(join(examDir, 'tasks', 'lane', taskId, 'task.json'), JSON.stringify(task, null, 2));
  writeFileSync(
    join(examDir, 'suite.json'),
    JSON.stringify({
      version: 2,
      dataset: 'fixture-eval',
      repeats: { runtime: 1, lane: 1, canary: 1 },
      expectedCounts: { runtime: 0, lane: 1, canary: 0 },
      devinBudget: { maxSessionsPerRun: 5 },
    }),
  );
  writeFileSync(
    join(examDir, 'harness', 'types.ts'),
    readFileSync(join(ROOT, 'eval', 'harness', 'types.ts'), 'utf8'),
  );
  writeFileSync(
    join(examDir, 'scorers', 'runtime-checks.ts'),
    readFileSync(join(ROOT, 'eval', 'scorers', 'runtime-checks.ts'), 'utf8'),
  );
  writeFileSync(
    join(examDir, 'scorers', 'lane-checks.ts'),
    readFileSync(join(ROOT, 'eval', 'scorers', 'lane-checks.ts'), 'utf8'),
  );
  return { repoRoot, examDir, parentCommit, fixCommit, task };
}

describe('eval lane harness', () => {
  it('materializes parent snapshot as a single-commit repo, repoints workspace symlinks, and excludes node_modules and __pycache__', async () => {
    const dir = makeTestTempDir('eval-snapshot-');
    const fixture = createFixtureSnapshotRepo(dir);
    const devinHome = join(dir, 'devin-home');
    mkdirSync(devinHome, { recursive: true });
    const inspectLog = join(dir, 'inspect.json');
    const bin = writeStubDevin(
      dir,
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const { execFileSync } = require('node:child_process');
      const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
      const headMsg = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const linkTarget = fs.readlinkSync(path.join('node_modules', '@fixture', 'pkg-a'));
      const parentSource = fs.readFileSync(path.join('packages', 'pkg-a', 'index.js'), 'utf8');
      fs.writeFileSync(${JSON.stringify(inspectLog)}, JSON.stringify({
        args: process.argv.slice(2),
        home: process.env.HOME,
        pyBytecode: process.env.PYTHONDONTWRITEBYTECODE,
        count,
        headMsg,
        headSha,
        linkTarget,
        cwd: process.cwd(),
        parentSource,
      }));
      fs.mkdirSync('__pycache__', { recursive: true });
      fs.writeFileSync('__pycache__/cache.pyc', 'x');
      fs.writeFileSync('packages/pkg-a/index.js', 'export function add(a, b) { return Number(a) + Number(b); }\\n');
      `,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      EVAL_DAILY_DEVIN_HOME: devinHome,
    });
    const beforeDirs = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('eval-lane-')));
    const record = await runLaneTask(fixture.task, fixture.examDir, { repoRoot: fixture.repoRoot });
    const afterDirs = readdirSync(tmpdir()).filter(
      (n) => n.startsWith('eval-lane-') && !beforeDirs.has(n),
    );
    expect(afterDirs).toEqual([]);
    expect(record.incomplete).toBeUndefined();
    const info = JSON.parse(readFileSync(inspectLog, 'utf8')) as {
      args: string[];
      home: string;
      pyBytecode: string;
      count: string;
      headMsg: string;
      headSha: string;
      linkTarget: string;
      cwd: string;
      parentSource: string;
    };
    expect(info.args).toContain('--permission-mode');
    expect(info.args[info.args.indexOf('--permission-mode') + 1]).toBe('dangerous');
    expect(info.args).toContain('--process-model');
    expect(info.args[info.args.indexOf('--process-model') + 1]).toBe('in-process');
    expect(info.args).toContain('--respect-workspace-trust');
    expect(info.home).toBe(devinHome);
    expect(info.pyBytecode).toBe('1');
    expect(info.count).toBe('1');
    expect(info.headMsg).toBe('baseline');
    expect(info.headSha).not.toBe(fixture.parentCommit);
    expect(info.headSha).not.toBe(fixture.fixCommit);
    expect(info.parentSource).toContain('String(a) + String(b)');
    expect(info.linkTarget.startsWith(info.cwd)).toBe(true);
    expect(record.lane?.changedFiles).toEqual(['packages/pkg-a/index.js']);
    expect(scoreLane(fixture.task, record).every((c) => c.value === 1)).toBe(true);
  });

  it('defeats agent edits and ancestor/leaf symlinks on hidden tests and restored existing tests', async () => {
    const dir = makeTestTempDir('eval-tamper-');
    const fixture = createFixtureSnapshotRepo(dir, 'tamper-check');
    const outsideDir = join(dir, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    const sentinelFile = join(outsideDir, 'secret.txt');
    writeFileSync(sentinelFile, 'untouched\n');

    const bin = writeStubDevin(
      dir,
      `
      const fs = require('node:fs');
      fs.writeFileSync('packages/pkg-a/index.js', 'export function add(a, b) { return Number(a) + Number(b); }\\n');
      fs.rmSync('tests/nested', { recursive: true, force: true });
      fs.symlinkSync(${JSON.stringify(outsideDir)}, 'tests/nested');
      fs.rmSync('existing.test.mjs', { force: true });
      fs.symlinkSync(${JSON.stringify(sentinelFile)}, 'existing.test.mjs');
      `,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    });
    const record = await runLaneTask(fixture.task, fixture.examDir, { repoRoot: fixture.repoRoot });
    expect(record.incomplete).toBeUndefined();
    expect(readFileSync(sentinelFile, 'utf8')).toBe('untouched\n');
    expect(scoreLane(fixture.task, record).every((c) => c.value === 1)).toBe(true);

    const nopBin = writeStubDevin(
      join(dir, 'nop'),
      `
      const fs = require('node:fs');
      fs.writeFileSync('tests/nested/regression.test.mjs', 'process.exit(0);\\n');
      `,
    );
    setEnv({
      EVAL_DEVIN_BIN: nopBin,
      PATH: `${join(dir, 'nop', 'bin')}:${process.env.PATH ?? ''}`,
    });
    const nopRecord = await runLaneTask(fixture.task, fixture.examDir, {
      repoRoot: fixture.repoRoot,
    });
    expect(nopRecord.incomplete).toBeUndefined();
    const scores = scoreLane(fixture.task, nopRecord);
    expect(scores.find((s) => s.name === 'lane.completed')?.value).toBe(1);
    expect(scores.find((s) => s.name === 'lane.tests_pass')?.value).toBe(0);
    expect(nopRecord.diagnostics).toContain('exit=1');
  });

  it('detects dependency drift as incomplete and reports missing git commits or missing blobs before Devin', async () => {
    const dir = makeTestTempDir('eval-missing-');
    const fixture = createFixtureSnapshotRepo(dir, 'missing-check');
    const invokedMarker = join(dir, 'devin-invoked');
    const bin = writeStubDevin(
      dir,
      `require('node:fs').writeFileSync(${JSON.stringify(invokedMarker)}, 'ran');`,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    });

    const missingParent = await runLaneTask(
      {
        ...fixture.task,
        source: { ...fixture.task.source, parentCommit: 'a'.repeat(40) },
      },
      fixture.examDir,
      { repoRoot: fixture.repoRoot },
    );
    expect(missingParent.incomplete).toContain('missing git commit');
    expect(existsSync(invokedMarker)).toBe(false);

    const missingFix = await runLaneTask(
      {
        ...fixture.task,
        source: { ...fixture.task.source, fixCommit: 'b'.repeat(40) },
      },
      fixture.examDir,
      { repoRoot: fixture.repoRoot },
    );
    expect(missingFix.incomplete).toContain('missing git commit');
    expect(existsSync(invokedMarker)).toBe(false);

    const missingBlob = await runLaneTask(
      {
        ...fixture.task,
        source: { ...fixture.task.source, testFiles: ['tests/does-not-exist.test.mjs'] },
      },
      fixture.examDir,
      { repoRoot: fixture.repoRoot },
    );
    expect(missingBlob.incomplete).toContain('missing blob');

    const driftTask: LaneTask = {
      ...fixture.task,
      checks: {
        files: [],
        commands: [
          'node -e "console.error(\'ERR_MODULE_NOT_FOUND: Cannot find package foo\'); process.exit(1)"',
        ],
      },
    };
    const drift = await runLaneTask(driftTask, fixture.examDir, { repoRoot: fixture.repoRoot });
    expect(drift.incomplete).toContain('dependency drift');

    const cmdFailTask: LaneTask = {
      ...fixture.task,
      checks: {
        files: [{ path: 'missing-file.txt' }],
        commands: ['nonexistent_eval_cmd_xyz'],
        allowPaths: ['packages/pkg-a/**'],
      },
    };
    const cmdBin = writeStubDevin(
      join(dir, 'cmd-fail'),
      `require('node:fs').writeFileSync('existing.test.mjs', 'broken');`,
    );
    setEnv({
      EVAL_DEVIN_BIN: cmdBin,
      PATH: `${join(dir, 'cmd-fail', 'bin')}:${process.env.PATH ?? ''}`,
    });
    const cmdFail = await runLaneTask(cmdFailTask, fixture.examDir, { repoRoot: fixture.repoRoot });
    expect(cmdFail.incomplete).toBeUndefined();
    const cmdScores = scoreLane(cmdFailTask, cmdFail);
    expect(cmdScores.find((s) => s.name === 'lane.files_ok')?.value).toBe(0);
    expect(cmdScores.find((s) => s.name === 'lane.tests_pass')?.value).toBe(0);
    expect(cmdScores.find((s) => s.name === 'lane.diff_ok')?.value).toBe(0);
    expect(cmdFail.diagnostics).toContain('exit=127');
  });

  it('sweeps stale eval-lane temp directories older than 24h while keeping fresh ones', () => {
    const dir = makeTestTempDir('eval-sweep-');
    const oldDir = join(dir, 'eval-lane-old-123');
    const freshDir = join(dir, 'eval-lane-fresh-456');
    const otherDir = join(dir, 'unrelated-789');
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    const nowMs = Date.now();
    const oldTime = new Date(nowMs - 48 * 3600 * 1000);
    utimesSync(oldDir, oldTime, oldTime);
    utimesSync(otherDir, oldTime, oldTime);
    sweepStaleTempDirs(dir, 24 * 3600 * 1000, nowMs);
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(otherDir)).toBe(true);
  });

  it('resolves devin binary from EVAL_DEVIN_BIN -> PATH -> real HOME managed tools before child HOME override', () => {
    const dir = makeTestTempDir('eval-bin-order-');
    const fakeRealHome = join(dir, 'real-home');
    const devinHome = join(dir, 'devin-home');
    mkdirSync(devinHome, { recursive: true });
    const managedDir = join(fakeRealHome, '.cairn', 'tools', 'devin', 'versions', '3000.14.999');
    writeStubDevin(managedDir, 'process.exit(0);');
    mkdirSync(join(fakeRealHome, '.cairn', 'tools', 'devin'), { recursive: true });
    writeFileSync(
      join(fakeRealHome, '.cairn', 'tools', 'devin', 'current.json'),
      JSON.stringify({ version: '3000.14.999' }),
    );
    const overrideDir = join(dir, 'override');
    const overrideBin = writeStubDevin(overrideDir, 'process.exit(0);');
    expect(
      resolveDevinBin({
        EVAL_DEVIN_BIN: overrideBin,
        PATH: '/usr/bin:/bin',
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(overrideBin);
    const pathDir = join(dir, 'path-devin');
    const pathBin = writeStubDevin(pathDir, 'process.exit(0);');
    expect(
      resolveDevinBin({
        PATH: `${join(pathDir, 'bin')}:/usr/bin`,
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(pathBin);
    expect(
      resolveDevinBin({
        PATH: '/nonexistent-eval-bin',
        HOME: fakeRealHome,
        EVAL_DAILY_DEVIN_HOME: devinHome,
      }),
    ).toBe(join(managedDir, 'bin', 'devin'));
  });

  it('classifies confirmation rejection, login failure, quota error, and ENOENT as incomplete, while distinguishing unrecognized non-zero exit and stdout 401', async () => {
    const dir = makeTestTempDir('eval-classify-');
    const fixture = createFixtureSnapshotRepo(dir, 'classify-task');
    const task: LaneTask = { ...fixture.task, timeoutMs: 10_000 };
    const cases = [
      {
        label: 'permission-rejected',
        code: `process.stderr.write('warning: rejected a tool call that requires confirmation\\n'); process.exit(0);`,
        wantIncomplete: true,
      },
      {
        label: 'login-canceled',
        code: `process.stderr.write('Error: Login canceled\\n'); process.exit(1);`,
        wantIncomplete: true,
      },
      {
        label: 'quota-exceeded',
        code: `process.stderr.write('HTTP 429 quota limit reached\\n'); process.exit(1);`,
        wantIncomplete: true,
      },
      {
        label: 'unrecognized-exit-1',
        code: `process.stderr.write('model could not figure out the fix\\n'); process.exit(1);`,
        wantIncomplete: false,
      },
      {
        label: 'stdout-401-only',
        code: `process.stdout.write('Note: HTTP 401 is an auth status code\\n'); process.exit(1);`,
        wantIncomplete: false,
      },
    ];
    for (const c of cases) {
      const caseDir = join(dir, c.label);
      const bin = writeStubDevin(caseDir, c.code);
      setEnv({
        EVAL_DEVIN_BIN: bin,
        PATH: `${join(caseDir, 'bin')}:${process.env.PATH ?? ''}`,
      });
      const record = await runLaneTask(task, fixture.examDir, { repoRoot: fixture.repoRoot });
      if (c.wantIncomplete) {
        expect(record.incomplete, c.label).toBeTruthy();
      } else {
        expect(record.incomplete, c.label).toBeUndefined();
        expect(record.lane?.exitCode, c.label).toBe(1);
        expect(
          scoreLane(task, record).find((s) => s.name === 'lane.completed')?.value,
          c.label,
        ).toBe(0);
      }
    }
    setEnv({
      EVAL_DEVIN_BIN: join(dir, 'does-not-exist', 'devin'),
      PATH: '/usr/bin:/bin',
    });
    const missing = await runLaneTask(task, fixture.examDir, { repoRoot: fixture.repoRoot });
    expect(missing.incomplete).toBeTruthy();
  });

  it('classifies timeout and ENOBUFS as task failure rather than incomplete and scrubs secrets', async () => {
    const dir = makeTestTempDir('eval-timeout-');
    const fixture = createFixtureSnapshotRepo(dir, 'timeout-task');
    const timeoutBin = writeStubDevin(dir, `setTimeout(() => {}, 5000);`);
    setEnv({
      EVAL_DEVIN_BIN: timeoutBin,
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
    });
    const timeoutTask: LaneTask = { ...fixture.task, timeoutMs: 250 };
    const timedOut = await runLaneTask(timeoutTask, fixture.examDir, {
      repoRoot: fixture.repoRoot,
    });
    expect(timedOut.incomplete).toBeUndefined();
    expect(scoreLane(timeoutTask, timedOut).find((s) => s.name === 'lane.completed')?.value).toBe(
      0,
    );
    expect((timedOut as { diagnostics?: string }).diagnostics ?? '').toContain('timeout');

    const floodBin = writeStubDevin(
      join(dir, 'flood'),
      `const chunk = 'x'.repeat(1024 * 1024); for (let i = 0; i < 20; i++) process.stdout.write(chunk);`,
    );
    setEnv({
      EVAL_DEVIN_BIN: floodBin,
      PATH: `${join(dir, 'flood', 'bin')}:${process.env.PATH ?? ''}`,
    });
    const floodTask: LaneTask = { ...fixture.task, timeoutMs: 10_000 };
    const flooded = await runLaneTask(floodTask, fixture.examDir, { repoRoot: fixture.repoRoot });
    expect(flooded.incomplete).toBeUndefined();
    expect(scoreLane(floodTask, flooded).find((s) => s.name === 'lane.completed')?.value).toBe(0);

    const secretA = `sk-${'Z'.repeat(24)}`;
    const secretB = `sk-lf-${'Y'.repeat(20)}`;
    const scrubBin = writeStubDevin(
      join(dir, 'scrub'),
      `process.stderr.write('Error: Login canceled using ${secretA} and Bearer ${secretB} at ${dir}/creds\\n'); process.exit(1);`,
    );
    setEnv({
      EVAL_DEVIN_BIN: scrubBin,
      PATH: `${join(dir, 'scrub', 'bin')}:${process.env.PATH ?? ''}`,
      HOME: dir,
    });
    const scrubbed = await runLaneTask({ ...fixture.task, timeoutMs: 10_000 }, fixture.examDir, {
      repoRoot: fixture.repoRoot,
    });
    const text = `${scrubbed.incomplete ?? ''}\n${(scrubbed as { diagnostics?: string }).diagnostics ?? ''}`;
    expect(text).not.toContain(secretA);
    expect(text).not.toContain(secretB);
    expect(text).not.toContain(dir);
  });

  it('resolves EVAL_MAX_DEVIN_RUNS safely across empty, zero, negative, and non-numeric values', () => {
    expect(resolveDevinCap(undefined, 40)).toBe(40);
    expect(resolveDevinCap('', 40)).toBe(40);
    expect(resolveDevinCap('   ', 40)).toBe(40);
    expect(resolveDevinCap('0', 40)).toBe(0);
    expect(resolveDevinCap('12', 40)).toBe(12);
    expect(() => resolveDevinCap('-1', 40)).toThrow();
    expect(() => resolveDevinCap('abc', 40)).toThrow();
  });

  it('extracts Langfuse trace metadata and projectId from experiment results and exits 3 on Langfuse errors', async () => {
    const dir = makeTestTempDir('eval-run-lf-');
    const fixture = createFixtureSnapshotRepo(dir, 'lf-task');
    const bin = writeStubDevin(
      dir,
      `require('node:fs').writeFileSync('packages/pkg-a/index.js', 'export function add(a, b) { return Number(a) + Number(b); }\\n');`,
    );
    setEnv({
      EVAL_DEVIN_BIN: bin,
      EVAL_MAX_DEVIN_RUNS: '1',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_BASE_URL: 'https://lf.example.test',
    });
    const outOk = join(dir, 'ok.json');
    const codeOk = await runEval(
      [
        '--arm',
        'daily-test',
        '--exam',
        fixture.examDir,
        '--out',
        outOk,
        '--only',
        'lane',
        '--require-langfuse',
      ],
      {
        openClient: () => ({
          client: {
            experiment: {
              run: async (cfg: { data: unknown[]; task: (item: unknown) => Promise<unknown> }) => {
                const itemResults = [];
                for (let i = 0; i < cfg.data.length; i += 1) {
                  itemResults.push({
                    item: cfg.data[i],
                    output: await cfg.task(cfg.data[i]),
                    traceId: `trace-${i}`,
                  });
                }
                return {
                  experimentId: 'exp-123',
                  experimentUrl: 'https://lf.example.test/project/proj-abc/experiments/exp-123',
                  runName: 'eval-daily-test',
                  itemResults,
                  runEvaluations: [],
                };
              },
            },
          } as never,
          close: async () => {},
        }),
      },
    );
    expect(codeOk).toBe(0);
    const written = JSON.parse(readFileSync(outOk, 'utf8')) as {
      langfuse?: { projectId?: string; experimentId?: string; experimentUrl?: string };
      items: { traceId?: string; traceUrl?: string; durationMs?: number }[];
    };
    expect(written.langfuse?.projectId).toBe('proj-abc');
    expect(written.langfuse?.experimentId).toBe('exp-123');
    expect(written.items[0]?.traceId).toBe('trace-0');
    expect(written.items[0]?.traceUrl).toBe(
      'https://lf.example.test/project/proj-abc/traces/trace-0',
    );

    setEnv({ LANGFUSE_BASE_URL: undefined });
    expect(
      await runEval([
        '--arm',
        'bad-base',
        '--exam',
        fixture.examDir,
        '--out',
        join(dir, 'no-base.json'),
        '--only',
        'lane',
        '--require-langfuse',
      ]),
    ).toBe(3);

    setEnv({ LANGFUSE_BASE_URL: 'https://lf.example.test' });
    expect(
      await runEval([
        '--arm',
        'bad-combo',
        '--exam',
        fixture.examDir,
        '--out',
        join(dir, 'combo.json'),
        '--only',
        'lane',
        '--offline',
        '--require-langfuse',
      ]),
    ).toBe(3);

    expect(
      await runEval(
        [
          '--arm',
          'throw-exp',
          '--exam',
          fixture.examDir,
          '--out',
          join(dir, 'throw.json'),
          '--only',
          'lane',
          '--require-langfuse',
        ],
        {
          openClient: () => ({
            client: {
              experiment: {
                run: async () => {
                  throw new Error('langfuse down');
                },
              },
            } as never,
            close: async () => {},
          }),
        },
      ),
    ).toBe(3);
  });
});
