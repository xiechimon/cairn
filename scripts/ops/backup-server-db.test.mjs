import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const SCRIPT = resolve(import.meta.dirname, 'backup-server-db.sh');
const RECEIVER_FORCED_FLAGS = ['-wo', '-no-del', '-no-overwrite', '-munge'];

function which(tool) {
  const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  return found.status === 0 ? found.stdout.trim() : '';
}

const rsync = which('rsync');
const rsyncVersion = rsync ? spawnSync(rsync, ['--version'], { encoding: 'utf8' }).stdout : '';
assert.match(
  rsyncVersion,
  /^rsync\s+version 3\./,
  `GNU rsync 3.x must come first on PATH (found ${rsync || 'none'}: ${rsyncVersion.split('\n')[0]})`,
);
const rrsyncPath = process.env.RRSYNC || which('rrsync');
assert.ok(rrsyncPath && existsSync(rrsyncPath), 'rrsync not found: put it on PATH or set RRSYNC');
const rrsyncSource = readFileSync(rrsyncPath, 'utf8');
assert.match(
  rrsyncSource,
  /-no-overwrite/,
  `${rrsyncPath} has no -no-overwrite (needs rsync 3.4+)`,
);
const receiverSource = rrsyncSource.replace(/^RSYNC = .*$/m, `RSYNC = '${rsync}'`);

function sha(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

function write(path, body, ageMinutes = 0) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
  if (ageMinutes > 0) {
    const then = new Date(Date.now() - ageMinutes * 60000);
    utimesSync(path, then, then);
  }
}

function sqlite(db, sql) {
  const run = spawnSync('sqlite3', [db, sql], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function fixture() {
  const root = makeTestTempDir('backup-server-db-');
  const server = join(root, 'server');
  const db = join(server, 'server.db');
  const attachments = join(server, 'attachments');
  const backups = join(root, 'backups');
  const receiver = join(root, 'receiver');
  mkdirSync(receiver, { recursive: true });
  mkdirSync(server, { recursive: true });
  sqlite(db, "create table todo(id text); insert into todo values ('a'), ('b');");
  write(join(server, 'secretbox.key'), 'server key');
  write(join(attachments, 'team1', 'one.png'), 'one', 60);
  write(join(attachments, 'team1', 'two.txt'), 'two', 60);
  write(join(attachments, 'team1', 'secretbox.key'), 'planted key', 60);
  write(join(attachments, 'team2', 'cert.pem'), 'planted pem', 60);
  const rrsync = join(root, 'rrsync');
  writeFileSync(rrsync, receiverSource);
  const ssh = join(root, 'fake-ssh');
  writeFileSync(
    ssh,
    [
      '#!/bin/sh',
      'shift',
      `SSH_ORIGINAL_COMMAND="$*" exec python3 '${rrsync}' ${RECEIVER_FORCED_FLAGS.join(' ')} "$FAKE_RECEIVER"`,
      '',
    ].join('\n'),
  );
  chmodSync(ssh, 0o755);
  const full = [
    '--db',
    db,
    '--out',
    join(backups, 'db'),
    '--attachments',
    attachments,
    '--attachments-out',
    join(backups, 'attachments'),
    '--remote',
    'receiver:',
    '--keep',
    '48',
  ];
  return {
    root,
    server,
    db,
    attachments,
    backups,
    receiver,
    full,
    run: (args, { receiverDir = receiver } = {}) =>
      spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, RSYNC_RSH: ssh, FAKE_RECEIVER: receiverDir },
      }),
  };
}

function dbCopies(dir) {
  return files(dir).filter((name) => /^server-db-\d{8}T\d{6}Z\.db\.gz$/.test(name));
}

function restoredRows(gz, root) {
  const restored = join(root, `restored-${Math.random().toString(36).slice(2)}.db`);
  writeFileSync(restored, gunzipSync(readFileSync(gz)));
  assert.equal(sqlite(restored, 'PRAGMA integrity_check;').trim(), 'ok');
  return sqlite(restored, 'select id from todo order by id;').trim();
}

test('the db-only call writes one verified copy into --out and rotates to --keep', () => {
  const f = fixture();
  const out = join(f.backups, 'db');
  write(join(out, 'server-db-20200101T000000Z.db.gz'), 'oldest');
  write(join(out, 'server-db-20200101T010000Z.db.gz'), 'older');
  const result = f.run(['--db', f.db, '--out', out, '--keep', '2']);
  assert.equal(result.status, 0, result.stderr);
  const copies = dbCopies(out);
  assert.equal(copies.length, 2);
  assert.equal(copies[0], 'server-db-20200101T010000Z.db.gz');
  assert.equal(restoredRows(join(out, copies[1]), f.root), 'a\nb');
  assert.deepEqual(files(out), copies);
  assert.deepEqual(files(f.receiver), []);
  assert.match(result.stdout, /backup done\n$/);
});

