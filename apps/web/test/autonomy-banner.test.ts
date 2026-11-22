import type { AutonomyPauseEntry } from '@cairn/shared';
import { expect, test } from 'vitest';
import { autonomyNotice } from '../src/board/autonomy-banner.js';

const RED = 'a'.repeat(40);

function pause(over: Partial<AutonomyPauseEntry>): AutonomyPauseEntry {
  return {
    id: 'p1',
    source: 'main-red',
    reason: `Main check failed at ${RED} in octo/alpha.`,
    publishError: null,
    openedAt: 1,
    waitsFor: { kind: 'main-green', repo: 'octo/alpha', failedSha: RED },
    ...over,
  };
}

const resumed = { id: 'p0', repo: 'octo/alpha', resolvedReason: 'Main check passed.', resolvedAt: 2 };

test('a red-main pause says what it waits for', () => {
  expect(autonomyNotice({ autonomyPauses: [pause({})], autonomyAutoResume: null }, null)).toEqual({
    kind: 'paused',
    waitsFor: { kind: 'main-green', repo: 'octo/alpha', failedSha: RED },
    manual: false,
  });
});

test('a pause across two repositories does not promise recovery on the first green check', () => {
  const beta = pause({ id: 'p2', waitsFor: { kind: 'main-green', repo: 'octo/beta', failedSha: RED } });
  expect(autonomyNotice({ autonomyPauses: [pause({}), beta], autonomyAutoResume: null }, null)).toEqual({
    kind: 'paused', waitsFor: null, manual: false, multipleRepos: true,
  });
});

test('a manual pause beside a red-main pause says it waits for you', () => {
  expect(
    autonomyNotice(
      {
        autonomyPauses: [pause({}), pause({ id: 'p2', source: 'settings', waitsFor: null })],
        autonomyAutoResume: resumed,
      },
      null,
    ),
  ).toEqual({ kind: 'paused', waitsFor: null, manual: true });
});

test('an unjudged landing retains its pause reason without exposing raw server text', () => {
  const unjudged = pause({ source: 'unjudged-landing', waitsFor: null });
  expect(autonomyNotice({ autonomyPauses: [unjudged], autonomyAutoResume: null }, null)).toMatchObject({
    kind: 'paused', fallbackSource: 'unjudged-landing', manual: false,
  });
});

test('an automatic resume shows once until dismissed', () => {
  const team = { autonomyPauses: [], autonomyAutoResume: resumed };
  expect(autonomyNotice(team, null)).toEqual({ kind: 'resumed', id: 'p0', repo: 'octo/alpha' });
  expect(autonomyNotice(team, 'p0')).toBeNull();
});
