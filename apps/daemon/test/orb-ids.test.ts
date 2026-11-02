import { expect, test } from 'vitest';
import { isOrbPathId } from '../src/orb/protocol.js';

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
