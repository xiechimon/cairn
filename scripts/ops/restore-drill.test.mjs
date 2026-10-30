import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
    `insert into secret(id,teamId,name,valueCipher) values('secret','${team}','fixture','${template.cipher}');
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
    run: (extra = [], production = false, env = process.env) =>
      spawnSync(
        production ? 'bash' : 'python3',
        [
          production ? script : join(root, 'scripts/ops/restore-drill-test-driver.py'),
          '--mode',
          'compare',
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
        { encoding: 'utf8', timeout: 60000, env },
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
  fails(f, /message.*m|relationship.*build b/);
});
for (const side of ['backupDb', 'db'])
  test(`deleted row in ${side} fails`, () => {
    const f = fixture();
    sql(f[side], `delete from message where id='m'`);
    f.pack();
    fails(f, /message.*m|relationship.*build b/);
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
test('orphaned chief message fails the selected relationship', () => {
  const f = fixture();
  sql(f.backupDb, `update chief_message set threadId='absent'`);
  f.pack();
  fails(f, /relationship.*ct/);
});
test('wrong key fails without leaking bytes', () => {
  const f = fixture();
  writeFileSync(f.key, `${Buffer.alloc(32, 7).toString('base64')}\n`);
  fails(f, /decrypt failed.*exit=1/);
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
    `update chief_thread set title='later',updatedAt=1793404801000; insert into message(id,conversationId,role,content,createdAt) values('new','b','user','"new"',1793404801000)`,
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
  assert.match(service, /RESTORE_DRILL_SCRATCH=%t\/cairn-restore-drill\/run/);
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
    assert.match(report.error, /exit=1/);
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

for (const [table, id] of [
  ['todo', 't', 'id'],
  ['build', 'b', 'id'],
  ['step', 's', 'buildId'],
  ['message', 'm', 'conversationId'],
  ['chief_thread', 'ct', 'id'],
  ['chief_message', 'cm', 'threadId'],
])
  test(`missing selected ${table} names the relationship sample`, () => {
    const f = fixture();
    sql(f.backupDb, `delete from ${table} where id='${id}'`);
    f.pack();
    fails(f, table.startsWith('chief') ? /relationship.*ct/ : /relationship.*build b(?:\s|:)/);
  });
test('newest eligible build wins over todo activity and step-less builds', () => {
  const f = fixture();
  for (const db of [f.db, f.backupDb])
    sql(
      db,
      `
    insert into todo(id,teamId,projectId,title,phaseAt,seqNum)
      select 'other',teamId,projectId,'Other',0,2 from todo where id='t';
    insert into build(id,todoId,withPlan,triggerSource,createdAt) values('newest','other',0,'user',2),('empty','t',0,'user',3);
    insert into step(id,buildId,kind,createdAt) values('ns','newest','build',2);
    insert into message(id,conversationId,role,content,createdAt) values('nm','newest','user','"hello"',2);
  `,
    );
  f.pack();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(f.report)).relationships.build, 'newest');
});
for (const table of ['step', 'message', 'chief_message'])
  test(`partial ${table} loss names selected sample`, () => {
    const f = fixture();
    const query =
      table === 'step'
        ? "insert into step(id,buildId,kind,createdAt) values('extra','b','build',1)"
        : table === 'message'
          ? `insert into message(id,conversationId,role,content,createdAt) values('extra','b','user','"extra"',1)`
          : `insert into chief_message(id,threadId,role,content,createdAt) values('extra','ct','user','"extra"',1)`;
    sql(f.db, query);
    fails(f, table === 'chief_message' ? /relationship.*ct/ : /relationship.*build b(?:\s|:)/);
  });
test('post-backup relationships are excluded while boundary rows are required', () => {
  const f = fixture();
  sql(
    f.db,
    `
    insert into build(id,todoId,withPlan,triggerSource,createdAt) values('future','t',0,'user',1793404801000);
    insert into step(id,buildId,kind,createdAt) values('future-step','future','build',1793404801000),('later-step','b','build',1793404801000);
    insert into message(id,conversationId,role,content,createdAt) values('later-message','b','user','"later"',1793404801000);
    insert into chief_message(id,threadId,role,content,createdAt) values('later-chief','ct','user','"later"',1793404801000);
  `,
  );
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(f.report));
  assert.equal(report.relationships.build, 'b');
  assert.deepEqual(report.relationships.steps, ['s']);
  assert.deepEqual(report.relationships.messages, ['m']);
  const backupStamp = Date.parse('2026-10-30T00:00:00Z');
  sql(f.db, `update message set createdAt=${backupStamp} where id='later-message'`);
  fails(f, /relationship.*build b(?:\s|:)/, ['--scratch', join(f.dir, 'boundary-scratch')]);
});

function nodeShim(f, mode, diagnostic = 'node helper unavailable') {
  const bin = join(f.dir, 'bin');
  mkdirSync(bin);
  const shim = join(bin, 'node');
  const quote = (value) => `'${value.replaceAll("'", "'\"'\"'")}'`;
  writeFileSync(
    shim,
    `#!/bin/bash
if [ "$1" = "-p" ]; then
  if [ "${mode}" = "resolve" ]; then exit 23; fi
  if [ "${mode}" = "home" ]; then exec ${quote(process.execPath)} "$@"; fi
  printf '%s\n' ${quote(shim)}
  exit 0
fi
if [ "${mode}" = "home" ] && [ "$HOME" != ${quote(process.env.HOME)} ]; then
  echo 'mise ERROR home unavailable' >&2
  exit 23
fi
case "$*" in
  *restore-drill-${mode}.mts*)
    printf '%s\n' ${quote(diagnostic)} >&2
    echo 'second line must not be reported' >&2
    exit 23;;
esac
exec ${quote(process.execPath)} "$@"
`,
  );
  chmodSync(shim, 0o700);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}
