import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { runnerHomeFor } from '../src/runner-home.ts';

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
