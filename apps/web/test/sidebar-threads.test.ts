import { expect, test } from 'vitest';
import { PHASE_VALUES } from '../src/fixtures/records.js';
import { threadStatus } from '../src/board/thread-copy.js';
import { elapsedSince, groupThreads, visibleTodos } from '../src/board/sidebar-threads.js';
import { NOW, todo } from './helpers.js';

const inProject = (seq: number, phase: Parameters<typeof todo>[1], projectId = 'p1') => ({
  ...todo(seq, phase),
  projectId,
  phaseAt: NOW - seq * 1000,
});

const nums = (rows: { seqNum: number }[]) => rows.map((t) => t.seqNum);

test('threads split into needs-you, running and a done group', () => {
  const groups = groupThreads(
    [inProject(1, 'building'), inProject(2, 'done'), inProject(3, 'closed'), inProject(4, 'confirm')],
    null,
  );
  expect(nums(groups.needsYou)).toEqual([4]);
  expect(nums(groups.running)).toEqual([1]);
  expect(nums(groups.done)).toEqual([2, 3]);
});

test('failed ranks after needs-you but inside the needs-you group', () => {
  const groups = groupThreads(
    [inProject(1, 'building'), inProject(2, 'failed'), inProject(3, 'confirm')],
    null,
  );
  expect(nums(groups.needsYou)).toEqual([3, 2]);
  expect(nums(groups.running)).toEqual([1]);
});

test.each(['confirm', 'needs_input', 'review'] as const)('a %s thread lands in needs-you', (phase) => {
  const newerRunning = { ...inProject(1, 'building'), phaseAt: NOW };
  const waiting = { ...inProject(2, phase), phaseAt: NOW - 3_600_000 };
  const groups = groupThreads([newerRunning, waiting], null);
  expect(nums(groups.needsYou)).toEqual([2]);
  expect(nums(groups.running)).toEqual([1]);
});

test('every phase classified by threadStatus lands in the matching group', () => {
  for (const phase of PHASE_VALUES) {
    const row = inProject(1, phase);
    const status = threadStatus(row);
    const groups = groupThreads([row], null);
    const where = (['needsYou', 'running', 'done'] as const).filter((k) => groups[k].length === 1);
    const expected =
      status === 'needs-you' || status === 'failed'
        ? 'needsYou'
        : status === 'done'
          ? 'done'
          : 'running';
    expect(where, phase).toEqual([expected]);
  }
});

test('groups sort newest first inside each status', () => {
  const groups = groupThreads(
    [inProject(1, 'done'), inProject(2, 'done'), inProject(3, 'building'), inProject(4, 'building')],
    null,
  );
  expect(nums(groups.done)).toEqual([1, 2]);
  expect(nums(groups.running)).toEqual([3, 4]);
});

test('a project id filters to that project; null keeps every project', () => {
  const rows = [inProject(1, 'building', 'p1'), inProject(2, 'building', 'p2')];
  expect(nums(groupThreads(rows, 'p2').running)).toEqual([2]);
  expect(nums(groupThreads(rows, null).running)).toEqual([1, 2]);
});

test('archived threads appear nowhere', () => {
  const archived = { ...inProject(1, 'building'), archivedAt: NOW };
  const groups = groupThreads([archived], null);
  expect(groups.needsYou.length + groups.running.length + groups.done.length).toBe(0);
});

test('a todo is not done: it stays with the running group below running threads', () => {
  const groups = groupThreads([inProject(1, 'todo'), inProject(2, 'building')], null);
  expect(nums(groups.running)).toEqual([2, 1]);
  expect(groups.done).toEqual([]);
});

test('a snoozed thread leaves needs-you and sinks to the bottom of running', () => {
  const snoozed = { ...inProject(1, 'confirm'), snoozeMode: 'needed' as const };
  const groups = groupThreads([snoozed, inProject(2, 'building')], null);
  expect(groups.needsYou).toEqual([]);
  expect(nums(groups.running)).toEqual([2, 1]);
});

test('a missing or zero start time renders no duration', () => {
  expect(elapsedSince(0, NOW)).toBeNull();
  expect(elapsedSince(null, NOW)).toBeNull();
  expect(elapsedSince(undefined, NOW)).toBeNull();
});

test('a done thread is never marked done by age: an old running thread stays running', () => {
  const old = { ...inProject(1, 'building'), phaseAt: NOW - 30 * 86_400_000 };
  expect(nums(groupThreads([old], null).running)).toEqual([1]);
});

test('elapsed time is blank under a minute, then minutes, hours and days', () => {
  expect(elapsedSince(NOW - 59_000, NOW)).toBeNull();
  expect(elapsedSince(NOW - 60_000, NOW)).toEqual({ n: 1, unit: 'm' });
  expect(elapsedSince(NOW - 59 * 60_000, NOW)).toEqual({ n: 59, unit: 'm' });
  expect(elapsedSince(NOW - 3_600_000, NOW)).toEqual({ n: 1, unit: 'h' });
  expect(elapsedSince(NOW - 2 * 86_400_000, NOW)).toEqual({ n: 2, unit: 'd' });
  expect(elapsedSince(NOW + 5000, NOW)).toBeNull();
});

test('threads of an archived project show only when that project is selected', () => {
  const rows = [inProject(1, 'building', 'p1'), inProject(2, 'building', 'p2')];
  const archived = new Set(['p2']);
  expect(nums(visibleTodos(rows, archived, null))).toEqual([1]);
  expect(nums(visibleTodos(rows, archived, 'p1'))).toEqual([1]);
  expect(nums(visibleTodos(rows, archived, 'p2'))).toEqual([1, 2]);
});