test('a full run copies db and attachments locally and to an rrsync receiver, without secrets', () => {
  const f = fixture();
  write(join(f.backups, 'db', 'secretbox.key'), 'stray key');
  write(join(f.backups, 'db', 'notes.txt'), 'stray file');
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);

  const [copy] = dbCopies(join(f.backups, 'db'));
  assert.ok(copy, 'no local db copy');
  assert.equal(restoredRows(join(f.backups, 'db', copy), f.root), 'a\nb');
  assert.deepEqual(files(join(f.receiver, 'db')), [copy]);
  assert.equal(sha(join(f.receiver, 'db', copy)), sha(join(f.backups, 'db', copy)));

  const attachments = ['team1/one.png', 'team1/two.txt'];
  assert.deepEqual(files(join(f.backups, 'attachments')), attachments);
  assert.deepEqual(files(join(f.receiver, 'attachments')), attachments);
  for (const name of attachments)
    assert.equal(sha(join(f.receiver, 'attachments', name)), sha(join(f.attachments, name)));
  assert.deepEqual(files(f.receiver), [
    ...attachments.map((name) => `attachments/${name}`),
    `db/${copy}`,
  ]);
});

test('later runs add files on both sides and never delete or overwrite', () => {
  const f = fixture();
  assert.equal(f.run(f.full).status, 0);
  const [first] = dbCopies(join(f.backups, 'db'));
  renameSync(
    join(f.backups, 'db', first),
    join(f.backups, 'db', 'server-db-20200101T010000Z.db.gz'),
  );
  write(join(f.receiver, 'db', 'server-db-20200101T000000Z.db.gz'), 'kept by the receiver');
  write(join(f.receiver, 'attachments', 'team1', 'one.png'), 'receiver copy');
  rmSync(join(f.attachments, 'team1', 'two.txt'));
  write(join(f.attachments, 'team3', 'three.png'), 'three', 60);

  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(files(join(f.backups, 'attachments')), [
    'team1/one.png',
    'team1/two.txt',
    'team3/three.png',
  ]);
  assert.deepEqual(files(join(f.receiver, 'attachments')), [
    'team1/one.png',
    'team1/two.txt',
    'team3/three.png',
  ]);
  assert.equal(
    readFileSync(join(f.receiver, 'attachments', 'team1', 'one.png'), 'utf8'),
    'receiver copy',
  );
  assert.ok(existsSync(join(f.receiver, 'db', 'server-db-20200101T000000Z.db.gz')));
});

test('a failed push exits non-zero, names the step, and keeps the local copy', () => {
  const f = fixture();
  const result = f.run(f.full, { receiverDir: join(f.root, 'missing') });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /FAIL push db/);
  assert.equal(dbCopies(join(f.backups, 'db')).length, 1);
  assert.deepEqual(files(join(f.backups, 'attachments')), ['team1/one.png', 'team1/two.txt']);
});

test('an unreadable db fails at the backup step and writes or pushes nothing', () => {
  const f = fixture();
  writeFileSync(f.db, 'not a database');
  const result = f.run(f.full);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL sqlite3 \.backup/);
  assert.deepEqual(files(join(f.backups, 'db')), []);
  assert.deepEqual(files(f.receiver), []);
});

test('bad arguments exit 2 before anything is written', () => {
  const f = fixture();
  const out = join(f.backups, 'db');
  for (const args of [
    ['--db', f.db, '--out', out, '--keep', '0'],
    ['--db', f.db, '--out', out, '--keep', 'many'],
    ['--db', f.db, '--out', out, '--attachments', f.attachments],
    ['--db', f.db, '--out', out, '--attachments-out', join(f.backups, 'attachments')],
    ['--db', f.db, '--out'],
    ['--db', f.db, '--out', out, '--bogus'],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}`);
    assert.match(result.stderr, /usage|unknown|requires|--keep/);
  }
  assert.equal(existsSync(f.backups), false);
});

test('an attachment written in the last minute waits for a later run on both sides', () => {
  const f = fixture();
  write(join(f.attachments, 'team4', 'upload.png'), 'partial');
  assert.equal(f.run(f.full).status, 0);
  assert.equal(existsSync(join(f.backups, 'attachments', 'team4', 'upload.png')), false);
  assert.equal(existsSync(join(f.receiver, 'attachments', 'team4', 'upload.png')), false);

  write(join(f.attachments, 'team4', 'upload.png'), 'complete upload', 60);
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  for (const side of [f.backups, f.receiver])
    assert.equal(
      readFileSync(join(side, 'attachments', 'team4', 'upload.png'), 'utf8'),
      'complete upload',
    );
});

test('a run whose copy name already exists fails and keeps the existing copy', () => {
  const f = fixture();
  const out = join(f.backups, 'db');
  const start = Date.now();
  const taken = Array.from({ length: 15 }, (_, i) => {
    const stamp = new Date(start + i * 1000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const path = join(out, `server-db-${stamp}.db.gz`);
    write(path, 'earlier run');
    return path;
  });
  const result = f.run(f.full);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL .*already exists/);
  for (const path of taken) assert.equal(readFileSync(path, 'utf8'), 'earlier run');
  assert.deepEqual(files(f.receiver), []);
});
