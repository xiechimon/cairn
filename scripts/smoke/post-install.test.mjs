import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { parseArgs, smokableBundle } from './post-install.mjs';

const CLI = join(import.meta.dirname, 'post-install.mjs');

test('parseArgs defaults to the local installed app', () => {
  const args = parseArgs([]);
  assert.equal(args.app, null);
  assert.equal(args.base, 'http://127.0.0.1:54400');
  assert.match(args.userData, /Application Support\/@cairn\/desktop$/);
  assert.equal(args.token, null);
  assert.equal(args.evidence, null);
});

test('parseArgs --app skips the user-data default', () => {
  const args = parseArgs(['--app', '/Applications/Cairn.app']);
  assert.equal(args.app, '/Applications/Cairn.app');
  assert.equal(args.userData, null);
});

test('parseArgs reads every flag', () => {
  const args = parseArgs([
    '--base',
    'http://127.0.0.1:9999',
    '--user-data',
    '/tmp/profile',
    '--token',
    'tok123',
    '--evidence',
    '/tmp/evidence',
  ]);
  assert.equal(args.base, 'http://127.0.0.1:9999');
  assert.equal(args.userData, '/tmp/profile');
  assert.equal(args.token, 'tok123');
  assert.equal(args.evidence, '/tmp/evidence');
});

test('parseArgs rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(['stray']), /unknown argument: stray/);
});

test('smokableBundle refuses the installed app', () => {
  assert.throws(() => smokableBundle('/Applications/Cairn.app'), /installed app/);
  const scratch = makeTestTempDir('post-install-smokable-');
  try {
    mkdirSync(join(scratch, 'Cairn.app'));
    assert.equal(
      smokableBundle(join(scratch, 'Cairn.app')),
      realpathSync(join(scratch, 'Cairn.app')),
    );
  } finally {
    releaseTestTempDir(scratch);
  }
});

test('--help prints usage and exits without touching an app', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/smoke\/post-install\.mjs/);
  assert.match(result.stdout, /--app/);
});
