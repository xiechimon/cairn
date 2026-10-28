import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from '@cairn/shared';
import { expect, test } from 'vitest';
import {
  type BuildReplayRequest,
  buildReplayReport,
  matchesReplay,
  normalizeReplay,
  readReplayFile,
  renderReliabilityMarkdown,
  replayId,
  STUCK_THRESHOLD_MS,
} from '../src/reliability-report.js';

interface SampleTasksFile {
  repo: string;
  baseSha: string;
  tasks: Array<{ id: string; kind: string }>;
}

const SAMPLE_TASKS = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../docs/reliability/1996/sample-tasks.json'),
    'utf8',
  ),
) as SampleTasksFile;

function writeJson(content: unknown): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rel-replay-'));
  const path = join(dir, 'replay.json');
  writeFileSync(path, JSON.stringify(content));
  return { dir, path };
}

const validRequest = {
  task: 'ufo-08',
  kind: 'bug',
  buildId: 'build-1',
  todoId: 'todo-1',
  createdAt: '2026-10-27T10:00:00.000Z',
  prNumber: 41,
  errorMessage: null,
};

test('the checked-in sample repo, base sha and task ids are the ones the replay file uses', () => {
  expect(SAMPLE_TASKS.repo).toBe('xiechimon/cairn-sample-ufo');
  expect(SAMPLE_TASKS.baseSha).toMatch(/^[0-9a-f]{40}$/);
  expect(SAMPLE_TASKS.tasks.length).toBeGreaterThanOrEqual(10);
});

