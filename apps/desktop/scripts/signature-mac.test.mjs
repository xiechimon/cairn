import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';

const CODE_SIGN = '/usr/bin/codesign';
const BUNDLE_ID = 'io.github.xiechimon.cairn';
const COMMON_NAME = 'Cairn Updater CI';
const {
  GITHUB_ACTIONS,
  RUNNER_TEMP,
  CAIRN_TEST_SIGNER,
  CAIRN_TEST_OTHER_SIGNER,
  CAIRN_TEST_SIGNING_KEYCHAIN,
  CAIRN_REQUIRE_MAC_SIGNATURE_TESTS,
} = process.env;

function requirement(fingerprint) {
  return `identifier "${BUNDLE_ID}" and certificate leaf = H"${fingerprint}"`;
}

const ACCEPTED = 0;
const REQUIREMENT_MISMATCH = 3;
const REFUSED = 'refused';

const cases = [
  ['the same certificate on a new build is accepted', 'same', ACCEPTED],
  ['another certificate is refused', 'other-certificate', REQUIREMENT_MISMATCH],
  ['an ad-hoc staged signature is refused', 'adhoc', REQUIREMENT_MISMATCH],
  [
    'another identifier signed by the same certificate is refused',
    'other-id',
    REQUIREMENT_MISMATCH,
  ],
  ['an unsigned staged bundle is refused', 'unsigned', REFUSED],
  ['a tampered staged bundle is refused', 'tampered', REFUSED],
  ['a staged bundle with one signed and one unsigned slice is refused', 'mixed', REFUSED],
  ['a fully signed universal staged bundle is accepted', 'universal', ACCEPTED],
  ['an unreadable staged bundle is refused', 'missing', REFUSED],
];

