import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRunningSignature } from '../src/signature.ts';

const REQUIREMENT =
  'identifier "io.github.xiechimon.cairn" and certificate root = H"0123456789012345678901234567890123456789"';
const CERTIFICATE = `Identifier=io.github.xiechimon.cairn
Signature size=2146
Authority=Cairn Mac Self-Signed
`;

const DESIGNATED = `designated => ${REQUIREMENT}\n`;

test('a certificate signature preserves the full designated requirement, not the authority name', () => {
  const expected = { kind: 'certificate', requirement: REQUIREMENT };
  assert.deepEqual(parseRunningSignature(DESIGNATED, CERTIFICATE), expected);
  assert.deepEqual(parseRunningSignature('', `${CERTIFICATE}${DESIGNATED}`), expected);
});

test('a certificate signature without a readable designated requirement fails closed', () => {
  for (const stdout of ['', 'designated =>   \n', 'internal => identifier "other"\n']) {
    assert.deepEqual(parseRunningSignature(stdout, CERTIFICATE), { kind: 'unreadable' });
  }
  assert.deepEqual(parseRunningSignature(DESIGNATED, ''), { kind: 'unreadable' });
});

test('only explicit ad-hoc details allow an update without a designated requirement', () => {
  assert.deepEqual(parseRunningSignature('', 'Signature=adhoc\n'), { kind: 'adhoc' });
  assert.deepEqual(parseRunningSignature('', ''), { kind: 'unreadable' });
  assert.deepEqual(parseRunningSignature('Signature=adhoc\n', ''), { kind: 'unreadable' });
  assert.deepEqual(parseRunningSignature('', `${CERTIFICATE}Signature=adhoc\n`), {
    kind: 'unreadable',
  });
});
