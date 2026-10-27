import assert from 'node:assert/strict';
import test from 'node:test';
import { mainRed } from './delivery-metrics.mjs';

test('overlapping main runs recover at the first qualifying successful completion', () => {
  const actual = mainRed(
    [
      {
        conclusion: 'failure',
        startedAt: '2026-10-25T00:00:00Z',
        completedAt: '2026-10-25T00:05:00Z',
      },
      {
        conclusion: 'success',
        startedAt: '2026-10-25T00:10:00Z',
        completedAt: '2026-10-25T02:00:00Z',
      },
      {
        conclusion: 'success',
        startedAt: '2026-10-25T00:20:00Z',
        completedAt: '2026-10-25T00:30:00Z',
      },
    ],
    new Date('2026-10-26T00:00:00Z'),
  );
  assert.equal(actual.minutes, 30);
  assert.equal(actual.medianRecoveryMinutes, 30);
  assert.equal(actual.stillRed, false);
});

test('a successful completion after the reporting instant cannot recover main yet', () => {
  const actual = mainRed(
    [
      {
        conclusion: 'failure',
        startedAt: '2026-10-25T00:00:00Z',
        completedAt: '2026-10-25T00:05:00Z',
      },
      {
        conclusion: 'success',
        startedAt: '2026-10-25T00:10:00Z',
        completedAt: '2026-10-25T02:00:00Z',
      },
    ],
    new Date('2026-10-25T01:00:00Z'),
  );
  assert.equal(actual.minutes, 60);
  assert.equal(actual.recovered, 0);
  assert.equal(actual.medianRecoveryMinutes, null);
  assert.equal(actual.stillRed, true);
});