describe('macOS updater signature policy', {
  skip:
    CAIRN_REQUIRE_MAC_SIGNATURE_TESTS !== '1' &&
    (process.platform !== 'darwin' || GITHUB_ACTIONS !== 'true' || !CAIRN_TEST_SIGNING_KEYCHAIN),
}, () => {
  const bundles = new Map();

  before(() => {
    assert.equal(process.platform, 'darwin', 'The signature suite requires macOS');
    assert.equal(GITHUB_ACTIONS, 'true', 'The signature suite requires GitHub Actions');
    assert.ok(
      CAIRN_TEST_SIGNING_KEYCHAIN && existsSync(CAIRN_TEST_SIGNING_KEYCHAIN),
      'CAIRN_TEST_SIGNING_KEYCHAIN must name an existing keychain',
    );
    assert.ok(RUNNER_TEMP, 'RUNNER_TEMP is required');
    assert.match(CAIRN_TEST_SIGNER ?? '', /^[A-F0-9]{40}$/);
    assert.match(CAIRN_TEST_OTHER_SIGNER ?? '', /^[A-F0-9]{40}$/);
    assert.notEqual(CAIRN_TEST_SIGNER, CAIRN_TEST_OTHER_SIGNER);
    const root = mkdtempSync(join(RUNNER_TEMP, 'updater-signature-'));
    const binary = join(root, 'unsigned-executable');
    execFileSync('/usr/bin/clang', ['-x', 'c', '-', '-Wl,-no_adhoc_codesign', '-o', binary], {
      input: 'int main(void) { return 0; }',
    });
    const armSlice = join(root, 'unsigned-slice-arm64');
    const intelSlice = join(root, 'unsigned-slice-x86_64');
    for (const [arch, slice] of [
      ['arm64', armSlice],
      ['x86_64', intelSlice],
    ]) {
      execFileSync(
        '/usr/bin/clang',
        ['-x', 'c', '-', '-arch', arch, '-Wl,-no_adhoc_codesign', '-o', slice],
        { input: 'int main(void) { return 0; }' },
      );
    }
    const universal = join(root, 'universal-executable');
    execFileSync('/usr/bin/lipo', ['-create', armSlice, intelSlice, '-output', universal]);
    const fixtures = [
      ['running', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['same', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['other-certificate', CAIRN_TEST_OTHER_SIGNER, BUNDLE_ID],
      ['adhoc', '-', BUNDLE_ID],
      ['other-id', CAIRN_TEST_SIGNER, 'com.example.other'],
      ['unsigned', null, BUNDLE_ID],
      ['arm64', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['universal', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['tampered', CAIRN_TEST_SIGNER, BUNDLE_ID],
    ];
    const executables = { universal, arm64: armSlice };
    for (const [name, signer, identifier] of fixtures) {
      const app = join(root, `${name}.app`);
      const contents = join(app, 'Contents');
      mkdirSync(join(contents, 'MacOS'), { recursive: true });
      mkdirSync(join(contents, 'Resources'));
      copyFileSync(executables[name] ?? binary, join(contents, 'MacOS', 'Fixture'));
      writeFileSync(
        join(contents, 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Fixture</string>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${name === 'running' ? '1.0.0' : '1.0.1'}</string>
</dict></plist>`,
      );
      const resource = join(contents, 'Resources', 'fixture.txt');
      writeFileSync(resource, name);
      if (signer !== null) {
        execFileSync(CODE_SIGN, [
          '--sign',
          signer,
          '--keychain',
          CAIRN_TEST_SIGNING_KEYCHAIN,
          '--timestamp=none',
          app,
        ]);
        execFileSync(CODE_SIGN, ['--verify', '--strict', app]);
      }
      if (name === 'tampered') writeFileSync(resource, 'changed after signing');
      bundles.set(name, app);
    }
    const armApp = bundles.get('arm64');
    const mixed = join(root, 'mixed-executable');
    execFileSync('/usr/bin/lipo', [
      '-create',
      join(armApp, 'Contents', 'MacOS', 'Fixture'),
      intelSlice,
      '-output',
      mixed,
    ]);
    copyFileSync(mixed, join(armApp, 'Contents', 'MacOS', 'Fixture'));
    bundles.set('mixed', armApp);
    bundles.set('missing', join(root, 'missing.app'));
  });

  test('both certificate fixtures satisfy the same common name and identifier requirement', () => {
    const commonNameRequirement = `-R=identifier "${BUNDLE_ID}" and certificate leaf[subject.CN] = "${COMMON_NAME}"`;
    for (const name of ['running', 'other-certificate']) {
      execFileSync(CODE_SIGN, ['--verify', '--strict', commonNameRequirement, bundles.get(name)]);
    }
  });

  test('codesign distinguishes certificate, ad-hoc, and unsigned running bundles by exit status', () => {
    for (const [name, expected] of [
      ['running', 0],
      ['adhoc', 3],
      ['unsigned', 1],
    ]) {
      const { status, signal, error, stderr } = spawnSync(
        CODE_SIGN,
        ['--verify', '--strict', '-R=certificate leaf[subject.CN] exists', bundles.get(name)],
        { encoding: 'utf8' },
      );
      assert.ifError(error);
      assert.equal(signal, null);
      assert.equal(status, expected, `${name}: ${stderr}`);
    }
  });

  test('the arm64 signature made on the bundle survives the mixed executable and the production check refuses it', () => {
    const pinned = requirement(CAIRN_TEST_SIGNER);
    execFileSync(CODE_SIGN, [
      '--verify',
      '--strict',
      '--architecture',
      'arm64',
      `-R=${pinned}`,
      bundles.get('mixed'),
    ]);
    const { status, signal, error, stderr } = spawnSync(
      CODE_SIGN,
      ['--verify', '--strict', `-R=${pinned}`, bundles.get('mixed')],
      { encoding: 'utf8' },
    );
    assert.ifError(error);
    assert.equal(signal, null);
    assert.notEqual(status, 0, stderr);
  });

  for (const [description, staged, expected] of cases) {
    test(description, () => {
      const { status, signal, error, stderr } = spawnSync(
        CODE_SIGN,
        ['--verify', '--strict', `-R=${requirement(CAIRN_TEST_SIGNER)}`, bundles.get(staged)],
        { encoding: 'utf8' },
      );
      assert.ifError(error);
      assert.equal(signal, null);
      const actual =
        expected === REFUSED && status !== ACCEPTED && status !== REQUIREMENT_MISMATCH
          ? REFUSED
          : status;
      if (actual !== expected) {
        console.log(
          `::error::${description}: expected ${
            expected === REFUSED ? 'a status that is neither 0 nor 3' : expected
          }, got ${status}: ${stderr}`,
        );
      }
      assert.equal(actual, expected, stderr);
    });
  }
});
