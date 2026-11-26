import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  buildStartTaskSeedPrompt,
  formatExpectedServerVersion,
  overlapsTrafficLights,
  parseArgs,
  smokableBundle,
} from './post-install.mjs';

const CLI = join(import.meta.dirname, 'post-install.mjs');

test('parseArgs defaults to the local installed app', () => {
  const args = parseArgs([]);
  assert.equal(args.app, null);
  assert.equal(args.base, 'http://127.0.0.1:54400');
  assert.match(args.userData, /Application Support\/@cairn\/desktop$/);
  assert.equal(args.token, null);
  assert.equal(args.evidence, null);
  assert.equal(args.checks, null);
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
    '--checks',
    'start-task-echo,settings-titlebar,ime-composition,server-version',
  ]);
  assert.equal(args.base, 'http://127.0.0.1:9999');
  assert.equal(args.userData, '/tmp/profile');
  assert.equal(args.token, 'tok123');
  assert.equal(args.evidence, '/tmp/evidence');
  assert.deepEqual(args.checks, [
    'start-task-echo',
    'settings-titlebar',
    'ime-composition',
    'server-version',
  ]);
});

test('parseArgs rejects unknown arguments and unknown checks', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown argument: --bogus/);
  assert.throws(() => parseArgs(['stray']), /unknown argument: stray/);
  assert.throws(() => parseArgs(['--checks', 'nope']), /unknown check: nope/);
  assert.throws(() => parseArgs(['--checks', '']), /--checks requires at least one check id/);
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

test('overlapsTrafficLights detects top-left macOS traffic-light collisions', () => {
  assert.equal(overlapsTrafficLights({ x: 16, y: 12, width: 60, height: 24 }), true);
  assert.equal(overlapsTrafficLights({ x: 16, y: 40, width: 60, height: 24 }), false);
  assert.equal(overlapsTrafficLights({ x: 88, y: 12, width: 60, height: 24 }), false);
});

test('formatExpectedServerVersion formats release and dev SHA labels', () => {
  assert.equal(formatExpectedServerVersion('0.1.738', '606d9c2ef', 'en'), '0.1.738 · 606d9c2');
  assert.equal(formatExpectedServerVersion(null, '606d9c2ef', 'en'), 'Dev · 606d9c2');
  assert.equal(formatExpectedServerVersion(null, '606d9c2ef', 'zh'), '开发版 · 606d9c2');
  assert.equal(formatExpectedServerVersion(null, null, 'en'), 'Unknown version');
});

test('buildStartTaskSeedPrompt formats synthetic orchestration payload cleanly', () => {
  const text = buildStartTaskSeedPrompt({ id: 'todo-42', seqNum: 42, spec: 'Check echo' });
  assert.match(text, /^开始任务 #42\n\n编排请求：\[#42\]\(todo:todo-42\)/);
  assert.match(text, /> Check echo$/);
});

test('--help prints usage and exits without touching an app', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/smoke\/post-install\.mjs/);
  assert.match(result.stdout, /--app/);
  assert.match(result.stdout, /--checks/);
});
