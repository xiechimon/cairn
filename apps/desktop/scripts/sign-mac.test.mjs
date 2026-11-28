import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const { signsOnItsOwn } = createRequire(import.meta.url)('./sign-mac.cjs');

const MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]);

function fixtureApp() {
  const app = join(makeTestTempDir('sign-mac-'), 'Cairn.app');
  const put = (path, body) => {
    mkdirSync(join(app, path, '..'), { recursive: true });
    writeFileSync(join(app, path), body);
  };
  put('Contents/MacOS/Cairn', MACH_O);
  put('Contents/Frameworks/Lib.framework/Versions/A/Lib', MACH_O);
  symlinkSync('A', join(app, 'Contents/Frameworks/Lib.framework/Versions/Current'));
  put('Contents/Resources/server/prebuilds/sqlite.node', MACH_O);
  put('Contents/Resources/server/prebuilds/linux.so', Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  put('Contents/Resources/app.asar', Buffer.from([4, 0, 0, 0, 0xff, 0x00]));
  put('Contents/Resources/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  return app;
}

test('signing touches only Mach-O code reached by its real path, and leaves the main executable to the bundle seal', () => {
  const app = fixtureApp();
  const signs = signsOnItsOwn(app);
  const at = (path) => signs(join(app, path));
  assert.equal(at('Contents/Frameworks/Lib.framework'), true);
  assert.equal(at('Contents/Frameworks/Lib.framework/Versions/A/Lib'), true);
  assert.equal(at('Contents/Resources/server/prebuilds/sqlite.node'), true);
  assert.equal(at('Contents/Frameworks/Lib.framework/Versions/Current/Lib'), false);
  assert.equal(at('Contents/MacOS/Cairn'), false);
  assert.equal(at('Contents/Resources/server/prebuilds/linux.so'), false);
  assert.equal(at('Contents/Resources/app.asar'), false);
  assert.equal(at('Contents/Resources/icon.png'), false);
});
