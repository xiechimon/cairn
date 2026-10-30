import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const root = resolve(import.meta.dirname, '../..');
const script = join(root, 'scripts/ops/restore-drill.sh');
let template;
function sql(db, query) {
  const r = spawnSync('sqlite3', [db, query], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function fixture() {
  const dir = makeTestTempDir('restore-drill-');
  const live = join(dir, 'live');
  mkdirSync(live);
  const db = join(live, 'server.db');
  const key = join(live, 'secretbox.key');
  if (!template) {
    const base = makeTestTempDir('restore-drill-template-');
    const baseDb = join(base, 'server.db');
    const baseKey = join(base, 'key');
    const seeded = spawnSync(
      'node',
      ['--import', 'tsx', join(root, 'scripts/ops/restore-drill-fixture.mts'), baseDb, baseKey],
      { cwd: join(root, 'apps/server'), encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(seeded.status, 0, seeded.stderr);
    template = { db: baseDb, key: baseKey, cipher: seeded.stdout.trim() };
  }
  copyFileSync(template.db, db);
  copyFileSync(template.key, key);
  const team = sql(db, 'select id from team limit 1');
  sql(
    db,
    `insert into project(id,name,teamId) values('p','Project','${team}');
    insert into todo(id,teamId,projectId,title,phaseAt,seqNum) values('t','${team}','p','Task',1,1);
    insert into build(id,todoId,withPlan,triggerSource,createdAt) values('b','t',0,'user',1);
    insert into step(id,buildId,kind,createdAt) values('s','b','build',1);
    insert into message(id,conversationId,role,content,createdAt) values('m','s','user','"original"',1);
    insert into chief_thread(id,chiefId,userId,teamId,title,createdAt,updatedAt,sessionId,sessionOpenedAt) values('ct','c','u','${team}','Thread',1,1,'session',1);
    insert into chief_message(id,threadId,role,content,createdAt) values('cm','ct','user','"hello"',1);
    insert into secret(id,teamId,name,valueCipher) values('secret','${team}','fixture','${template.cipher}');
    insert into attachment(id,teamId,createdBy,fileName,mimeType,sizeBytes,storageKey,grantId,scope,status,createdAt) values('a','${team}','u','file','text/plain',3,'file.txt','g','message','ready',1);`,
  );
  const attachments = join(dir, 'attachments');
  const liveAttachments = join(live, 'attachments');
  for (const p of [attachments, liveAttachments]) {
    mkdirSync(p);
    writeFileSync(join(p, 'file.txt'), 'abc');
  }
  const backupDb = join(dir, 'backup.db');
  sql(db, `.backup '${backupDb}'`);
  const backup = join(dir, 'server-db-20261030T000000Z.db.gz');
  const pack = () => writeFileSync(backup, gzipSync(readFileSync(backupDb)));
  pack();
  const scratch = join(dir, 'scratch');
  const report = join(dir, 'report.json');
  return {
    dir,
    db,
    key,
    backupDb,
    backup,
    pack,
    scratch,
    report,
    run: (extra = [], production = false) =>
      spawnSync(
        production ? 'bash' : 'python3',
        [
          production ? script : join(root, 'scripts/ops/restore-drill-test-driver.py'),
          '--backup',
          backup,
          '--live-db',
          db,
          '--attachments',
          attachments,
          '--live-attachments',
          liveAttachments,
          '--secretbox-key',
          key,
          '--scratch',
          scratch,
          '--report',
          report,
          ...extra,
        ],
        { encoding: 'utf8', timeout: 60000 },
      ),
    attachments,
    liveAttachments,
  };
}
function fails(f, pattern, extra) {
  const r = f.run(extra);
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, pattern);
}
test('clean backup passes fixture in-process checkout API and never reports key or plaintext', () => {
  const f = fixture();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(f.report, 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.ok, true);
  assert.equal(report.api.count, 1);
  assert.equal(report.tables.message.identical, 1);
  assert.equal(report.decryption, 'decrypt ok');
  assert.ok(!text.includes(readFileSync(f.key, 'utf8').trim()));
  assert.ok(!text.includes('fixture plaintext'));
  assert.match(readFileSync(`${f.report}.status`, 'utf8'), /PASS/);
  if (process.env.CAIRN_RESTORE_DRILL_EVIDENCE) {
    copyFileSync(f.report, join(process.env.CAIRN_RESTORE_DRILL_EVIDENCE, 'fixture-report.json'));
    copyFileSync(
      `${f.report}.status`,
      join(process.env.CAIRN_RESTORE_DRILL_EVIDENCE, 'fixture-report.status'),
    );
  }
});
test('one attachment byte changed names its storage key', () => {
  const f = fixture();
  writeFileSync(join(f.attachments, 'file.txt'), 'abd');
  fails(f, /attachment.*file.txt/);
});
test('message content edited names table and id', () => {
  const f = fixture();
  sql(f.backupDb, `update message set content='"edited"' where id='m'`);
  f.pack();
  fails(f, /message.*m/);
});
for (const side of ['backupDb', 'db'])
  test(`deleted row in ${side} fails`, () => {
    const f = fixture();
    sql(f[side], `delete from message where id='m'`);
    f.pack();
    fails(f, /message.*m/);
  });
test('scratch inside live directory is refused', () => {
  const f = fixture();
  fails(f, /scratch.*live/, ['--scratch', join(f.db, '..', 'scratch')]);
});
test('scratch through symlink is refused', () => {
  const f = fixture();
  symlinkSync(join(f.db, '..'), join(f.dir, 'alias'));
  fails(f, /scratch.*live/, ['--scratch', join(f.dir, 'alias', 'scratch')]);
});
test('existing scratch is refused without overwriting it', () => {
  const f = fixture();
  mkdirSync(f.scratch);
  fails(f, /scratch.*exist/);
});
test('report cannot overwrite live DB or key', () => {
  const f = fixture();
  const before = readFileSync(f.key);
  fails(f, /report.*unsafe/, ['--report', f.key]);
  assert.deepEqual(readFileSync(f.key), before);
});
test('invalid gzip fails and publishes failure status', () => {
  const f = fixture();
  writeFileSync(f.backup, 'invalid');
  fails(f, /restore/);
  assert.match(readFileSync(`${f.report}.status`, 'utf8'), /FAIL/);
});
test('foreign key violation fails', () => {
  const f = fixture();
  sql(f.backupDb, `update chief_message set threadId='absent'`);
  f.pack();
  fails(f, /foreign_key_check/);
});
test('wrong key fails without leaking bytes', () => {
  const f = fixture();
  writeFileSync(f.key, `${Buffer.alloc(32, 7).toString('base64')}\n`);
  fails(f, /decrypt/);
  assert.ok(!readFileSync(f.report, 'utf8').includes(Buffer.alloc(32, 7).toString('base64')));
});
test('no encrypted sample fails', () => {
  const f = fixture();
  for (const db of [f.db, f.backupDb]) sql(db, 'update secret set valueCipher=null');
  f.pack();
  fails(f, /decrypt.*sample/);
});
test('missing relationship sample fails', () => {
  const f = fixture();
  for (const db of [f.db, f.backupDb]) sql(db, 'delete from message');
  f.pack();
  fails(f, /relationship/);
});
test('post-backup timestamped updates and inserts are allowed', () => {
  const f = fixture();
  sql(
    f.db,
    `update chief_thread set title='later',updatedAt=1793404801000; insert into message(id,conversationId,role,content,createdAt) values('new','s','user','"new"',1793404801000)`,
  );
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(f.report));
  assert.equal(report.tables.chief_thread.changedAfterBackup, 1);
  assert.equal(report.tables.message.addedAfterBackup, 1);
});
test('missing attachment and unsafe attachment key fail', () => {
  const f = fixture();
  for (const db of [f.db, f.backupDb])
    sql(db, `update attachment set storageKey='../secretbox.key'`);
  f.pack();
  fails(f, /attachment.*unsafe/);
});
test('default backup directory selects the newest timestamp', () => {
  const f = fixture();
  const r = f.run(['--backup', f.dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(f.report));
});
test('migration ledger rows with null declared ids are compared rather than skipped', () => {
  const f = fixture();
  sql(f.backupDb, "update __drizzle_migrations set hash='edited' where rowid=1");
  f.pack();
  fails(f, /__drizzle_migrations.*1.*differing/);
});
test('machine heartbeat allowlist is reported while machine name remains strict', () => {
  const f = fixture();
  const team = sql(f.db, 'select id from team limit 1');
  for (const db of [f.db, f.backupDb])
    sql(
      db,
      `insert into machine(id,teamId,name,lastSeenAt) values('machine','${team}','Original',1)`,
    );
  f.pack();
  sql(f.db, 'update machine set lastSeenAt=2');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(f.report));
  assert.equal(report.tables.machine.allowedMutable, 1);
  assert.match(report.tables.machine.allowlist.reason, /heartbeat/);
});
test('missing ready attachment names its storage key', () => {
  const f = fixture();
  sql(f.backupDb, "update attachment set storageKey='missing.txt'");
  sql(f.db, "update attachment set storageKey='missing.txt'");
  f.pack();
  fails(f, /attachment.*missing.txt/);
});
test('weekly units isolate scratch and do not install themselves', () => {
  const service = readFileSync(
    join(root, 'scripts/ops/systemd/cairn-restore-drill.service'),
    'utf8',
  );
  const timer = readFileSync(join(root, 'scripts/ops/systemd/cairn-restore-drill.timer'), 'utf8');
  assert.match(service, /UMask=0077/);
  assert.match(service, /RuntimeDirectory=cairn-restore-drill/);
  assert.match(service, /--scratch %t\/cairn-restore-drill\/run/);
  assert.match(timer, /OnCalendar=weekly/);
  assert.match(timer, /Persistent=true/);
});

test('production shell requires a real HTTP listener and reports sandbox refusal', () => {
  const f = fixture();
  const r = f.run([], true);
  const report = JSON.parse(readFileSync(f.report));
  if (r.status === 0) {
    assert.equal(report.api.count, 1);
    assert.equal(report.fixtureOnly, undefined);
  } else {
    assert.match(report.error, /api.*listen failed: EPERM/);
    assert.match(r.stderr, /FAIL api/);
    assert.equal(report.ok, false);
  }
  if (process.env.CAIRN_RESTORE_DRILL_EVIDENCE) {
    copyFileSync(f.report, join(process.env.CAIRN_RESTORE_DRILL_EVIDENCE, 'http-report.json'));
    copyFileSync(
      `${f.report}.status`,
      join(process.env.CAIRN_RESTORE_DRILL_EVIDENCE, 'http-report.status'),
    );
  }
});
test('invalid SQLite fails integrity checking', () => {
  const f = fixture();
  writeFileSync(f.backup, gzipSync(Buffer.from('not sqlite')));
  fails(f, /integrity_check/);
});
test('ready attachment size mismatch fails', () => {
  const f = fixture();
  writeFileSync(join(f.attachments, 'file.txt'), 'longer');
  fails(f, /attachment.*file.txt/);
});
test('scratch equal to live DB is refused', () => {
  const f = fixture();
  fails(f, /scratch.*live/, ['--scratch', f.db]);
});
test('missing key fails without creating a replacement', () => {
  const f = fixture();
  const absent = join(f.dir, 'absent-key');
  fails(f, /inputs missing/, ['--secretbox-key', absent]);
  assert.equal(existsSync(absent), false);
});
test('non-allowlisted machine field changes fail', () => {
  const f = fixture();
  const team = sql(f.db, 'select id from team limit 1');
  for (const db of [f.db, f.backupDb])
    sql(db, `insert into machine(id,teamId,name) values('machine','${team}','Original')`);
  f.pack();
  sql(f.db, "update machine set name='Changed'");
  fails(f, /machine.*machine.*differing/);
});
