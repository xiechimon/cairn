import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTests } from './test-changed.mjs';

const tests = [
  'apps/daemon/test/computer-vm-desktop.test.ts',
  'apps/daemon/test/computer-host-desktop.test.ts',
  'apps/server/test/machine-computer.test.ts',
  'apps/server/test/coordinator-computer-tool-offers.test.ts',
  'apps/web/test/fleet-status.test.ts',
  'packages/shared/test/snapshot.test.ts',
  'apps/server/test/wire.test.ts',
];

test('a changed test file is selected', () => {
  assert.deepEqual(selectTests(['apps/web/test/fleet-status.test.ts'], tests), [
    'apps/web/test/fleet-status.test.ts',
  ]);
});

test('a changed source file selects same-package tests whose name contains its basename', () => {
  assert.deepEqual(selectTests(['apps/daemon/src/computer/vm-desktop.ts'], tests), [
    'apps/daemon/test/computer-vm-desktop.test.ts',
  ]);
  assert.deepEqual(selectTests(['apps/server/src/services/machine-computer.ts'], tests), [
    'apps/server/test/machine-computer.test.ts',
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
  ]);
});

test('a shared protocol change runs the contract tests but does not fan out to every importer', () => {
  assert.deepEqual(selectTests(['packages/shared/src/protocol/computer.ts'], tests), [
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
  ]);
});

test('a server source change runs the route and schema contract tests', () => {
  assert.deepEqual(selectTests(['apps/server/src/routes-computers.ts'], tests), [
    'apps/server/test/wire.test.ts',
    'packages/shared/test/snapshot.test.ts',
  ]);
});

test('docs, styles and other packages select nothing', () => {
  assert.deepEqual(
    selectTests(['docs/design/mac-vm-computer.md', 'apps/web/src/styles/app.css'], tests),
    [],
  );
});

test('a deleted test file is not selected', () => {
  assert.deepEqual(selectTests(['apps/daemon/test/gone.test.ts'], tests), []);
});
