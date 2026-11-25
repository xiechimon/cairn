import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  DESKTOP_MANIFEST_URL,
  DESKTOP_RELEASES_BASE,
} from '../../../packages/shared/src/desktop-shell.ts';
import { emptyUpdateState, readUpdateState, writeUpdateState } from '../src/update-state.ts';

const CODESIGN = '/usr/bin/codesign';
const DITTO = '/usr/bin/ditto';
const OFFERED_VERSION = '1.2.0';
const OFFERED_FILE = `Cairn-${OFFERED_VERSION}.zip`;
const SIGNATURE_ERROR = 'the staged update is not signed by the Cairn certificate';
const SHARED = pathToFileURL(
  join(import.meta.dirname, '../../../packages/shared/src/desktop-shell.ts'),
).href;
const ELECTRON = 'file:///cairn-test-electron.mjs';
const calls = [];
const spawns = [];
let verify = null;
const electron = { userData: '', relaunched: 0 };

globalThis.__cairnTestElectronApp = {
  isPackaged: true,
  getVersion: () => '1.0.0',
  getPath: () => electron.userData,
  relaunch: () => {
    electron.relaunched += 1;
  },
  quit: () => assert.fail('apply must not quit'),
  exit: () => assert.fail('apply must not exit'),
};

const originalExecFile = childProcess.execFile;
const originalSpawn = childProcess.spawn;
childProcess.execFile = Object.assign(() => assert.fail('Expected promisified execFile'), {
  [promisify.custom]: async (file, args) => {
    calls.push({ file, args });
    if (file === CODESIGN) {
      await verify?.();
    } else if (file === DITTO) {
      const [, , zip, staging] = args;
      const version = /^Cairn-(.+)\.zip$/.exec(basename(zip))?.[1];
      assert.ok(version);
      assert.equal(dirname(realpathSync(staging)), dirname(electron.userData));
      assert.deepEqual(args, ['-x', '-k', join(staging, `Cairn-${version}.zip`), staging]);
      writeApp(join(staging, 'Cairn.app'), version);
    } else {
      assert.equal(file, '/bin/rm');
    }
    return { stdout: '', stderr: '' };
  },
});
childProcess.spawn = (file, args) => {
  spawns.push({ file, args });
  return { unref: () => {} };
};
syncBuiltinESMExports();
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: ELECTRON, shortCircuit: true };
    if (specifier === '@cairn/shared') return { url: SHARED, shortCircuit: true };
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
  load(url, context, nextLoad) {
    return url === ELECTRON
      ? {
          format: 'module',
          source: 'export const app = globalThis.__cairnTestElectronApp;',
          shortCircuit: true,
        }
      : nextLoad(url, context);
  },
});
const { createUpdater } = await import('../src/updater.ts');
hooks.deregister();
after(() => {
  childProcess.execFile = originalExecFile;
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
});

const { CAIRN_REQUIREMENT } = await import('../src/signature.ts');
const { readBundleVersion } = await import('../src/update-swap.ts');

function codesignCall(app) {
  return { file: CODESIGN, args: ['--verify', '--strict', `-R=${CAIRN_REQUIREMENT}`, app] };
}

function codesignFailure(code, details = {}) {
  return Object.assign(new Error('codesign failed'), { code, ...details });
}

