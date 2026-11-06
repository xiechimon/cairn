import { expect, test } from 'vitest';
import { PHASE_VALUES } from '../src/fixtures/records.js';
import { threadStatus } from '../src/board/thread-copy.js';
import { elapsedSince, projectThreads } from '../src/board/sidebar-threads.js';
import { NOW, todo } from './helpers.js';

const inProject = (seq: number, phase: Parameters<typeof todo>[1], projectId = 'p1') => ({
  ...todo(seq, phase),
  projectId,
  phaseAt: NOW - seq * 1000,
});

test('in-progress threads are listed and finished ones fold into earlier', () => {
  const { live, earlier } = projectThreads(
    [inProject(1, 'building'), inProject(2, 'done'), inProject(3, 'closed'), inProject(4, 'todo')],
    'p1',
  );
  expect(live.map((t) => t.seqNum)).toEqual([1]);
  expect(earlier.map((t) => t.seqNum)).toEqual([2, 3, 4]);
});

test('a thread that needs you or failed ranks above a running one', () => {
  const { live } = projectThreads(
    [inProject(1, 'building'), inProject(2, 'failed'), inProject(3, 'confirm')],
    'p1',
  );
  expect(live.map((t) => t.seqNum)).toEqual([3, 2, 1]);
});

test.each(['confirm', 'review'] as const)(
  'a %s thread ranks above a newer running one',
  (phase) => {
    const newerRunning = { ...inProject(1, 'building'), phaseAt: NOW };
    const waiting = { ...inProject(2, phase), phaseAt: NOW - 3_600_000 };
    expect(projectThreads([newerRunning, waiting], 'p1').live.map((t) => t.seqNum)).toEqual([2, 1]);
  },
);

test('an awaiting-reply thread ranks above a newer running one', () => {
  const newerRunning = { ...inProject(1, 'building'), phaseAt: NOW };
  const asking = { ...inProject(2, 'building'), awaitingReply: true, phaseAt: NOW - 3_600_000 };
  expect(projectThreads([newerRunning, asking], 'p1').live.map((t) => t.seqNum)).toEqual([2, 1]);
});

test('every phase classified needs-you by threadStatus sorts first', () => {
  const phases = PHASE_VALUES.filter((phase) => threadStatus(todo(1, phase)) === 'needs-you');
  expect(phases.length).toBeGreaterThan(0);
  for (const phase of phases) {
    const running = { ...inProject(1, 'building'), phaseAt: NOW };
    const waiting = { ...inProject(2, phase), phaseAt: NOW - 3_600_000 };
    expect(projectThreads([running, waiting], 'p1').live[0]?.seqNum).toBe(2);
  }
});

test('threads of other projects never appear', () => {
  const { live, earlier } = projectThreads(
    [inProject(1, 'building', 'p2'), inProject(2, 'done', 'p2')],
    'p1',
  );
  expect(live).toEqual([]);
  expect(earlier).toEqual([]);
});

test('archived threads appear nowhere', () => {
  const archived = { ...inProject(1, 'building'), archivedAt: NOW };
  const { live, earlier } = projectThreads([archived], 'p1');
  expect(live.length + earlier.length).toBe(0);
});

test('a snoozed thread folds into earlier even when its phase is running', () => {
  const snoozed = { ...inProject(1, 'building'), snoozeMode: 'needed' as const };
  const { live, earlier } = projectThreads([snoozed], 'p1');
  expect(live).toEqual([]);
  expect(earlier).toHaveLength(1);
});

test('elapsed time is blank under a minute, then minutes, hours and days', () => {
  expect(elapsedSince(NOW - 59_000, NOW)).toBeNull();
  expect(elapsedSince(NOW - 60_000, NOW)).toEqual({ n: 1, unit: 'm' });
  expect(elapsedSince(NOW - 59 * 60_000, NOW)).toEqual({ n: 59, unit: 'm' });
  expect(elapsedSince(NOW - 3_600_000, NOW)).toEqual({ n: 1, unit: 'h' });
  expect(elapsedSince(NOW - 2 * 86_400_000, NOW)).toEqual({ n: 2, unit: 'd' });
  expect(elapsedSince(NOW + 5000, NOW)).toBeNull();
});
