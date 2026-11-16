import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { certificateFingerprint, designatedRequirement, signedBy } from './check-signature.mjs';

const BUNDLE = 'io.github.xiechimon.cairn';
const RELEASE_FINGERPRINT = '19AA592374DC19928A4C5494BCAC5A984182EA8A';

test('the committed certificate is the release signing certificate', () => {
  const pem = readFileSync(
    join(import.meta.dirname, '..', 'signing', 'cairn-mac-self-signed.crt'),
    'utf8',
  );
  assert.equal(certificateFingerprint(pem), RELEASE_FINGERPRINT);
});

test('an ad-hoc signature is pinned to one build and fails the check', () => {
  const output = `Executable=/tmp/Cairn.app/Contents/MacOS/Cairn
designated => cdhash H"c7c7d57dd2c79218fd0e3db03a84690e825d8629"
`;
  assert.equal(signedBy(designatedRequirement(output), BUNDLE, RELEASE_FINGERPRINT), false);
});

test('a signature by the release certificate for the app passes', () => {
  for (const anchor of ['leaf', 'root']) {
    const output = `Executable=/tmp/Cairn.app/Contents/MacOS/Cairn
designated => identifier "${BUNDLE}" and certificate ${anchor} = H"${RELEASE_FINGERPRINT.toLowerCase()}"
`;
    assert.equal(signedBy(designatedRequirement(output), BUNDLE, RELEASE_FINGERPRINT), true);
  }
});

test('another certificate or another bundle fails', () => {
  const other = `designated => identifier "${BUNDLE}" and certificate leaf = H"${'0'.repeat(40)}"`;
  const renamed = `designated => identifier "com.example.other" and certificate leaf = H"${RELEASE_FINGERPRINT}"`;
  const widened = `designated => identifier "${BUNDLE}" and certificate leaf = H"${RELEASE_FINGERPRINT}" or anchor trusted`;
  for (const output of [other, renamed, widened, 'Executable=/tmp/Cairn.app\n']) {
    assert.equal(signedBy(designatedRequirement(output), BUNDLE, RELEASE_FINGERPRINT), false);
  }
});
