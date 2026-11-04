import { expect, test } from 'vitest';
import { hasDoneBuildLeg } from '../src/board/use-thread-chat.js';

test('a done session step counts as a finished implementation leg', () => {
  expect(hasDoneBuildLeg([{ kind: 'session', status: 'done' }])).toBe(true);
});

test('a done build step still counts', () => {
  expect(hasDoneBuildLeg([{ kind: 'build', status: 'done' }])).toBe(true);
});

test('a failed session or a done verify step does not count', () => {
  expect(
    hasDoneBuildLeg([
      { kind: 'session', status: 'failed' },
      { kind: 'verify', status: 'done' },
    ]),
  ).toBe(false);
});