test('HOME-dependent node shim is resolved before isolated helpers', () => {
  const f = fixture();
  const r = f.run([], false, nodeShim(f, 'home'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(f.report)).decryption, 'decrypt ok');
});
for (const mode of ['decrypt', 'api'])
  test(`${mode} helper startup failure reports exit and safe first stderr line`, () => {
    const f = fixture();
    const r = f.run([], true, nodeShim(f, mode));
    assert.notEqual(r.status, 0);
    assert.match(
      r.stderr,
      new RegExp(`${mode} helper startup failed.*exit=23.*node helper unavailable`),
    );
    assert.doesNotMatch(r.stderr, /decrypt failed|second line/);
  });
test('unknown helper stderr is withheld from all published diagnostics', () => {
  const f = fixture();
  const r = f.run([], true, nodeShim(f, 'decrypt', 'fixture plaintext secret'));
  assert.match(r.stderr, /decrypt helper startup failed.*exit=23.*stderr withheld/);
  for (const text of [
    r.stderr,
    readFileSync(f.report, 'utf8'),
    readFileSync(`${f.report}.status`, 'utf8'),
  ])
    assert.doesNotMatch(text, /fixture plaintext secret/);
});
test('node resolution failure is classified before isolated helpers', () => {
  const f = fixture();
  const r = f.run([], true, nodeShim(f, 'resolve'));
  assert.match(r.stderr, /node helper startup failed.*exit=23/);
});

for (const [table, field, value] of [
  ['todo', 'spec', 'corrupt spec'],
  ['todo', 'title', 'corrupt title'],
  ['project', 'localPath', '/wrong'],
  ['project', 'githubRepo', 'wrong/repo'],
  ['team', 'name', 'Wrong team'],
])
  test(`undated ${table}.${field} corruption is rejected`, () => {
    const f = fixture();
    sql(f.backupDb, `update ${table} set ${field}='${value}'`);
    f.pack();
    fails(f, new RegExp(`content ${table}.*differing`));
  });

