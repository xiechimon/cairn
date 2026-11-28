import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { journeyPassed, scoreJourney } from '../scorers/journey-checks.js';
import { runJourneyTask } from './journey.js';
import type { JourneyTask } from './types.js';

const tmpRoots: string[] = [];
afterAll(() => {
  for (const dir of tmpRoots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=eval@cairn.dev', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  ).trim();
}

interface Fixture {
  repoRoot: string;
  parentCommit: string;
  fixCommit: string;
  testFiles: string[];
}

/** A two-commit repository: a broken `add` on the parent, fixed with one hidden test. */
function makeFixture(): Fixture {
  const repoRoot = tempRoot('journey-repo-');
  git(repoRoot, ['init', '-q']);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'sum.mjs'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(repoRoot, 'README.md'), '# demo\n');
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
  return { repoRoot, parentCommit, fixCommit, testFiles: ['test/sum.test.mjs'] };
}

function caseFor(fixture: Fixture, id = 'journey-fix-sum'): JourneyTask {
  return {
    kind: 'journey',
    id,
    request: 'demo 的 add 算出来不对，修一下',
    world: { projects: ['demo'], todos: [] },
    script: [
      {
        toolCalls: [
          {
            name: 'create_todo',
            args: { projectId: '@demo', title: '修好 add', quotes: ['add 算出来不对'] },
          },
        ],
      },
      { text: '已交给 runner。' },
    ],
    expected: { decision: 'route', projects: ['demo'], promptContains: [], promptExcludes: [] },
    source: {
      parentCommit: fixture.parentCommit,
      fixCommit: fixture.fixCommit,
      testFiles: fixture.testFiles,
      existingTestFiles: [],
    },
    checks: { files: [{ path: 'src/sum.mjs', contains: 'a + b' }], commands: ['node --test test/sum.test.mjs'] },
    gate: true,
  };
}

const fixture = makeFixture();

describe('cairn journey arm', () => {
  test(
    'a dispatched, delivered, graded fix passes every check',
    { timeout: 120_000 },
    async () => {
      const result = await runJourneyTask(caseFor(fixture), { repoRoot: fixture.repoRoot });
      console.log('DEBUG', result.record.incomplete, JSON.stringify(result.record.journey), result.diagnostics);
      expect(result.record.incomplete).toBeUndefined();
      expect(journeyPassed(caseFor(fixture), result.record)).toBe(true);
      expect(result.record.journey?.claimedMachine).not.toBeNull();
    },
  );

  test(
    'a perfect patch that is never claimed and delivered stays red',
    { timeout: 120_000 },
    async () => {
      const result = await runJourneyTask(caseFor(fixture), {
        repoRoot: fixture.repoRoot,
        arm: 'unsent',
      });
      const checks = scoreJourney(caseFor(fixture), result.record);
      expect(checks.find((c) => c.name === 'journey.delivered')?.value).toBe(0);
      expect(journeyPassed(caseFor(fixture), result.record)).toBe(false);
    },
  );

  test(
    'a delivered run without the patch stays red on the hidden test',
    { timeout: 120_000 },
    async () => {
      const result = await runJourneyTask(caseFor(fixture), {
        repoRoot: fixture.repoRoot,
        arm: 'nopatch',
      });
      const checks = scoreJourney(caseFor(fixture), result.record);
      expect(checks.find((c) => c.name === 'journey.tests_pass')?.value).toBe(0);
      expect(journeyPassed(caseFor(fixture), result.record)).toBe(false);
    },
  );

  test(
    'a runner that rewrites the hidden test cannot turn the case green',
    { timeout: 120_000 },
    async () => {
      const result = await runJourneyTask(caseFor(fixture), {
        repoRoot: fixture.repoRoot,
        arm: 'cheat',
      });
      const checks = scoreJourney(caseFor(fixture), result.record);
      expect(result.record.journey?.delivered).toBe(true);
      expect(checks.find((c) => c.name === 'journey.tests_pass')?.value).toBe(0);
    },
  );

  test(
    'a coordinator that answers instead of dispatching never claims a step',
    { timeout: 120_000 },
    async () => {
      const task: JourneyTask = {
        ...caseFor(fixture, 'journey-answered-only'),
        script: [{ text: '这个我先不建任务，你确认一下范围。' }],
      };
      const result = await runJourneyTask(task, { repoRoot: fixture.repoRoot });
      expect(result.record.journey?.routed).toBe(false);
      expect(result.record.journey?.claimed).toBe(false);
      expect(journeyPassed(task, result.record)).toBe(false);
    },
  );
});
