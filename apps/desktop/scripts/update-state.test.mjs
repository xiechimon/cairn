import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  emptyUpdateState,
  isAutoInstallBlocked,
  isStaleInstall,
  parseUpdateState,
  readUpdateState,
  shouldStage,
  stagedFor,
  writeUpdateState,
} from '../src/update-state.ts';

function scratch() {
  return mkdtempSync(join(tmpdir(), 'cairn-update-state-'));
}

test('a missing or unreadable state file reads as empty', () => {
  const dir = scratch();
  assert.deepEqual(readUpdateState(join(dir, 'update-state.json')), emptyUpdateState());
  const path = join(dir, 'garbage.json');
  writeFileSync(path, '{"staged": 4, "installed": null}');
  assert.deepEqual(readUpdateState(path), emptyUpdateState());
});

test('every field of a written state comes back, and the file is private', () => {
  const dir = scratch();
  const path = join(dir, 'update-state.json');
  const state = {
    staged: {
      version: '0.1.536',
      zip: '/Applications/.cairn-update-a/Cairn-0.1.536.zip',
      app: '/Applications/.cairn-update-a/Cairn.app',
      previousVersion: '0.1.535',
      at: 1_795_193_629_754,
    },
    installed: null,
    blocked: null,
    notice: null,
    knownVersion: '0.1.535',
  };
  writeUpdateState(path, state);
  assert.deepEqual(readUpdateState(path), state);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.ok(readFileSync(path, 'utf8').endsWith('\n'), 'the state file ends with a newline');
});

test('a version that failed a first start is not auto-installed again', () => {
  const state = {
    ...emptyUpdateState(),
    blocked: { version: '0.1.536', at: 1, reason: 'server exited with code 1', attempts: 1 },
  };
  assert.equal(isAutoInstallBlocked(state, '0.1.536'), true);
  assert.equal(state.blocked.attempts, 1);
  assert.equal(isAutoInstallBlocked(state, '0.1.537'), false);
});

test('a checkout that already holds a verified staged update does not download another', () => {
  const staged = {
    ...emptyUpdateState(),
    staged: {
      version: '0.1.545',
      zip: '/Applications/.cairn-update-a/Cairn-0.1.545.zip',
      app: '/Applications/.cairn-update-a/Cairn.app',
      previousVersion: '0.1.544',
      at: 1,
    },
  };
  assert.equal(shouldStage(staged, '0.1.545'), false);
  assert.equal(shouldStage(staged, '0.1.546'), false);
  assert.equal(shouldStage(emptyUpdateState(), '0.1.546'), true);
  const blocked = {
    ...emptyUpdateState(),
    blocked: { version: '0.1.536', at: 1, reason: 'x', attempts: 1 },
  };
  assert.equal(shouldStage(blocked, '0.1.536'), false);
});

test('a staged update is only usable by the version that staged it', () => {
  const state = {
    ...emptyUpdateState(),
    staged: {
      version: '0.1.546',
      zip: '/Applications/.cairn-update-a/Cairn-0.1.546.zip',
      app: '/Applications/.cairn-update-a/Cairn.app',
      previousVersion: '0.1.545',
      at: 1,
    },
  };
  assert.equal(stagedFor(state, '0.1.545')?.version, '0.1.546');
  assert.equal(stagedFor(state, '0.1.540'), null);
  assert.equal(stagedFor(emptyUpdateState(), '0.1.545'), null);
});

test('an install record left by a different running version is stale', () => {
  const installed = {
    version: '0.1.536',
    previousVersion: '0.1.535',
    previousApp: '/Applications/.cairn-previous/Cairn.app',
    at: 1,
  };
  assert.equal(isStaleInstall({ ...emptyUpdateState(), installed }, '0.1.535'), true);
  assert.equal(isStaleInstall({ ...emptyUpdateState(), installed }, '0.1.536'), false);
});

test('a notice survives a corrupt neighbour field', () => {
  const parsed = parseUpdateState(
    JSON.stringify({
      staged: null,
      installed: null,
      blocked: 'nope',
      notice: {
        failedVersion: '0.1.536',
        restoredVersion: '0.1.535',
        reason: 'The Cairn server exited with code 1 before it was ready.',
        logPath: '/Users/x/logs/server.log',
        at: 7,
      },
    }),
  );
  assert.equal(parsed.blocked, null);
  assert.equal(parsed.notice?.failedVersion, '0.1.536');
});

test('writing an empty state over a full one leaves nothing behind', () => {
  const dir = scratch();
  const path = join(dir, 'update-state.json');
  mkdirSync(dir, { recursive: true });
  writeUpdateState(path, {
    ...emptyUpdateState(),
    blocked: { version: '0.1.536', at: 1, reason: 'x', attempts: 2 },
  });
  writeUpdateState(path, emptyUpdateState());
  assert.deepEqual(readUpdateState(path), emptyUpdateState());
});
