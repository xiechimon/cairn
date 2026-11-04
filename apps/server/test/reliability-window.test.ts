import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readReplayFile } from '../src/reliability-report.js';

const DAY = 86_400_000;
const TASKS = {
  repo: 'xiechimon/cairn-sample-ufo',
  baseSha: 'f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6',
};

const dirs: string[] = [];
function replayFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rel-window-'));
  dirs.push(dir);
  const path = join(dir, 'replay.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function entry(task: string, createdAt: string) {
  return { task, createdAt, buildId: `build-${task}-${createdAt}`, prNumber: null };
}

test('readReplayFile refuses a file whose entries fall entirely outside the window', () => {
  const path = replayFile([entry('ufo-01', '2026-10-01T00:00:00.000Z')]);
  try {
    expect(() =>
      readReplayFile(path, {
        ...TASKS,
        since: Date.parse('2026-10-05T00:00:00.000Z'),
        until: Date.parse('2026-10-06T00:00:00.000Z'),
      }),
    ).toThrow(/no replay entries for xiechimon\/cairn-sample-ufo/);
  } finally {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
});

test('readReplayFile keeps only entries inside the half-open window', () => {
  const path = replayFile([
    entry('ufo-01', '2026-10-01T00:00:00.000Z'),
    entry('ufo-02', '2026-10-02T00:00:00.000Z'),
    entry('ufo-03', '2026-10-03T00:00:00.000Z'),
  ]);
  const result = readReplayFile(path, {
    ...TASKS,
    since: Date.parse('2026-10-02T00:00:00.000Z'),
    until: Date.parse('2026-10-03T00:00:00.000Z'),
  });
  try {
    expect(result.map((row) => row.task)).toEqual(['ufo-02']);
  } finally {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
});

test('readReplayFile stamps the sample repo and base on every kept entry', () => {
  const path = replayFile([
    entry('ufo-01', '2026-10-02T00:00:00.000Z'),
    entry('ufo-02', '2026-10-02T01:00:00.000Z'),
  ]);
  try {
    const kept = readReplayFile(path, {
      ...TASKS,
      since: Date.parse('2026-10-02T00:00:00.000Z') - DAY,
      until: Date.parse('2026-10-03T00:00:00.000Z'),
    });
    expect(kept.map((row) => row.repo)).toEqual([TASKS.repo, TASKS.repo]);
    expect(kept.map((row) => row.baseSha)).toEqual([TASKS.baseSha, TASKS.baseSha]);
  } finally {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
});
