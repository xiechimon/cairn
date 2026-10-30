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

function write(path, body) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
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
  sqlite(
    db,
    [
      'create table todo(id text);',
      "insert into todo values ('a'), ('b');",
      'create table attachment(id text primary key, storageKey text not null, sizeBytes integer not null, status text not null);',
      "insert into attachment values ('1', 'team1/one.png', 3, 'ready'), ('2', 'team1/two.txt', 3, 'ready'), ('3', 'team2/cert.pem', 11, 'ready');",
    ].join(' '),
  );
  write(join(server, 'secretbox.key'), 'server key');
  write(join(attachments, 'team1', 'one.png'), 'one');
  write(join(attachments, 'team1', 'two.txt'), 'two');
  write(join(attachments, 'team1', 'secretbox.key'), 'planted key');
  write(join(attachments, 'team2', 'cert.pem'), 'planted pem');
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
  assert.deepEqual(files(join(f.receiver, 'db')), [copy, `${copy}.attachments.sha256`]);
  assert.equal(sha(join(f.receiver, 'db', copy)), sha(join(f.backups, 'db', copy)));

  const attachments = ['team1/one.png', 'team1/two.txt'];
  assert.deepEqual(files(join(f.backups, 'attachments')), attachments);
  assert.deepEqual(files(join(f.receiver, 'attachments')), attachments);
  for (const name of attachments)
    assert.equal(sha(join(f.receiver, 'attachments', name)), sha(join(f.attachments, name)));
  assert.deepEqual(files(f.receiver), [
    ...attachments.map((name) => `attachments/${name}`),
    `db/${copy}`,
    `db/${copy}.attachments.sha256`,
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
  write(join(f.attachments, 'team3', 'three.png'), 'three');
  sqlite(f.db, "insert into attachment values ('4', 'team3/three.png', 5, 'ready');");

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

test('an attachment is copied only once its row is ready and its size matches', () => {
  const f = fixture();
  const upload = join(f.attachments, 'team4', 'upload.png');
  const sides = [join(f.backups, 'attachments'), join(f.receiver, 'attachments')];
  let hour = 0;
  const runLater = () => {
    for (const copy of dbCopies(join(f.backups, 'db')))
      renameSync(
        join(f.backups, 'db', copy),
        join(f.backups, 'db', `server-db-20200101T0${hour++}0000Z.db.gz`),
      );
    return f.run(f.full);
  };

  write(upload, 'partial');
  sqlite(f.db, "insert into attachment values ('5', 'team4/upload.png', 15, 'pending');");
  assert.equal(runLater().status, 0);
  for (const side of sides) assert.equal(existsSync(join(side, 'team4', 'upload.png')), false);

  sqlite(f.db, "update attachment set status = 'ready' where id = '5';");
  const interrupted = runLater();
  assert.equal(interrupted.status, 0, interrupted.stderr);
  assert.match(interrupted.stderr, /skipped team4\/upload\.png: 7 bytes on disk, 15 in the db/);
  for (const side of sides) assert.equal(existsSync(join(side, 'team4', 'upload.png')), false);

  write(upload, 'complete upload');
  const complete = runLater();
  assert.equal(complete.status, 0, complete.stderr);
  for (const side of sides)
    assert.equal(readFileSync(join(side, 'team4', 'upload.png'), 'utf8'), 'complete upload');
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

test('a rewritten step session lands as a new version on both sides', () => {
  const f = fixture();
  const session = join(f.attachments, 'step-sessions', 'step1.jsonl');
  const sides = [join(f.backups, 'attachments'), join(f.receiver, 'attachments')];
  const versions = (side) =>
    files(join(side, 'step-sessions')).map((name) =>
      readFileSync(join(side, 'step-sessions', name), 'utf8'),
    );
  write(session, '{"a":1}\n');
  assert.equal(f.run(f.full).status, 0);
  for (const side of sides) assert.deepEqual(versions(side), ['{"a":1}\n']);

  const [first] = dbCopies(join(f.backups, 'db'));
  renameSync(
    join(f.backups, 'db', first),
    join(f.backups, 'db', 'server-db-20200101T090000Z.db.gz'),
  );
  write(session, '{"a":1}\n{"b":2}\n');
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  for (const side of sides) {
    assert.deepEqual(versions(side).sort(), ['{"a":1}\n', '{"a":1}\n{"b":2}\n']);
    assert.ok(
      files(join(side, 'step-sessions')).every((name) =>
        /^step1\.\d+-[0-9a-f]{16}\.jsonl$/.test(name),
      ),
    );
  }
});

test('an equal-size step session rewrite with the same mtime still lands as a new version', () => {
  const f = fixture();
  const session = join(f.attachments, 'step-sessions', 'step2.jsonl');
  const stamp = new Date('2026-10-29T12:00:00Z');
  write(session, '{"v":1}\n');
  utimesSync(session, stamp, stamp);
  assert.equal(f.run(f.full).status, 0);

  const [first] = dbCopies(join(f.backups, 'db'));
  renameSync(
    join(f.backups, 'db', first),
    join(f.backups, 'db', 'server-db-20200101T080000Z.db.gz'),
  );
  write(session, '{"v":2}\n');
  utimesSync(session, stamp, stamp);
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  for (const side of [join(f.backups, 'attachments'), join(f.receiver, 'attachments')]) {
    const contents = files(join(side, 'step-sessions')).map((name) =>
      readFileSync(join(side, 'step-sessions', name), 'utf8'),
    );
    assert.deepEqual(contents.sort(), ['{"v":1}\n', '{"v":2}\n']);
  }
});

test('attachment manifest records independent sha256 values locally and on the receiver', () => {
  const f = fixture();
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  const [copy] = dbCopies(join(f.backups, 'db'));
  const manifest = `${copy}.attachments.sha256`;
  const expected = ['team1/one.png', 'team1/two.txt']
    .map((key) => `${sha(join(f.attachments, key))}\t${key}\n`)
    .join('');
  for (const side of [f.backups, f.receiver])
    assert.equal(readFileSync(join(side, 'db', manifest), 'utf8'), expected);
});

test('attachment manifests include retained copies when every source is skipped', () => {
  const f = fixture();
  const out = join(f.backups, 'db');
  const attachmentKeys = ['team1/one.png', 'team1/two.txt'];
  const expected = attachmentKeys
    .map((key) => `${sha(join(f.attachments, key))}\t${key}\n`)
    .join('');
  assert.equal(f.run(f.full).status, 0);
  const [first] = dbCopies(out);
  renameSync(join(out, first), join(out, 'server-db-20200101T000000Z.db.gz'));
  sqlite(f.db, "update attachment set status = 'pending' where id = '1';");
  write(join(f.attachments, 'team1/two.txt'), 'incomplete');
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  const latest = dbCopies(out).at(-1);
  for (const side of [f.backups, f.receiver])
    assert.equal(readFileSync(join(side, 'db', `${latest}.attachments.sha256`), 'utf8'), expected);
});

test('an empty attachment copy writes an empty manifest despite skipped rows', () => {
  const f = fixture();
  sqlite(f.db, "update attachment set status = 'pending' where id = '1';");
  write(join(f.attachments, 'team1/two.txt'), 'incomplete');
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  const [copy] = dbCopies(join(f.backups, 'db'));
  for (const side of [f.backups, f.receiver]) {
    assert.deepEqual(files(join(side, 'attachments')), []);
    assert.equal(readFileSync(join(side, 'db', `${copy}.attachments.sha256`), 'utf8'), '');
  }
});

test('an orphan manifest does not prevent publishing a new empty backup', () => {
  const f = fixture();
  sqlite(f.db, "update attachment set status = 'pending';");
  const out = join(f.backups, 'db');
  const start = Date.now();
  for (let second = 0; second < 30; second++) {
    const stamp = new Date(start + second * 1000)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    write(join(out, `server-db-${stamp}.db.gz.attachments.sha256`), 'stale manifest');
  }
  const result = f.run(f.full);
  assert.equal(result.status, 0, result.stderr);
  const [copy] = dbCopies(out);
  assert.equal(readFileSync(join(out, `${copy}.attachments.sha256`), 'utf8'), '');
});
