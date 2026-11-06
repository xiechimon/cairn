import type { PrPanelRow } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  PR_READ_LATE_MS,
  prByThread,
  prCardModelOfRow,
  prChecksText,
} from '../src/components/thread/pr-panel-model.js';

const HEAD = '4f8e2c1d9b0a63e57c1f08a2d4b6e9137a5c80de';
const NOW = 1_000_000_000;

function row(over: Partial<PrPanelRow> = {}): PrPanelRow {
  return {
    buildId: 'b1',
    threadId: 't1',
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

  test('a merged PR never reads as stale', () => {
    const model = prCardModelOfRow(row({ state: 'merged', lastReadAt: NOW - 3_600_000 }), NOW);
    expect(model.readAgoMinutes).toBeUndefined();
  });
});

describe('list helpers', () => {
  test('the first row of a thread wins', () => {
    const byThread = prByThread([row({ number: 1 }), row({ buildId: 'b2', number: 2 })]);
    expect(byThread.get('t1')?.number).toBe(1);
    expect(prByThread(undefined).size).toBe(0);
  });

  test('a PR with no checks shows no count', () => {
    expect(prChecksText({ passed: 0, failed: 0, running: 0, total: 0, failedNames: [] })).toBeNull();
    expect(prChecksText({ passed: 3, failed: 0, running: 0, total: 4, failedNames: [] })).toBe('3/4');
  });
});
