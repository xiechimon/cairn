import type { PrPanelRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  PR_READ_LATE_MS,
  prCardModelOfRow,
  prChecksText,
  prCiUnread,
} from '../src/components/thread/pr-panel-model.js';

const HEAD = '4f8e2c1d9b0a63e57c1f08a2d4b6e9137a5c80de';
const NOW = 1_000_000_000;

function row(over: Partial<PrPanelRow> = {}): PrPanelRow {
  return {
    buildId: 'b1',
    threadId: 't1',
    projectId: 'p1',
    repo: 'octo/demo',
    number: 42,
    title: 'a change',
    url: 'https://github.com/octo/demo/pull/42',
    state: 'open',
    mergeState: 'clean',
    additions: 3,
    deletions: 1,
    checks: { passed: 4, failed: 0, running: 0, total: 4, failedNames: [] },
    branch: 'cairn/feature',
    base: 'main',
    head: HEAD,
    verdict: { result: 'pass', judgedHead: HEAD },
    autoFix: false,
    mergeWhenReady: false,
    autoArchive: false,
    dismissed: false,
    blockedSince: null,
    wakeRounds: 0,
    lastReadAt: NOW,
    checksReadFor: HEAD,
    ...over,
  };
}

const stateOf = (over: Partial<PrPanelRow>) => prCardModelOfRow(row(over), NOW).state;

describe('a panel row maps onto one card state', () => {
  test.each([
    ['ready', {}, 'review-pass'],
    ['draft', { state: 'draft' }, 'draft'],
    ['merged', { state: 'merged' }, 'merged'],
    ['closed', { state: 'closed' }, 'closed'],
    ['conflicts', { mergeState: 'dirty' }, 'conflicts'],
    ['ci failed', { checks: { passed: 1, failed: 1, running: 0, total: 2, failedNames: [] } }, 'checks-failed'],
    ['ci running', { checks: { passed: 1, failed: 0, running: 1, total: 2, failedNames: [] } }, 'checks-running'],
    ['review pending', { verdict: null }, 'review-pending'],
    ['changes requested', { verdict: { result: 'block', judgedHead: HEAD } }, 'review-block'],
    ['stale verdict', { verdict: { result: 'pass', judgedHead: '9d03b7a1e6c24f58b0a3d7e19c5f2468ab13c0de' } }, 'review-pending'],
    ['behind', { mergeState: 'behind' }, 'behind'],
    ['blocked by GitHub', { mergeState: 'blocked' }, 'merge-blocked'],
    ['unstable still mergeable', { mergeState: 'unstable' }, 'review-pass'],
  ] satisfies [string, Partial<PrPanelRow>, string][])('%s', (_name, over, expected) => {
    expect(stateOf(over)).toBe(expected);
  });

  test('a failing check outranks a running one', () => {
    expect(stateOf({ checks: { passed: 0, failed: 1, running: 1, total: 2, failedNames: [] } })).toBe(
      'checks-failed',
    );
  });
});

describe('a stale read is reported only for a PR that can still change', () => {
  test('an open PR read long ago carries the age in minutes', () => {
    const model = prCardModelOfRow(row({ lastReadAt: NOW - PR_READ_LATE_MS - 60_000 }), NOW);
    expect(model.readAgoMinutes).toBe(11);
  });

  test('a recent read carries no age', () => {
    expect(prCardModelOfRow(row({ lastReadAt: NOW - 1_000 }), NOW).readAgoMinutes).toBeUndefined();
  });

  test('a row never fully read carries no absurd age', () => {
    expect(prCardModelOfRow(row({ lastReadAt: 0 }), NOW).readAgoMinutes).toBeUndefined();
  });

  test('a merged PR never reads as stale', () => {
    const model = prCardModelOfRow(row({ state: 'merged', lastReadAt: NOW - 3_600_000 }), NOW);
    expect(model.readAgoMinutes).toBeUndefined();
  });
});

describe('list helpers', () => {
  test('a PR with no checks shows no count', () => {
    expect(prChecksText({ passed: 0, failed: 0, running: 0, total: 0, failedNames: [] })).toBeNull();
    expect(prChecksText({ passed: 3, failed: 0, running: 0, total: 4, failedNames: [] })).toBe('3/4');
  });
});

describe('a row whose checks were not read for its current head', () => {
  const OLD = '9d03b7a1e6c24f58b0a3d7e19c5f2468ab13c0de';
  const empty = { passed: 0, failed: 0, running: 0, total: 0, failedNames: [] };

  test('is flagged when the checks were never read', () => {
    expect(prCiUnread(row({ checksReadFor: '', lastReadAt: 0, checks: empty }))).toBe(true);
    expect(prCardModelOfRow(row({ checksReadFor: '', checks: empty }), NOW).ciUnread).toBe(true);
  });

  test('is flagged after a head change whose checks read failed, however fresh lastReadAt is', () => {
    const afterPush = row({ head: HEAD, checksReadFor: OLD, lastReadAt: NOW, checks: empty });
    expect(prCiUnread(afterPush)).toBe(true);
    expect(prCardModelOfRow(afterPush, NOW).state).toBe('open');
  });

  test('never reads as ready to merge', () => {
    expect(stateOf({ checksReadFor: OLD })).toBe('open');
  });

  test('is not flagged once read for the head, or when finished', () => {
    expect(prCiUnread(row())).toBe(false);
    expect(prCiUnread(row({ checksReadFor: '', state: 'merged', checks: empty }))).toBe(false);
    expect(prCiUnread(row({ head: '', checksReadFor: '' }))).toBe(false);
  });
});