function writeApp(app, version) {
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'MacOS', 'Cairn'), '', { mode: 0o755 });
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.xiechimon.cairn</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`,
  );
}

function fixture(t, stagedVersion = '9.9.9') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-apply-')));
  const userData = join(root, 'userData');
  const bundle = join(root, 'Cairn.app');
  const staging = join(root, '.cairn-update-abc');
  const stagedApp = join(staging, 'Cairn.app');
  const statePath = join(userData, 'update-state.json');
  const initial = {
    ...emptyUpdateState(),
    staged: {
      version: '1.1.0',
      zip: join(staging, 'Cairn-1.1.0.zip'),
      app: stagedApp,
      previousVersion: '1.0.0',
      at: 1,
    },
  };
  writeApp(bundle, '1.0.0');
  writeApp(stagedApp, stagedVersion);
  writeUpdateState(statePath, initial);
  electron.userData = userData;
  electron.relaunched = 0;
  const execPath = process.execPath;
  process.execPath = join(bundle, 'Contents', 'MacOS', 'Cairn');
  t.after(() => {
    process.execPath = execPath;
  });
  calls.length = 0;
  spawns.length = 0;
  verify = null;
  return { root, bundle, staging, stagedApp, statePath, initial };
}

test('an ad-hoc installed copy passes the gate for a staged app the Cairn certificate signed', async (t) => {
  const { stagedApp, statePath } = fixture(t);
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  await assert.rejects(updater.apply('none'), {
    message: 'the staged app is version 9.9.9, not 1.1.0',
  });
  assert.deepEqual(calls, [codesignCall(stagedApp)]);
  assert.deepEqual(updater.state(), {
    status: 'error',
    message: 'the staged app is version 9.9.9, not 1.1.0',
  });
  assert.equal(readUpdateState(statePath).staged, null);
  assert.equal(electron.relaunched, 0);
});

test('a staged update removed from disk is dropped instead of retried forever', async (t) => {
  const { staging, statePath } = fixture(t, '1.1.0');
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  rmSync(staging, { recursive: true });
  await assert.rejects(updater.apply('none'), { message: 'the staged update is missing' });
  assert.deepEqual(calls, []);
  assert.equal(readUpdateState(statePath).staged, null);
});

test('a check downloads again when the staged update vanished from disk', async (t) => {
  const { staging, statePath, initial } = fixture(t, '1.1.0');
  const zip = 'fake zip content';
  const offered = initial.staged.version;
  const file = `Cairn-${offered}.zip`;
  t.mock.method(globalThis, 'fetch', async (url) =>
    url === DESKTOP_MANIFEST_URL
      ? Response.json({
          version: offered,
          files: {
            [process.arch]: {
              name: file,
              size: Buffer.byteLength(zip),
              sha256: createHash('sha256').update(zip).digest('hex'),
            },
          },
        })
      : new Response(zip),
  );
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  rmSync(staging, { recursive: true });
  await updater.check();
  const staged = readUpdateState(statePath).staged;
  assert.deepEqual(updater.state(), { status: 'ready', version: offered });
  assert.notEqual(staged?.app, initial.staged.app);
  assert.equal(await readBundleVersion(staged.app), offered);
});

test('exit 3 clears only staging and skips the refused version until a newer offer', async (t) => {
  const { root, staging, stagedApp, statePath, initial } = fixture(t);
  const fresh = {
    ...initial,
    installed: {
      version: '1.0.0',
      previousVersion: '0.9.0',
      previousApp: join(root, '.cairn-previous', 'Cairn.app'),
      at: 2,
    },
    blocked: { version: '0.9.5', reason: 'failed to boot', attempts: 1, at: 3 },
    notice: {
      failedVersion: '0.9.5',
      restoredVersion: '0.9.0',
      reason: 'failed to boot',
      logPath: join(root, 'update.log'),
      at: 3,
    },
  };
  verify = async () => {
    await Promise.resolve();
    writeUpdateState(statePath, fresh);
    throw codesignFailure(3);
  };
  const zip = 'fake zip content';
  let offered = initial.staged.version;
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    const file = `Cairn-${offered}.zip`;
    if (url === DESKTOP_MANIFEST_URL) {
      return Response.json({
        version: offered,
        files: {
          [process.arch]: {
            name: file,
            size: Buffer.byteLength(zip),
            sha256: createHash('sha256').update(zip).digest('hex'),
          },
        },
      });
    }
    assert.equal(url, `${DESKTOP_RELEASES_BASE}/download/desktop-v${offered}/${file}`);
    return new Response(zip);
  });
  const requested = () => fetch.mock.calls.map((call) => call.arguments[0]);
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  await assert.rejects(updater.apply('none'), { message: SIGNATURE_ERROR });
  assert.deepEqual(updater.state(), { status: 'error', message: SIGNATURE_ERROR });
  const afterRefusal = readUpdateState(statePath);
  const folders = readdirSync(root).sort();

  await updater.check();
  assert.deepEqual(requested(), [DESKTOP_MANIFEST_URL], 'automatic staging must not re-download');
  assert.deepEqual(readdirSync(root).sort(), folders);
  assert.deepEqual(updater.state(), { status: 'error', message: SIGNATURE_ERROR });

  await updater.install();
  assert.deepEqual(requested(), [DESKTOP_MANIFEST_URL], 'manual staging must not re-download');
  assert.deepEqual(readdirSync(root).sort(), folders);
  assert.deepEqual(readUpdateState(statePath), afterRefusal);

  offered = OFFERED_VERSION;
  await updater.check();

  assert.deepEqual(updater.state(), { status: 'ready', version: OFFERED_VERSION });
  assert.deepEqual(afterRefusal, { ...fresh, staged: null });
  const updated = readUpdateState(statePath);
  assert.equal(updated.staged?.version, OFFERED_VERSION);
  assert.notEqual(updated.staged.app, stagedApp);
  assert.equal(await readBundleVersion(updated.staged.app), OFFERED_VERSION);
  assert.deepEqual({ ...updated, staged: null }, { ...fresh, staged: null });
  assert.deepEqual(requested(), [
    DESKTOP_MANIFEST_URL,
    DESKTOP_MANIFEST_URL,
    `${DESKTOP_RELEASES_BASE}/download/desktop-v${OFFERED_VERSION}/${OFFERED_FILE}`,
  ]);
  assert.deepEqual(calls, [
    codesignCall(stagedApp),
    { file: DITTO, args: ['-x', '-k', updated.staged.zip, dirname(updated.staged.app)] },
  ]);
  assert.deepEqual(spawns, []);
  assert.equal(existsSync(staging), true);
  assert.equal(existsSync(stagedApp), true);
  assert.equal(electron.relaunched, 0);
});

for (const [description, error] of [
  ['exit 1', codesignFailure(1)],
  ['a signal', codesignFailure(null, { signal: 'SIGTERM' })],
  ['a spawn error', codesignFailure('ENOENT')],
]) {
  test(`${description} reports a refusal and keeps the staged record for a retry`, async (t) => {
    const { staging, stagedApp, statePath, initial } = fixture(t);
    verify = () => {
      throw error;
    };
    const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
    await assert.rejects(updater.apply('none'), { message: SIGNATURE_ERROR });
    assert.deepEqual(updater.state(), { status: 'error', message: SIGNATURE_ERROR });
    assert.deepEqual(readUpdateState(statePath), initial);
    assert.deepEqual(calls, [codesignCall(stagedApp)]);
    assert.deepEqual(spawns, []);
    assert.equal(existsSync(staging), true);
    assert.equal(electron.relaunched, 0);
  });
}

test('exit 3 keeps a record changed to a different app during verification', async (t) => {
  const { root, stagedApp, statePath, initial } = fixture(t);
  const newStaging = join(root, '.cairn-update-new');
  const newApp = join(newStaging, 'Cairn.app');
  writeApp(newApp, OFFERED_VERSION);
  const fresh = {
    ...initial,
    staged: {
      ...initial.staged,
      app: newApp,
      version: OFFERED_VERSION,
      zip: join(newStaging, OFFERED_FILE),
      at: 2,
    },
  };
  verify = async () => {
    await Promise.resolve();
    writeUpdateState(statePath, fresh);
    throw codesignFailure(3);
  };
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  await assert.rejects(updater.apply('none'), { message: SIGNATURE_ERROR });
  assert.deepEqual(updater.state(), { status: 'error', message: SIGNATURE_ERROR });
  assert.deepEqual(readUpdateState(statePath), fresh);
  assert.deepEqual(calls, [codesignCall(stagedApp)]);
  assert.deepEqual(spawns, []);
  assert.equal(existsSync(stagedApp), true);
  assert.equal(existsSync(newApp), true);
});

test('a foreground apply with no staged bundle fails with an explicit error instead of returning silently', async (t) => {
  const { statePath } = fixture(t, '1.1.0');
  writeUpdateState(statePath, emptyUpdateState());
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  await assert.rejects(updater.apply('foreground'), { message: 'the staged update is missing' });
  assert.deepEqual(updater.state(), {
    status: 'error',
    message: 'the staged update is missing',
  });
});

test('exit 0 applies the staged build and keeps the previous bundle for rollback', async (t) => {
  const { root, bundle, staging, stagedApp, statePath, initial } = fixture(t, '1.1.0');
  const previousApp = join(root, '.cairn-previous', 'Cairn.app');
  const updater = createUpdater(() => {}, { beforeRelaunch: () => {} });
  await updater.apply('none');
  assert.equal(await readBundleVersion(bundle), initial.staged.version);
  assert.equal(await readBundleVersion(previousApp), initial.staged.previousVersion);
  assert.equal(existsSync(stagedApp), false);
  const installed = readUpdateState(statePath);
  assert.deepEqual(installed, {
    ...initial,
    staged: null,
    installed: {
      version: initial.staged.version,
      previousVersion: initial.staged.previousVersion,
      previousApp,
      at: installed.installed.at,
    },
    knownVersion: initial.staged.version,
  });
  assert.deepEqual(calls, [
    codesignCall(stagedApp),
    { file: '/bin/rm', args: ['-rf', previousApp] },
  ]);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].file, '/bin/sh');
  assert.equal(spawns[0].args.at(-1), staging);
  assert.equal(electron.relaunched, 0);
});
