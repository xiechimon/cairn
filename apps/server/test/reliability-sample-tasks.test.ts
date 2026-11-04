import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const TASKS_PATH = join(import.meta.dirname, '../../../docs/reliability/1996/sample-tasks.json');

interface SampleTask {
  id: string;
  kind: string;
  title: string;
  body: string;
}

interface SampleTasksFile {
  repo: string;
  upstream?: string;
  baseTag: string;
  baseSha: string;
  tasks: SampleTask[];
}

function loadSampleTasks(): SampleTasksFile {
  return JSON.parse(readFileSync(TASKS_PATH, 'utf8')) as SampleTasksFile;
}

const KINDS = ['feature', 'bug', 'test', 'docs'];

test('sample-tasks.json parses, has 10-20 tasks, unique ids, a 40-hex baseSha, and every kind is one of the four', () => {
  const file = loadSampleTasks();
  expect(file.repo).toMatch(/^[\w.-]+\/[\w.-]+$/);
  expect(file.baseTag).toMatch(/^v\d+\.\d+\.\d+$/);
  expect(file.baseSha).toMatch(/^[0-9a-f]{40}$/);
  expect(file.tasks.length).toBeGreaterThanOrEqual(10);
  expect(file.tasks.length).toBeLessThanOrEqual(20);
  const ids = file.tasks.map((task) => task.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const task of file.tasks) {
    expect(KINDS, task.id).toContain(task.kind);
    expect(task.title.trim().length, task.id).toBeGreaterThan(0);
    expect(task.body.trim().length, task.id).toBeGreaterThan(0);
    expect(task.body, task.id).not.toMatch(/cairn/i);
  }
  const counts = Object.fromEntries(
    KINDS.map((kind) => [kind, file.tasks.filter((task) => task.kind === kind).length]),
  );
  expect(counts).toEqual({ feature: 6, bug: 5, test: 2, docs: 2 });
});

test('every bug task carries a failing input and every task text names a function it changes', () => {
  const file = loadSampleTasks();
  for (const task of file.tasks.filter((entry) => entry.kind === 'bug')) {
    expect(task.body, task.id).toMatch(/`[^`]+`/);
  }
  for (const task of file.tasks) {
    expect(task.body, task.id).toMatch(/`[A-Za-z_$][^`]*`/);
  }
});
