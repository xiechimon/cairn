import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { certificateFingerprint, designatedRequirement, signedBy } from './check-signature.mjs';

const BUNDLE = 'io.github.xiechimon.cairn';
const RELEASE_FINGERPRINT = '19AA592374DC19928A4C5494BCAC5A984182EA8A';
const CERT = join(import.meta.dirname, '..', 'signing', 'cairn-mac-self-signed.crt');

function runCli({ plistId, requirement }) {
  const bin = makeTestTempDir('check-signature-');
  const tool = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool('plutil', `echo '${plistId}'`);
  tool(
    'codesign',
    `[ "$1" = "--verify" ] && exit 0\necho 'Executable=/tmp/Cairn.app/Contents/MacOS/Cairn' >&2\necho 'designated => ${requirement}'`,
  );
  return spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'check-signature.mjs'), CERT, '/tmp/Cairn.app'],
    { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' },
  ).status;
}

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

test('the CLI pins the Cairn bundle identifier instead of trusting the app', () => {
  const signed = (id) => `identifier "${id}" and certificate leaf = H"${RELEASE_FINGERPRINT}"`;
  assert.equal(runCli({ plistId: BUNDLE, requirement: signed(BUNDLE) }), 0);
  assert.equal(
    runCli({ plistId: 'com.example.other', requirement: signed('com.example.other') }),
    1,
  );
  assert.equal(
    runCli({ plistId: BUNDLE, requirement: 'cdhash H"c7c7d57dd2c79218fd0e3db03a84690e825d8629"' }),
    1,
  );
});
