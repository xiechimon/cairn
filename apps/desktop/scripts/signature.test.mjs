import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSigningIdentity, signatureMatches } from '../src/signature.ts';

const RELEASE = `Executable=/Applications/Cairn.app/Contents/MacOS/Cairn
Identifier=io.github.xiechimon.cairn
Format=app bundle with Mach-O thin (arm64)
CDHash=5f73f6d85a183b8cb154255bbf7a377ca9016717
Signature size=2146
Authority=Cairn Mac Self-Signed
`;

const ADHOC = `Executable=/tmp/Cairn.app/Contents/MacOS/Cairn
Identifier=io.github.xiechimon.cairn
Signature=adhoc
`;

test('the identity comes from the codesign lines that name it', () => {
  assert.deepEqual(parseSigningIdentity(RELEASE), {
    identifier: 'io.github.xiechimon.cairn',
    authority: 'Cairn Mac Self-Signed',
  });
  assert.deepEqual(parseSigningIdentity(ADHOC), {
    identifier: 'io.github.xiechimon.cairn',
    authority: null,
  });
  assert.deepEqual(parseSigningIdentity(''), { identifier: null, authority: null });
});

test('a copy signed by the identity that signed the running app is accepted', () => {
  const running = parseSigningIdentity(RELEASE);
  assert.equal(signatureMatches(running, parseSigningIdentity(RELEASE)), true);
});

test('a copy signed by anyone else, or by nobody, is refused', () => {
  const running = parseSigningIdentity(RELEASE);
  const other = parseSigningIdentity(RELEASE.replace('Cairn Mac Self-Signed', 'Someone Else'));
  assert.equal(signatureMatches(running, other), false);
  assert.equal(signatureMatches(running, parseSigningIdentity(ADHOC)), false);
  assert.equal(
    signatureMatches(running, {
      identifier: 'com.example.other',
      authority: 'Cairn Mac Self-Signed',
    }),
    false,
  );
});

test('a running app with no signing identity has nothing to compare against', () => {
  assert.equal(signatureMatches(parseSigningIdentity(ADHOC), parseSigningIdentity(RELEASE)), true);
});