test('a replay entry keeps the task id, the base sha and counts as reached-PR only with a prNumber', () => {
  const entry: BuildReplayRequest = normalizeReplay(
    { ...validRequest, prNumber: 41 },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  expect(entry.repo).toBe('xiechimon/cairn-sample-ufo');
  expect(entry.baseSha).toBe(SAMPLE_TASKS.baseSha);
  expect(entry.task).toBe('ufo-08');
  expect(entry.outcome).toBe('reached-pr');
  expect(replayId(entry)).toBe('build-1');
  const failed = normalizeReplay(
    { ...validRequest, prNumber: null, errorMessage: 'stream timeout (arm=idle, 300000ms)' },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  expect(failed.outcome).toBe('timeout');
});

test('normalizeReplay refuses a task id that is not in the checked-in set', () => {
  expect(() =>
    normalizeReplay(
      { ...validRequest, task: 'ufo-99' },
      {
        repo: SAMPLE_TASKS.repo,
        baseSha: SAMPLE_TASKS.baseSha,
        taskIds: SAMPLE_TASKS.tasks.map((task) => task.id),
      },
    ),
  ).toThrow(/ufo-99/);
});

test('normalizeReplay refuses a replay recorded on another repo or another base, and an unparsable date', () => {
  const base = { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha };
  expect(() => normalizeReplay({ ...validRequest, repo: 'unjs/ufo' }, base)).toThrow(/repo/);
  expect(() => normalizeReplay({ ...validRequest, baseSha: '0'.repeat(40) }, base)).toThrow(
    /baseSha/,
  );
  expect(() => normalizeReplay({ ...validRequest, createdAt: 'yesterday' }, base)).toThrow(
    /createdAt/,
  );
});

test('reading a replay file rejects a non-array file and a malformed entry, naming the index', () => {
  const notArray = writeJson({ tasks: [] });
  try {
    expect(() =>
      readReplayFile(notArray.path, {
        repo: SAMPLE_TASKS.repo,
        baseSha: SAMPLE_TASKS.baseSha,
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/array/);
  } finally {
    rmSync(notArray.dir, { recursive: true, force: true });
  }
  const malformed = writeJson([validRequest, { ...validRequest, buildId: 7 }]);
  try {
    expect(() =>
      readReplayFile(malformed.path, {
        repo: SAMPLE_TASKS.repo,
        baseSha: SAMPLE_TASKS.baseSha,
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(/\[1\]/);
  } finally {
    rmSync(malformed.dir, { recursive: true, force: true });
  }
});

test('a replay entry matches only a build with the same id whose error text carries the same failure', () => {
  const entry = normalizeReplay(
    { ...validRequest, prNumber: null, errorMessage: 'stream timeout (arm=idle, 300000ms)' },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  expect(
    matchesReplay(entry, {
      buildId: 'build-1',
      errorMessage: 'stream timeout (arm=idle, 600000ms)',
    }),
  ).toBe(true);
  expect(
    matchesReplay(entry, { buildId: 'build-1', errorMessage: 'git push failed (128): fatal' }),
  ).toBe(false);
  expect(
    matchesReplay(entry, {
      buildId: 'build-2',
      errorMessage: 'stream timeout (arm=idle, 300000ms)',
    }),
  ).toBe(false);
  const reached = normalizeReplay(validRequest, {
    repo: SAMPLE_TASKS.repo,
    baseSha: SAMPLE_TASKS.baseSha,
  });
  expect(matchesReplay(reached, { buildId: 'build-1', errorMessage: null })).toBe(true);
  expect(
    matchesReplay(reached, { buildId: 'build-1', errorMessage: 'git push failed (128)' }),
  ).toBe(false);
});

test('replay report redacts and truncates error messages like the database report does', () => {
  const until = Date.parse('2026-11-10T00:00:00.000Z');
  const window = { repo: SAMPLE_TASKS.repo, since: 0, until };
  const leaked = normalizeReplay(
    {
      ...validRequest,
      prNumber: null,
      errorMessage: 'push failed, credential was ghp_0123456789abcdefghijklmnopqrstuv',
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const long = normalizeReplay(
    {
      ...validRequest,
      buildId: 'build-2',
      todoId: 'todo-2',
      prNumber: null,
      errorMessage: 'x'.repeat(500),
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const report = buildReplayReport([leaked, long], window);
  const leakedRow = report.builds.find((row) => row.id === 'build-1');
  expect(leakedRow?.message).toBe(
    `push failed, credential was ${redactSecrets('ghp_0123456789abcdefghijklmnopqrstuv').value}`,
  );
  const longRow = report.builds.find((row) => row.id === 'build-2');
  expect(longRow?.message?.length).toBe(301);
  expect(longRow?.message?.endsWith('…')).toBe(true);
  const json = JSON.stringify(report);
  expect(json).not.toContain('ghp_0123456789');
  expect(json).toContain('[REDACTED]');
  expect(renderReliabilityMarkdown(report)).not.toContain('ghp_0123456789');
});

test('replay classification ages a build against the report window end, not zero', () => {
  const until = Date.parse('2026-11-10T00:00:00.000Z');
  const since = until - 7 * 86_400_000;
  const old = normalizeReplay(
    {
      ...validRequest,
      prNumber: null,
      errorMessage: null,
      createdAt: new Date(until - 7 * 86_400_000 + 3_600_000).toISOString(),
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const fresh = normalizeReplay(
    {
      ...validRequest,
      buildId: 'build-2',
      todoId: 'todo-2',
      prNumber: null,
      errorMessage: null,
      createdAt: new Date(until - 3_600_000).toISOString(),
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const report = buildReplayReport([old, fresh], { repo: SAMPLE_TASKS.repo, since, until });
  const oldRow = report.builds.find((row) => row.id === 'build-1');
  const freshRow = report.builds.find((row) => row.id === 'build-2');
  expect(oldRow?.outcome).toBe('stuck-waiting');
  expect(oldRow?.ageHours).toBeGreaterThan(160);
  expect(freshRow?.outcome).toBe('active');
  expect(freshRow?.ageHours).toBeCloseTo(1, 1);
  expect(report.causes['stuck-waiting']).toBe(1);
});

test('replay classification hits stuck-waiting at the six-hour boundary', () => {
  const until = Date.parse('2026-11-10T00:00:00.000Z');
  const since = until - 7 * 86_400_000;
  const boundary = normalizeReplay(
    {
      ...validRequest,
      prNumber: null,
      errorMessage: null,
      createdAt: new Date(until - STUCK_THRESHOLD_MS).toISOString(),
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const justUnder = normalizeReplay(
    {
      ...validRequest,
      buildId: 'build-2',
      todoId: 'todo-2',
      prNumber: null,
      errorMessage: null,
      createdAt: new Date(until - STUCK_THRESHOLD_MS + 1).toISOString(),
    },
    { repo: SAMPLE_TASKS.repo, baseSha: SAMPLE_TASKS.baseSha },
  );
  const report = buildReplayReport([boundary, justUnder], {
    repo: SAMPLE_TASKS.repo,
    since,
    until,
  });
  const boundaryRow = report.builds.find((row) => row.id === 'build-1');
  const justUnderRow = report.builds.find((row) => row.id === 'build-2');
  expect(boundaryRow?.outcome).toBe('stuck-waiting');
  expect(justUnderRow?.outcome).toBe('active');
});