test('todo differences require a later version or phase timestamp', () => {
  const f = fixture();
  sql(f.db, "update todo set spec='later',v=v+1");
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(f.report)).tables.todo.changedAfterBackup, 1);
});

for (const mode of ['hourly', 'fresh'])
  test(`${mode} mode tolerates ordinary changes before the drill and removes successful scratch`, () => {
    const f = fixture();
    sql(
      f.db,
      `update message set content='"updated in place"';
      update chief_message set content='changed',createdAt=2;
      update secret set name='renamed';
      delete from attachment;
      insert into todo(id,teamId,projectId,title,phaseAt,seqNum)
        select 'new-todo',teamId,projectId,'New',1,2 from todo where id='t'`,
    );
    const r = f.run(['--mode', mode]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(readFileSync(f.report));
    assert.equal(report.mode, mode);
    assert.equal(existsSync(f.scratch), false);
    if (mode === 'hourly') assert.deepEqual(report.tables, {});
    else assert.equal(report.tables.todo.identical, 2);
  });

test('API wrapper never creates a missing key', () => {
  const f = fixture();
  const home = join(f.dir, 'api-home');
  mkdirSync(join(home, 'server'), { recursive: true });
  copyFileSync(f.db, join(home, 'server/server.db'));
  const sentinel = join(f.dir, 'must-not-create.key');
  const r = spawnSync(
    'node',
    [
      '--import',
      'tsx',
      join(root, 'scripts/ops/restore-drill-api.mts'),
      home,
      '--in-process-fixture',
    ],
    {
      cwd: join(root, 'apps/server'),
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, RESTORE_DRILL_KEY_PATH: sentinel },
    },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(join(root, 'apps/server/--in-process-fixture')), false);
});

test('weekly launcher configures checkout and preflights runtime dependencies', () => {
  const service = readFileSync(
    join(root, 'scripts/ops/systemd/cairn-restore-drill.service'),
    'utf8',
  );
  assert.doesNotMatch(service, /Code\/AgentProjects/);
  assert.match(service, /\$\{CAIRN_CHECKOUT\}/);
  const launcher = readFileSync(join(root, 'scripts/ops/restore-drill-service.sh'), 'utf8');
  for (const tool of ['node', 'python3', 'sqlite3']) assert.ok(launcher.includes(tool));
  assert.match(launcher, /tsx/);
  assert.match(launcher, /--mode fresh/);
});

test('hourly recovery does not require current live rows or attachment files', () => {
  const f = fixture();
  sql(f.db, 'drop table message; delete from todo; delete from attachment');
  const r = f.run(['--mode', 'hourly', '--live-attachments', join(f.dir, 'absent-live-files')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(f.report)).api.count, 1);
});

for (const [table, field, value] of [
  ['agent', 'persona', 'builder'],
  ['agent', 'tools', '["wrong"]'],
  ['agent', 'secrets', '["wrong"]'],
  ['tag', 'name', 'Wrong tag'],
  ['tag', 'color', '#000000'],
])
  test(`undated ${table}.${field} corruption is rejected`, () => {
    const f = fixture();
    const team = sql(f.db, 'select id from team limit 1');
    for (const db of [f.db, f.backupDb]) {
      sql(
        db,
        table === 'agent'
          ? `insert into agent(id,teamId,displayName) values('test-agent','${team}','Agent')`
          : "insert into tag(id,projectId,name) values('test-tag','p','Tag')",
      );
    }
    sql(f.backupDb, `update ${table} set ${field}='${value}'`);
    f.pack();
    fails(f, new RegExp(`content ${table}.*differing`));
  });

