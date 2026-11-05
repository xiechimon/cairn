import { expect, test } from 'vitest';
import { isOrbPathId, orbReleaseFromEntry } from '../src/orb/protocol.js';

test.each([
  '_L-wtSVW5r2DDd_H2KLV8',
  'TEWq6n_cfF6HtlNBFhN30',
  '3WkwUHcN0Ne8eiIaTrCLf',
  '01a199ed-8eef-72c7-9c4a-eb862d5b338c',
])('accepts the record id %s that the server issues', (id) => {
  expect(isOrbPathId(id)).toBe(true);
});

test.each(['', '.', '..', '../x', 'a/b', 'a\\b', 'a b', 'a.b', `a${'\0'}b`, 'a'.repeat(129)])(
  'rejects %j as an orb path component',
  (id) => {
    expect(isOrbPathId(id)).toBe(false);
  },
);

test('a release is read from a published dist entry and nothing else', () => {
  const key = '1.0.0-abcd1234-dist-0123456789abcdef';
  expect(orbReleaseFromEntry(`/opt/cairn/daemon/releases/${key}/dist/cli.mjs`)).toBe(key);
  expect(() => orbReleaseFromEntry('/opt/cairn/daemon/cli.mjs')).toThrow(/releases/);
  expect(() => orbReleaseFromEntry(`/opt/cairn/daemon/releases/${key}/dist/other.mjs`)).toThrow(
    /releases/,
  );
  expect(() => orbReleaseFromEntry('/opt/cairn/daemon/releases/not-a-key/dist/cli.mjs')).toThrow();
});
