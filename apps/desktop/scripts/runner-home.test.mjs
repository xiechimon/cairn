import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateRunnerHome, runnerHomeFor } from '../src/runner-home.ts';

const HOME = '/Users/tester';
const APP_DATA = join(HOME, 'Library', 'Application Support');
const DEFAULT_USER_DATA = join(APP_DATA, '@cairn/desktop');
const INSTALLED = '/Applications/Cairn.app';

const base = {
  userData: DEFAULT_USER_DATA,
  defaultUserData: DEFAULT_USER_DATA,
  bundle: INSTALLED,
  installedBundle: INSTALLED,
  home: HOME,
};

test('the installed app on its default user data keeps the shared ~/.cairn runner home', () => {
  assert.equal(runnerHomeFor(base), join(HOME, '.cairn'));
});

test('a custom --user-data-dir gets a runner home inside it, never the real ~/.cairn', () => {
  const scratch = '/private/tmp/dogfood/run-b/user-data';
  assert.equal(runnerHomeFor({ ...base, userData: scratch }), join(scratch, 'runner-home'));
});

test('a non-installed bundle on default user data does not share the real ~/.cairn', () => {
  assert.equal(
    runnerHomeFor({ ...base, bundle: '/private/tmp/dogfood/run-b/apps/Cairn.app' }),
    join(DEFAULT_USER_DATA, 'runner-home'),
  );
});

test('a dev (non-.app) bundle does not share the real ~/.cairn', () => {
  assert.equal(
    runnerHomeFor({ ...base, bundle: '/repo/node_modules/electron/dist/Electron.app' }),
    join(DEFAULT_USER_DATA, 'runner-home'),
  );
});

test('resolving inside the real ~/.cairn for a non-installed instance refuses to start', () => {
  assert.throws(
    () => runnerHomeFor({ ...base, userData: join(HOME, '.cairn'), bundle: '/tmp/x/Cairn.app' }),
    /non-installed/,
  );
});

function vmImageUnder(home) {
  const snapshot = join(home, 'vm', 'app', 'snapshots', 'abc', 'snapshot');
  mkdirSync(join(snapshot, '..'), { recursive: true });
  writeFileSync(snapshot, 'ext4');
  return snapshot;
}

test('a VM image the container system recorded under the old runner home still opens after migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-home-'));
  const legacy = join(root, 'userData', 'runner');
  const target = join(root, 'home', '.cairn');
  const recorded = vmImageUnder(legacy);
  migrateRunnerHome(legacy, target);
  assert.deepEqual(readdirSync(join(target, 'vm', 'app', 'snapshots')), ['abc']);
  assert.equal(readFileSync(recorded, 'utf8'), 'ext4');
});

test('an install migrated before the fix gets its old VM paths back on the next start', () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-home-'));
  const legacy = join(root, 'userData', 'runner');
  const target = join(root, 'home', '.cairn');
  const recorded = vmImageUnder(legacy);
  mkdirSync(target, { recursive: true });
  renameSync(join(legacy, 'vm'), join(target, 'vm'));
  migrateRunnerHome(legacy, target);
  assert.equal(readFileSync(recorded, 'utf8'), 'ext4');
});

test('an entry left behind because the new home already had one keeps its old path', () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-home-'));
  const legacy = join(root, 'userData', 'runner');
  const target = join(root, 'home', '.cairn');
  const recorded = vmImageUnder(legacy);
  mkdirSync(join(legacy, 'workspaces'), { recursive: true });
  mkdirSync(join(target, 'workspaces'), { recursive: true });
  writeFileSync(join(legacy, 'workspaces', 'old'), 'kept');
  migrateRunnerHome(legacy, target);
  assert.equal(readFileSync(recorded, 'utf8'), 'ext4');
  assert.equal(readFileSync(join(legacy, 'workspaces', 'old'), 'utf8'), 'kept');
});
