import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cliModelFromEnv, runCliCase } from './cli-arm.js';
import { runPilot } from './pilot.js';
import type { JourneyTask } from './types.js';

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.email=eval@cairn.dev',
      '-c',
      'user.name=eval',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();
}

function fixture(): { repoRoot: string; task: JourneyTask } {
  const repoRoot = tempRoot('cli-repo-');
  git(repoRoot, ['init', '-q']);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'sum.mjs'), 'export const add = (a, b) => a - b;\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-qm', 'parent']);
  const parentCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  writeFileSync(join(repoRoot, 'src', 'sum.mjs'), 'export const add = (a, b) => a + b;\n');
  mkdirSync(join(repoRoot, 'test'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'test', 'sum.test.mjs'),
    [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { add } from '../src/sum.mjs';",
      "test('adds', () => assert.equal(add(2, 3), 5));",
      '',
    ].join('\n'),
  );
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-qm', 'fix']);
  const fixCommit = git(repoRoot, ['rev-parse', 'HEAD']);
  const task: JourneyTask = {
    kind: 'journey',
    id: 'cli-sum',
    request: 'demo 的 add 算出来不对，修一下并跑测试',
    world: { projects: ['demo'], todos: [] },
    script: [{ text: '已交给 runner。' }],
    expected: { decision: 'route', projects: ['demo'], promptContains: [], promptExcludes: [] },
    source: {
      parentCommit,
      fixCommit,
      testFiles: ['test/sum.test.mjs'],
      existingTestFiles: [],
    },
    checks: { files: [], commands: ['node --test test/sum.test.mjs'] },
    gate: true,
  };
  return { repoRoot, task };
}

function fakeCli(body: string): { command: string; args: string[] } {
  const dir = tempRoot('cli-fake-');
  const path = join(dir, 'cli.mjs');
  writeFileSync(path, body);
  return { command: process.execPath, args: [path] };
}

const fixScript = `
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const dir = args[args.indexOf('-C') + 1];
writeFileSync(join(dir, 'src', 'sum.mjs'), 'export const add = (a, b) => b + a;\\n');
`;

const noopScript = `
const args = process.argv.slice(2);
if (args[args.indexOf('-p') + 1] !== 'demo 的 add 算出来不对，修一下并跑测试') process.exit(2);
`;

describe('cli arm', () => {
  test('a model that fixes the checkout passes the independent grader', async () => {
    const { repoRoot, task } = fixture();
    const fake = fakeCli(fixScript);
    const result = await runCliCase(task, {
      repoRoot,
      model: {
        command: fake.command,
        args: fake.args,
        modelId: 'fake/model',
        effort: 'low',
        permissionMode: 'always_allow',
        timeoutMs: 30_000,
      },
    });
    expect(result.launch?.exitCode).toBe(0);
    expect(result.launches).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.commandChecks).toEqual([{ command: 'node --test test/sum.test.mjs', ok: true }]);
  });

  test('a model that changes nothing stays red on the hidden test', async () => {
    const { repoRoot, task } = fixture();
    const fake = fakeCli(noopScript);
    const result = await runCliCase(task, {
      repoRoot,
      model: {
        command: fake.command,
        args: fake.args,
        modelId: 'fake/model',
        effort: 'low',
        permissionMode: 'always_allow',
        timeoutMs: 30_000,
      },
    });
    expect(result.passed).toBe(false);
    expect(result.commandChecks).toEqual([{ command: 'node --test test/sum.test.mjs', ok: false }]);
  });

  test('the pilot counts each model launch and keeps the no-patch control free', async () => {
    const fake = fakeCli(fixScript);
    const result = await runPilot({
      cli: {
        command: fake.command,
        args: fake.args,
        modelId: 'fake/model',
        effort: 'low',
        permissionMode: 'always_allow',
        timeoutMs: 30_000,
      },
      cases: 1,
    });
    expect(result.mode).toBe('cli');
    expect(result.starts).toBe(2);
    expect(result.launches).toHaveLength(2);
    expect(result.arms).toEqual([
      { arm: 'none', passed: 1, graded: 1 },
      { arm: 'none', passed: 1, graded: 1 },
      { arm: 'nopatch', passed: 0, graded: 1 },
    ]);
    expect(result.aaDiscordance).toBe(0);
    expect(result.damage.kind).toBe('discard');
    expect(result.capProof).toMatchObject({ admitted: 64, attempted: 65 });
    expect(result.missing).toBeNull();
    expect(result.incomplete).toBeNull();
  });
});

describe('cli model from the environment', () => {
  test('needs both the launcher and the approved model id', () => {
    expect(cliModelFromEnv({})).toBeNull();
    expect(cliModelFromEnv({ EVAL_ARM_CLI: '/bin/true' })).toBeNull();
    expect(cliModelFromEnv({ EVAL_ARM_CLI: '/bin/true', EVAL_ARM_MODEL_ID: 'm' })).toMatchObject({
      command: '/bin/true',
      modelId: 'm',
      effort: 'low',
      permissionMode: 'always_allow',
    });
  });

  test('a timeout that is not a positive number is refused, never read as zero', () => {
    expect(() =>
      cliModelFromEnv({
        EVAL_ARM_CLI: '/bin/true',
        EVAL_ARM_MODEL_ID: 'm',
        EVAL_ARM_TIMEOUT_MS: 'soon',
      }),
    ).toThrow('positive number');
  });
});
