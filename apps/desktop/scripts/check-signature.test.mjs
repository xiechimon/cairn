import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  cairnRequirement,
  certificateFingerprint,
  designatedRequirement,
  signedBy,
} from './check-signature.mjs';

const { CAIRN_REQUIREMENT } = await import('../src/signature.ts');

const BUNDLE = 'io.github.xiechimon.cairn';
const RELEASE_FINGERPRINT = '0534637BC4A0AE2E430CFF4D16661F5EA9899DCB';
const CERT = join(import.meta.dirname, '..', 'signing', 'cairn-mac-self-signed.crt');

function runCli({ plistId, requirement, pinned = 0 }) {
  const bin = makeTestTempDir('check-signature-');
  const tool = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool('plutil', `echo '${plistId}'`);
  tool(
    'codesign',
    `case "$*" in
  *"-R="*) exit ${pinned} ;;
  --verify*) exit 0 ;;
esac
echo 'Executable=/tmp/Cairn.app/Contents/MacOS/Cairn' >&2
echo 'designated => ${requirement}'`,
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

test('the release check requires the requirement the updater installs against', () => {
  const signed = `identifier "${BUNDLE}" and certificate leaf = H"${RELEASE_FINGERPRINT}"`;
  assert.equal(runCli({ plistId: BUNDLE, requirement: signed }), 0);
  assert.equal(runCli({ plistId: BUNDLE, requirement: signed, pinned: 1 }), 1);
});

test('the release check builds the same requirement the updater uses', () => {
  assert.equal(
    cairnRequirement(certificateFingerprint(readFileSync(CERT, 'utf8'))),
    CAIRN_REQUIREMENT,
  );
});
