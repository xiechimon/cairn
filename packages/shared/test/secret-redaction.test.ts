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

const A = 'A'.repeat(44);
const ghp = (fill: string) => `ghp_${fill.repeat(36)}`;
const pat = (fill: string) => `github_pat_${fill.repeat(40)}`;
const sk = (fill: string) => `sk-${fill.repeat(32)}`;
const envelope = (fill: string) => `v1:${fill.repeat(44)}`;

test.each([
  [
    'Bearer then Bearer',
    'Authorization: Bearer first-secretBearer second-secret',
    'Authorization: ',
  ],
  ['Bearer then v1 envelope', `x Bearer tokv1:${A}`, 'x '],
  ['Bearer then ghp_', `Bearer abc${ghp('C')}`, ''],
  ['Bearer then github_pat_', `Bearer abc${pat('C')}`, ''],
  ['Bearer then sk-', `Bearer abc${sk('C')}`, ''],
  ['envelope then envelope', `${envelope('A')}${envelope('B')}`, ''],
  ['envelope then Bearer', `${envelope('A')}Bearer tail-secret`, ''],
  ['ghp_ then ghp_', `${ghp('A')}${ghp('B')}`, ''],
  ['ghp_ then github_pat_', `${ghp('A')}${pat('B')}`, ''],
  ['github_pat_ then sk-', `${pat('A')}${sk('B')}`, ''],
  ['sk- then sk-', `${sk('A')}${sk('B')}`, ''],
  ['sk- then envelope', `${sk('A')}${envelope('B')}`, ''],
  ['sk- then Bearer', `${sk('A')}Bearer tail-secret`, ''],
])('leaves no secret material when %s are glued', (_name, text, residue) => {
  const { value, count } = redactSecrets(text);
  expect(count).toBeGreaterThan(0);
  expect((value as string).replaceAll('[REDACTED]', '')).toBe(residue);
});

test('a Bearer token that is itself a known credential stays one match', () => {
  expect(redactSecrets(`Bearer ${ghp('A')}`)).toEqual({ value: '[REDACTED]', count: 1 });
  expect(redactSecrets(`Bearer ${sk('A')}`)).toEqual({ value: '[REDACTED]', count: 1 });
});

test.each([
  ['ghp_', `ghp_${'A'.repeat(10)}ghp_${'B'.repeat(22)}`],
  ['sk-', `sk-${'A'.repeat(10)}sk-${'B'.repeat(22)}`],
  ['github_pat_', `github_pat_${'A'.repeat(10)}ghp_${'B'.repeat(22)}`],
])(
  'a %s credential with an embedded prefix before its minimum length is fully redacted',
  (_name, text) => {
    expect(redactSecrets(text)).toEqual({ value: '[REDACTED]', count: 1 });
  },
);

test.each([
  ['ghp_', 'ghp_'],
  ['sk-', 'sk-'],
  ['Bearer', 'Bearer '],
  ['v1:', 'v1:'],
])('repeated %s prefixes redact in linear time', (_name, unit) => {
  const text = unit.repeat(16384);
  const started = performance.now();
  redactSecrets(text);
  expect(performance.now() - started).toBeLessThan(500);
});

test('redacts login URLs, authorization headers and explicit access tokens', () => {
  const token = 'synthetic-access-token-for-logs';
  const source = {
    url: `http://localhost/app#token=${token}`,
    stream: `/stream?token=${token}`,
    headers: { Authorization: 'Basic dXNlcjpwYXNz', authorization: 'custom credential' },
    error: `access denied for ${token}`,
  };
  const text = JSON.stringify(redactSecrets(source, [token]).value);
  expect(text.includes(token)).toBe(false);
  expect(text.includes('#token=')).toBe(false);
  expect(text.includes('dXNlcjpwYXNz')).toBe(false);
  expect(text.includes('custom credential')).toBe(false);
});

test('preserves query separators when redacting token parameters', () => {
  expect(redactSecrets('/stream?token=synthetic&other=1').value).toBe('/stream?[REDACTED]&other=1');
});

test('authorization redaction preserves incomplete Bearer prefixes and surrounding text', () => {
  expect(redactSecrets('Authorization: Bearer ').value).toBe('Authorization: Bearer ');
  expect(redactSecrets('Authorization: Basic dXNlcjpwYXNz after').value).toBe(
    'Authorization: [REDACTED] after',
  );
});

test('preserves ordinary Basic prose outside an authorization header', () => {
  expect(redactSecrets('Basic functionality and basic examples').value).toBe(
    'Basic functionality and basic examples',
  );
});
