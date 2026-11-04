import { expect, test } from 'vitest';
import { redactSecrets } from '../src/index.js';

test('redacts credentials in nested values and keys without changing the source', () => {
  const token = `ghp_${'A'.repeat(36)}`;
  const nested = { [token]: `Bearer ${token}` };
  const source = { nested: [nested], normal: 12, nullable: null };
  expect(redactSecrets(source)).toEqual({
    value: { nested: [{ '[REDACTED]': '[REDACTED]' }], normal: 12, nullable: null },
    count: 2,
  });
  expect(Object.keys(nested)).toEqual([token]);
});

test.each([
  `sk-${'a'.repeat(32)}`,
  `github_pat_${'a'.repeat(40)}`,
  `v1:${'a'.repeat(40)}`,
  'Bearer abc.def-ghi_123',
])('recognizes credential family %s', (token) => {
  expect(redactSecrets(`before ${token} after`)).toEqual({
    value: 'before [REDACTED] after',
    count: 1,
  });
});

test('preserves ordinary text and has no regex state between calls', () => {
  expect(redactSecrets('sk- task ghp_ issue v1:release')).toEqual({
    value: 'sk- task ghp_ issue v1:release',
    count: 0,
  });
  const token = `ghp_${'A'.repeat(36)}`;
  expect(redactSecrets(token)).toEqual(redactSecrets(token));
});

test('rejects redacted key collisions instead of losing data', () => {
  expect(() =>
    redactSecrets({ [`ghp_${'a'.repeat(36)}`]: 1, [`ghp_${'b'.repeat(36)}`]: 2 }),
  ).toThrow();
});
