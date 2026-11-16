import { expect, test } from 'vitest';
import { parseAssignments } from '../src/resources/bulk-secret-dialog.js';

test('bulk add keeps every = after the first in the value and strips one pair of matching quotes', () => {
  const text = [
    "API_KEY='secret-value'",
    '# comment',
    '',
    'DATABASE_URL=postgres://u:p@h/db?sslmode=require',
    'MIXED="half\'',
    'EMPTY=',
    '  PADDED_NAME  =  spaced  ',
  ].join('\n');
  expect(parseAssignments(text)).toEqual({
    entries: [
      { name: 'API_KEY', value: 'secret-value' },
      { name: 'DATABASE_URL', value: 'postgres://u:p@h/db?sslmode=require' },
      { name: 'MIXED', value: '"half\'' },
      { name: 'EMPTY', value: '' },
      { name: 'PADDED_NAME', value: 'spaced' },
    ],
    badLines: [],
  });
});

test('bulk add reports the 1-based line of a missing = or a name outside the env var format', () => {
  const text = ['GOOD=1', 'lower=2', 'NO_EQUALS', '9LIVES=3', 'mail.x=4'].join('\n');
  expect(parseAssignments(text)).toEqual({
    entries: [{ name: 'GOOD', value: '1' }],
    badLines: [2, 3, 4, 5],
  });
});
