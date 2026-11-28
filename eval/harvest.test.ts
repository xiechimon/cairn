import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import type {
  captureClaimInputs,
  existingTurnCapture,
} from '../apps/server/src/services/coordinator-turn-capture.js';
import { cleanupTestTempDirs, makeTestTempDir } from '../scripts/test-tmpdir.mjs';
import type { LaneTask } from './harness/types.js';
import { runCli, verifyLaneTask } from './harvest-git.js';

type ClaimView = Parameters<typeof captureClaimInputs>[1];
type ToolView = NonNullable<ReturnType<typeof existingTurnCapture>>['views'][number];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARVEST = join(ROOT, 'eval', 'harvest.ts');

afterAll(cleanupTestTempDirs);

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeSyntheticGitTaskRepo(baseDir: string): {
  repoRoot: string;
  examDir: string;
  task: LaneTask;
} {
  const repoRoot = join(baseDir, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, 'calc.mjs'), 'export function mul(a, b) { return a + b; }\n');
  writeFileSync(
    join(repoRoot, 'calc.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { mul } from './calc.mjs';\ntest('is function', () => { assert.equal(typeof mul, 'function'); });\n",
  );
  gitIn(repoRoot, ['init', '-q']);
  gitIn(repoRoot, ['config', 'user.email', 'eval@cairn.dev']);
  gitIn(repoRoot, ['config', 'user.name', 'eval']);
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-qm', 'parent commit']);
  const parentCommit = gitIn(repoRoot, ['rev-parse', 'HEAD']);

  writeFileSync(join(repoRoot, 'calc.mjs'), 'export function mul(a, b) { return a * b; }\n');
  writeFileSync(
    join(repoRoot, 'calc.test.mjs'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { mul } from './calc.mjs';\ntest('multiplies', () => { assert.equal(mul(3, 4), 12); });\n",
  );
  gitIn(repoRoot, ['add', '-A']);
  gitIn(repoRoot, ['commit', '-qm', 'fix(calc): multiply instead of add']);
  const fixCommit = gitIn(repoRoot, ['rev-parse', 'HEAD']);

  const task: LaneTask = {
    kind: 'lane',
    id: 'mul-fix',
    instruction: 'Fix mul so mul(3, 4) returns 12.',
    timeoutMs: 60_000,
    source: {
      parentCommit,
      fixCommit,
      testFiles: ['calc.test.mjs'],
      existingTestFiles: [],
    },
    checks: {
      files: [],
      commands: ['node --test calc.test.mjs'],
    },
    gate: true,
  };
  const examDir = join(repoRoot, 'eval');
  mkdirSync(join(examDir, 'tasks', 'lane', 'mul-fix'), { recursive: true });
  writeFileSync(join(examDir, 'tasks', 'lane', 'mul-fix', 'task.json'), JSON.stringify(task));
  return { repoRoot, examDir, task };
}

describe('eval/harvest', () => {
  it('turns a sealed claim-shaped snapshot row into one dataset item', () => {
    const dir = makeTestTempDir('cairn-harvest-');
    const dbPath = join(dir, 'snapshots.db');
    const outPath = join(dir, 'items.jsonl');
    const db = new BetterSqlite(dbPath);
    db.exec(`CREATE TABLE coordinator_turn_snapshot (
      turnId TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      capturedAt INTEGER NOT NULL,
      payload TEXT
    )`);
    const secret = `sk-${'A'.repeat(24)}`;
    const claim: ClaimView = {
      systemPrompt: 'coordinator system prompt',
      instruction: `harvest this request into the suite ${secret}`,
      trigger: 'user',
      memories: ['memory note'],
      provider: 'stub',
      modelId: 'model-x',
      thinkingLevel: null,
      volatileText: null,
      projects: [
        { id: 'p1', name: 'docs', description: null, repoKind: null, archivedAt: null },
        { id: 'p2', name: 'ops', description: 'ops repo', repoKind: 'git', archivedAt: null },
      ],
      initialTodos: [],
      initialThreads: [],
      initialVisible: [],
    };
    const toolViews: ToolView[] = [
      { callId: 'call-1', tool: 'projects', params: {}, preCallTodos: [], result: [] },
    ];
    const insert = db.prepare(
      `INSERT INTO coordinator_turn_snapshot (turnId, status, capturedAt, payload) VALUES (?, ?, ?, ?)`,
    );
    insert.run('TURN_Claimed_0001', 'sealed', 200, JSON.stringify({ claim, toolViews }));
    insert.run('turn-no-claim-02', 'sealed', 100, JSON.stringify({ claim: null, toolViews: [] }));
    insert.run('turn-unusable-03', 'unusable', 300, null);
    db.close();

    const run = spawnSync(process.execPath, ['--import', 'tsx', HARVEST], {
      cwd: ROOT,
      env: { ...process.env, HARVEST_DB: dbPath, HARVEST_OUT: outPath, HARVEST_UPLOAD: '0' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr || String(run.error)).toBe(0);
    const items = readFileSync(outPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('harvest-turn-claimed-0001');
    expect(items[0].input.request).toBe('harvest this request into the suite [REDACTED]');
    expect(items[0].input.request).not.toContain(secret);
    expect(items[0].input.world.projects).toEqual(['docs', 'ops']);
    expect(items[0].input.gate).toBe(false);
  });

  it('skips claim-less and short sealed rows before applying HARVEST_LIMIT', () => {
    const dir = makeTestTempDir('cairn-harvest-');
    const dbPath = join(dir, 'snapshots.db');
    const outPath = join(dir, 'items.jsonl');
    const db = new BetterSqlite(dbPath);
    db.exec(`CREATE TABLE coordinator_turn_snapshot (
      turnId TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      capturedAt INTEGER NOT NULL,
      payload TEXT
    )`);
    const baseClaim: ClaimView = {
      systemPrompt: 'coordinator system prompt',
      instruction: 'placeholder instruction',
      trigger: 'user',
      memories: [],
      provider: 'stub',
      modelId: 'model-x',
      thinkingLevel: null,
      volatileText: null,
      projects: [],
      initialTodos: [],
      initialThreads: [],
      initialVisible: [],
    };
    const insert = db.prepare(
      `INSERT INTO coordinator_turn_snapshot (turnId, status, capturedAt, payload) VALUES (?, ?, ?, ?)`,
    );
    insert.run('turn-null-500', 'sealed', 500, JSON.stringify({ claim: null, toolViews: [] }));
    insert.run('turn-null-400', 'sealed', 400, JSON.stringify({ claim: null, toolViews: [] }));
    insert.run('turn-bad-json-350', 'sealed', 350, '{not-json');
    insert.run('turn-null-300', 'sealed', 300, JSON.stringify({ claim: null, toolViews: [] }));
    insert.run(
      'turn-short-250',
      'sealed',
      250,
      JSON.stringify({ claim: { ...baseClaim, instruction: 'hi' }, toolViews: [] }),
    );
    insert.run(
      'turn-valid-200',
      'sealed',
      200,
      JSON.stringify({
        claim: { ...baseClaim, instruction: 'first older valid instruction' },
        toolViews: [],
      }),
    );
    insert.run(
      'turn-valid-100',
      'sealed',
      100,
      JSON.stringify({
        claim: { ...baseClaim, instruction: 'second older valid instruction' },
        toolViews: [],
      }),
    );
    db.close();

    const run = spawnSync(process.execPath, ['--import', 'tsx', HARVEST], {
      cwd: ROOT,
      env: {
        ...process.env,
        HARVEST_DB: dbPath,
        HARVEST_OUT: outPath,
        HARVEST_LIMIT: '2',
        HARVEST_UPLOAD: '0',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr || String(run.error)).toBe(0);
    const items = readFileSync(outPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.input.request)).toEqual([
      'first older valid instruction',
      'second older valid instruction',
    ]);

    const zeroOutPath = join(dir, 'zero-items.jsonl');
    const zeroRun = spawnSync(process.execPath, ['--import', 'tsx', HARVEST], {
      cwd: ROOT,
      env: {
        ...process.env,
        HARVEST_DB: dbPath,
        HARVEST_OUT: zeroOutPath,
        HARVEST_LIMIT: '0',
        HARVEST_UPLOAD: '0',
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(zeroRun.status, zeroRun.stderr || String(zeroRun.error)).toBe(0);
    const zeroItems = readFileSync(zeroOutPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(zeroItems).toHaveLength(0);
  });
});

describe('eval/harvest-git', () => {
  it('passes verifyLaneTask for baseline/nop/oracle and rejects invalid tasks or in-repo --out', () => {
    const dir = makeTestTempDir('cairn-harvest-git-');
    const { repoRoot, examDir, task } = makeSyntheticGitTaskRepo(dir);

    const ok = verifyLaneTask(task, repoRoot);
    expect(ok.ok, ok.reason).toBe(true);

    const badParent = verifyLaneTask(
      { ...task, source: { ...task.source, parentCommit: task.source.fixCommit } },
      repoRoot,
    );
    expect(badParent.ok).toBe(false);
    expect(badParent.reason).toContain('!== fixCommit^');

    const nopPasses = verifyLaneTask(
      { ...task, checks: { ...task.checks, commands: ['node -e "process.exit(0)"'] } },
      repoRoot,
    );
    expect(nopPasses.ok).toBe(false);
    expect(nopPasses.reason).toContain('nop unexpectedly passed');

    const nopTimedOut = verifyLaneTask(
      {
        ...task,
        checks: { ...task.checks, commands: ['node -e "setTimeout(() => {}, 5000)"'] },
      },
      repoRoot,
      { commandTimeoutMs: 300 },
    );
    expect(nopTimedOut.ok).toBe(false);
    expect(nopTimedOut.reason).toMatch(/timed out|signal/i);

    const nopNonTestFail = verifyLaneTask(
      { ...task, checks: { ...task.checks, commands: ['node -e "process.exit(2)"'] } },
      repoRoot,
    );
    expect(nopNonTestFail.ok).toBe(false);
    expect(nopNonTestFail.reason).toContain('without test failure output');

    expect(runCli(['--repo', repoRoot, '--exam', examDir, '--verify', 'does-not-exist'])).toBe(1);
    expect(() =>
      runCli([
        '--repo',
        repoRoot,
        '--exam',
        examDir,
        '--scan',
        '--ref',
        'HEAD',
        '--out',
        join(repoRoot, 'out.jsonl'),
      ]),
    ).toThrow(/outside the repository/);
  });
});
