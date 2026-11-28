import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import * as smoke from './post-install.mjs';
import {
  buildStartTaskSeedPrompt,
  formatExpectedServerVersion,
  overlapsTrafficLights,
  parseArgs,
  seedEveryTable,
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

test('seedEveryTable seeds a fenced step and each present side group', () => {
  const scratch = makeTestTempDir('post-install-step-');
  const path = join(scratch, 'server.db');
  try {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE step (id TEXT PRIMARY KEY NOT NULL);
      CREATE TRIGGER step_require_writer_generation_insert BEFORE INSERT ON step
      BEGIN SELECT CASE WHEN cairn_step_write_generation() IS NOT 1
        THEN RAISE(ABORT, 'incompatible step writer generation') END; END;
      CREATE TRIGGER step_require_writer_generation_update BEFORE UPDATE ON step
      BEGIN SELECT CASE WHEN cairn_step_write_generation() IS NOT 1
        THEN RAISE(ABORT, 'incompatible step writer generation') END; END;
      CREATE TABLE step_quota (stepId TEXT PRIMARY KEY REFERENCES step(id), quotaBlock TEXT, fallback TEXT, ranModel TEXT);
      CREATE TABLE step_subscription (stepId TEXT PRIMARY KEY REFERENCES step(id), claudeSubscriptionId TEXT, devinSubscriptionId TEXT, antigravitySubscriptionId TEXT);
      CREATE TABLE step_schedule (stepId TEXT PRIMARY KEY REFERENCES step(id), scheduleId TEXT, scheduledBy TEXT);
      CREATE TABLE step_memory_trace (stepId TEXT PRIMARY KEY REFERENCES step(id), memoryTrace TEXT NOT NULL);
      CREATE TABLE step_skill_injection (stepId TEXT PRIMARY KEY REFERENCES step(id), skillInjection TEXT NOT NULL);
      CREATE TABLE step_blocker_handoff (stepId TEXT PRIMARY KEY REFERENCES step(id), blockerHandoff TEXT NOT NULL);
    `);
    db.close();
    const result = seedEveryTable(path, 'fixture');
    smoke.assertStepSamples(path, result.stepSamples);
    assert.equal(result.seeded, 7);
    assert.deepEqual(result.skipped, []);
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      for (const [table, column] of [
        ['step_quota', 'quotaBlock'],
        ['step_subscription', 'claudeSubscriptionId'],
        ['step_schedule', 'scheduleId'],
        ['step_memory_trace', 'memoryTrace'],
        ['step_skill_injection', 'skillInjection'],
        ['step_blocker_handoff', 'blockerHandoff'],
      ]) {
        assert.equal(
          check.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} IS NOT NULL`).get().n,
          1,
        );
      }
    } finally {
      check.close();
    }
  } finally {
    releaseTestTempDir(scratch);
  }
});

test('seedEveryTable supports unmarked steps but never skips a failed step insert', () => {
  const scratch = makeTestTempDir('post-install-old-step-');
  try {
    const path = join(scratch, 'server.db');
    const db = new DatabaseSync(path);
    db.exec(
      `CREATE TABLE step (id TEXT PRIMARY KEY NOT NULL, quotaBlock TEXT, fallback TEXT, ranModel TEXT, claudeSubscriptionId TEXT, devinSubscriptionId TEXT, antigravitySubscriptionId TEXT, scheduleId TEXT, scheduledBy TEXT, memoryTrace TEXT, skillInjection TEXT, blockerHandoff TEXT)`,
    );
    db.close();
    assert.equal(seedEveryTable(path, 'old').seeded, 1);
    const blocked = new DatabaseSync(path);
    blocked.exec(
      `CREATE TRIGGER unrelated BEFORE INSERT ON step BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );
    blocked.close();
    assert.throws(() => seedEveryTable(path, 'blocked'), /blocked/);
    const unmarked = join(scratch, 'unmarked.db');
    const fenced = new DatabaseSync(unmarked);
    fenced.exec(`CREATE TABLE step (id TEXT PRIMARY KEY NOT NULL, quotaBlock TEXT, fallback TEXT, ranModel TEXT, claudeSubscriptionId TEXT, devinSubscriptionId TEXT, antigravitySubscriptionId TEXT, scheduleId TEXT, scheduledBy TEXT, memoryTrace TEXT, skillInjection TEXT, blockerHandoff TEXT);
      CREATE TRIGGER other_insert BEFORE INSERT ON step
      BEGIN SELECT cairn_step_write_generation(); END;`);
    fenced.close();
    assert.throws(() => seedEveryTable(unmarked, 'unmarked'), /cairn_step_write_generation/);
  } finally {
    releaseTestTempDir(scratch);
  }
});

test('--help prints usage and exits without touching an app', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: node scripts\/smoke\/post-install\.mjs/);
  assert.match(result.stdout, /--app/);
  assert.match(result.stdout, /--checks/);
});

test('legacy step samples survive migration exactly, including absent groups', () => {
  const scratch = makeTestTempDir('post-install-legacy-');
  const path = join(scratch, 'server.db');
  try {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE agent_memory (layer TEXT);
      CREATE TABLE step (id TEXT PRIMARY KEY NOT NULL,
      quotaBlock TEXT, fallback TEXT, ranModel TEXT,
      claudeSubscriptionId TEXT, devinSubscriptionId TEXT, antigravitySubscriptionId TEXT,
      scheduleId TEXT, scheduledBy TEXT, memoryTrace TEXT, skillInjection TEXT, blockerHandoff TEXT)`);
    db.close();
    const seeded = seedEveryTable(path, 'legacy');
    const before = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      before.prepare('SELECT quotaBlock FROM step WHERE id = ?').get('legacy-step').quotaBlock,
      smoke.STEP_GROUP_SAMPLES.step_quota.quotaBlock,
    );
    before.close();
    const upgraded = new DatabaseSync(path);
    upgraded.exec(
      readFileSync(
        new URL('../../apps/server/drizzle/0272_step_side_tables.sql', import.meta.url),
        'utf8',
      ),
    );
    upgraded.close();
    smoke.assertStepSamples(path, seeded.stepSamples);
    const changed = new DatabaseSync(path);
    changed.exec("UPDATE step_quota SET fallback = 'altered'");
    changed.close();
    assert.throws(() => smoke.assertStepSamples(path, seeded.stepSamples));
    const missing = new DatabaseSync(path);
    missing.exec(
      'DELETE FROM step_quota; DELETE FROM step_subscription; DELETE FROM step_schedule; DELETE FROM step_memory_trace; DELETE FROM step_skill_injection; DELETE FROM step_blocker_handoff',
    );
    missing.close();
    assert.throws(() => smoke.assertStepSamples(path, seeded.stepSamples));
    const dropped = new DatabaseSync(path);
    dropped.exec('DROP TABLE step_schedule');
    dropped.close();
    assert.throws(() => smoke.assertStepSamples(path, seeded.stepSamples));
    const incompletePath = join(scratch, 'incomplete.db');
    const incomplete = new DatabaseSync(incompletePath);
    incomplete.exec('CREATE TABLE step (id TEXT PRIMARY KEY NOT NULL)');
    incomplete.close();
    assert.throws(
      () => seedEveryTable(incompletePath, 'incomplete'),
      /required smoke column step\.quotaBlock missing/,
    );
  } finally {
    releaseTestTempDir(scratch);
  }
});