for (const mode of ['compare', 'fresh', 'hourly'])
  for (const renamed of [false, true])
    test(`${mode} heartbeat drift ${renamed ? (mode === 'hourly' ? 'does not compare live name' : 'keeps machine name strict') : 'is reported and accepted'}`, () => {
      const f = fixture();
      const team = sql(f.db, 'select id from team limit 1');
      for (const db of [f.db, f.backupDb])
        sql(
          db,
          `insert into machine(id,teamId,name,lastSeenAt,capabilities) values('machine','${team}','Original',1,'{}')`,
        );
      f.pack();
      const mutation = `update machine set lastSeenAt=2,capabilities='{"heartbeat":2}'${renamed ? ",name='Changed'" : ''}`;
      let env = process.env;
      if (mode === 'fresh') {
        const sqlite = spawnSync('which', ['sqlite3'], { encoding: 'utf8' }).stdout.trim();
        const bin = join(f.dir, 'snapshot-bin');
        mkdirSync(bin);
        const shim = join(bin, 'sqlite3');
        writeFileSync(
          shim,
          `#!/bin/bash
case "$*" in
  *".backup live-snapshot.db"*) ${sqlite} '${f.db}' '${mutation.replaceAll("'", "'\"'\"'")}' ;;
esac
exec ${sqlite} "$@"
`,
        );
        chmodSync(shim, 0o700);
        env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
      } else sql(f.db, mutation);
      const r = f.run(['--mode', mode], false, env);
      const report = JSON.parse(readFileSync(f.report));
      if (renamed && mode !== 'hourly') {
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /content machine machine: differing row/);
      } else {
        assert.equal(r.status, 0, r.stderr);
        if (mode !== 'hourly') assert.equal(report.tables.machine.allowedMutable, 1);
      }
      assert.deepEqual(Object.keys(report.allowlist.machine.columns), [
        'lastSeenAt',
        'capabilities',
      ]);
      for (const reason of Object.values(report.allowlist.machine.columns))
        assert.match(reason, /heartbeat/i);
      assert.deepEqual(Object.keys(report.allowlist.autonomy_state.columns), ['lastEvaluatedAt']);
      if (process.env.CAIRN_RESTORE_DRILL_EVIDENCE && !renamed)
        copyFileSync(
          f.report,
          join(process.env.CAIRN_RESTORE_DRILL_EVIDENCE, `heartbeat-${mode}-report.json`),
        );
    });

test('heartbeat comparator accepts only named columns and keeps all other machine and autonomy fields strict', () => {
  const r = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util
import sqlite3
spec = importlib.util.spec_from_file_location('drill', 'scripts/ops/restore-drill.py')
drill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drill)
for table, allowed, strict in [
    ('machine', ['lastSeenAt', 'capabilities'], ['id', 'teamId', 'name', 'online', 'tokenHash', 'apiKeyId', 'latestCliVersion', 'kind', 'enabledRuntimes', 'claudeCodeReport', 'claudeRateLimits', 'maxConcurrent', 'maxConcurrentOverridden']),
    ('autonomy_state', ['lastEvaluatedAt'], ['projectId', 'kind', 'lastStartedAt', 'baselineSha', 'lastBlockedReason']),
]:
    fields = allowed + strict
    for field in fields:
        copies = [sqlite3.connect(':memory:') for _ in range(2)]
        for db in copies:
            db.execute('create table ' + table + '(' + ','.join(name + ' text' + (' primary key' if name == strict[0] else '') for name in fields) + ')')
            db.execute('insert into ' + table + ' values(' + ','.join('?' for _ in fields) + ')', ['old'] * len(fields))
        copies[1].execute('update ' + table + ' set ' + field + "='new'")
        report = {'tables': {}}
        try:
            drill.compare(*copies, 0, report)
        except RuntimeError:
            assert field in strict, (table, field, report)
        else:
            assert field in allowed, (table, field, report)
            assert report['tables'][table]['allowedMutable'] == 1
        print(table + '.' + field + ': ' + ('accepted heartbeat' if field in allowed else 'rejected corruption'))
        for db in copies:
            db.close()
`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr + r.stdout);
});
