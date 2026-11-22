import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { signedLikeRunningApp } from '../src/signature.ts';

const CODE_SIGN = '/usr/bin/codesign';
const BUNDLE_ID = 'io.github.xiechimon.cairn';
const COMMON_NAME = 'Cairn Updater CI';
const { GITHUB_ACTIONS, RUNNER_TEMP, CAIRN_TEST_SIGNING_KEYCHAIN } = process.env;

const cases = [
  ['same certificate on a new build is accepted', 'running', 'same', true],
  ['same display name with another certificate is refused', 'running', 'other-certificate', false],
  ['ad-hoc staged signature is refused', 'running', 'adhoc', false],
  ['another identifier signed by the same certificate is refused', 'running', 'other-id', false],
  ['unsigned staged bundle is refused', 'running', 'unsigned', false],
  ['tampered staged bundle is refused', 'running', 'tampered', false],
  ['unreadable running signature is refused', 'missing', 'same', false],
  ['explicitly ad-hoc running bundle can update', 'adhoc', 'same', true],
  ['explicitly unsigned running bundle can update', 'unsigned', 'same', true],
];

describe('macOS updater signature policy', {
  skip: process.platform !== 'darwin' || GITHUB_ACTIONS !== 'true' || !CAIRN_TEST_SIGNING_KEYCHAIN,
}, () => {
  const bundles = new Map();

  before(() => {
    const { CAIRN_TEST_SIGNER, CAIRN_TEST_OTHER_SIGNER } = process.env;
    assert.match(CAIRN_TEST_SIGNER ?? '', /^[A-F0-9]{40}$/);
    assert.match(CAIRN_TEST_OTHER_SIGNER ?? '', /^[A-F0-9]{40}$/);
    assert.notEqual(CAIRN_TEST_SIGNER, CAIRN_TEST_OTHER_SIGNER);
    const root = mkdtempSync(join(RUNNER_TEMP, 'updater-signature-'));
    const binary = join(root, 'unsigned-executable');
    execFileSync('/usr/bin/clang', ['-x', 'c', '-', '-Wl,-no_adhoc_codesign', '-o', binary], {
      input: 'int main(void) { return 0; }',
    });
    const fixtures = [
      ['running', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['same', CAIRN_TEST_SIGNER, BUNDLE_ID],
      ['other-certificate', CAIRN_TEST_OTHER_SIGNER, BUNDLE_ID],
      ['adhoc', '-', BUNDLE_ID],
      ['other-id', CAIRN_TEST_SIGNER, 'com.example.other'],
      ['unsigned', null, BUNDLE_ID],
      ['tampered', CAIRN_TEST_SIGNER, BUNDLE_ID],
    ];
    for (const [name, signer, identifier] of fixtures) {
      const app = join(root, `${name}.app`);
      const contents = join(app, 'Contents');
      mkdirSync(join(contents, 'MacOS'), { recursive: true });
      mkdirSync(join(contents, 'Resources'));
      copyFileSync(binary, join(contents, 'MacOS', 'Fixture'));
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
    bundles.set('missing', join(root, 'missing.app'));
  });

  test('codesign writes both certificate names and the identifier to stderr, not stdout', () => {
    for (const name of ['running', 'other-certificate']) {
      const { status, stdout, stderr } = spawnSync(
        CODE_SIGN,
        ['-d', '--verbose=4', bundles.get(name)],
        { encoding: 'utf8' },
      );
      assert.equal(status, 0);
      assert.equal(stdout, '');
      assert.ok(stderr.split('\n').includes(`Authority=${COMMON_NAME}`));
      assert.ok(stderr.split('\n').includes(`Identifier=${BUNDLE_ID}`));
    }
  });

  for (const [description, running, staged, expected] of cases) {
    test(description, async () => {
      const accepted = await signedLikeRunningApp(bundles.get(running), bundles.get(staged));
      if (accepted !== expected) {
        console.log(`::error::${description}: expected ${expected}, got ${accepted}`);
      }
      assert.equal(accepted, expected);
    });
  }
});
