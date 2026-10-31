import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { protectAsOwner, setupRunner, tightenOwnerPath } from './setup-runner-user.mjs';

function fixture() {
  const state = {
    runner: null,
    yama: 0,
    paths: new Map([
      ['/home/ian', { uid: 1000, gid: 1000, mode: 0o755, kind: 'directory' }],
      ['/mnt/fast/cairn', { uid: 1000, gid: 1000, mode: 0o755, kind: 'directory' }],
      ['/mnt/fast/cairn/workspaces', { uid: 1000, gid: 1000, mode: 0o755, kind: 'directory' }],
      ['/mnt/fast/cairn/server', { uid: 1000, gid: 1000, mode: 0o755, kind: 'directory' }],
      ['/mnt/fast/cairn/server/server.db', { uid: 1000, gid: 1000, mode: 0o644, kind: 'file' }],
    ]),
    config: null,
  };
  const changes = [];
  const host = {
    platform: 'linux',
    euid: 0,
    owner: { uid: 1000, gid: 1000, home: '/home/ian' },
    runner: () => state.runner,
    yama: () => state.yama,
    inspect: (path) => state.paths.get(path),
    children: (path) =>
      [...state.paths.keys()].filter(
        (name) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes('/'),
      ),
    config: () => state.config,
    tmpfiles: () => state.tmpfiles,
    toolInstalled: () => state.toolInstalled,
    change: (action) => {
      changes.push(action);
      if (action.type === 'user')
        state.runner = {
          uid: 999,
          gid: 999,
          home: '/var/lib/cairn-runner',
          groups: ['cairn-runner'],
          group: 'cairn-runner',
          groupUsers: ['cairn-runner'],
          locked: true,
        };
      if (action.type === 'protect' || action.type === 'directory')
        state.paths.set(action.path, {
          uid: action.uid,
          gid: action.gid,
          mode: action.mode,
          kind: action.kind ?? 'directory',
        });
      if (action.type === 'yama') state.yama = action.value;
      if (action.type === 'config') state.config = { value: action.value, uid: 0, mode: 0o644 };
      if (action.type === 'tool') state.toolInstalled = true;
      if (action.type === 'tmpfiles')
        state.tmpfiles = { content: action.content, uid: 0, gid: 0, mode: 0o644 };
    },
  };
  return { state, changes, host };
}

test('dry-run prints the complete plan with no mutation and no service commands', () => {
  const f = fixture();
  const lines = [];
  setupRunner({ host: f.host, dryRun: true, log: (line) => lines.push(line) });
  assert.equal(f.changes.length, 0);
  for (const word of [
    'cairn-runner',
    '/home/ian',
    '/mnt/fast/cairn/server/server.db',
    'ptrace_scope',
    '/run/cairn-token-broker',
  ])
    assert.ok(
      lines.some((line) => line.includes(word)),
      word,
    );
  assert.ok(!lines.join('\n').match(/restart|stop|kill|reboot/));
});

test('setup protects files and directories, creates a private runner, and is idempotent', () => {
  const f = fixture();
  setupRunner({ host: f.host, log: () => {} });
  assert.equal(f.state.paths.get('/home/ian').mode, 0o700);
  assert.equal(f.state.paths.get('/mnt/fast/cairn/server/server.db').mode, 0o600);
  assert.deepEqual(f.state.paths.get('/run/cairn-token-broker'), {
    uid: 1000,
    gid: 999,
    mode: 0o2710,
    kind: 'directory',
  });
  assert.equal(f.state.yama, 1);
  f.changes.length = 0;
  setupRunner({ host: f.host, log: () => {} });
  assert.deepEqual(f.changes, []);
});

test('preflight refuses symlinks, root or privileged runner identities, and unavailable Yama before mutation', () => {
  for (const alter of [
    (f) => {
      f.state.paths.get('/home/ian').kind = 'symlink';
    },
    (f) => {
      f.state.yama = null;
    },
    (f) => {
      f.state.runner = { uid: 0 };
    },
    (f) => {
      f.state.runner = {
        uid: 999,
        gid: 999,
        home: '/var/lib/cairn-runner',
        group: 'cairn-runner',
        groups: ['cairn-runner', 'wheel'],
        locked: true,
      };
    },
  ]) {
    const f = fixture();
    alter(f);
    assert.throws(() => setupRunner({ host: f.host, log: () => {} }));
    assert.deepEqual(f.changes, []);
  }
});

test('stricter ptrace protection is preserved and non-root/non-Linux execution is refused', () => {
  const f = fixture();
  f.state.yama = 2;
  setupRunner({ host: f.host, log: () => {} });
  assert.equal(f.state.yama, 2);
  assert.equal(f.state.config.value, 2);
  for (const host of [
    { ...f.host, euid: 1000 },
    { ...f.host, platform: 'darwin' },
  ])
    assert.throws(() => setupRunner({ host, log: () => {} }));
});

test('persistent stricter protection is restored rather than overwritten', () => {
  const f = fixture();
  f.state.config = { value: 2, uid: 0, mode: 0o644 };
  setupRunner({ host: f.host, log: () => {} });
  assert.equal(f.state.yama, 2);
  assert.equal(f.state.config.value, 2);
});

test('a root group or a group shared with another user cannot receive the broker socket', () => {
  for (const change of [{ gid: 0 }, { groupUsers: ['cairn-runner', 'other-user'] }]) {
    const f = fixture();
    f.state.runner = {
      uid: 999,
      gid: 999,
      home: '/var/lib/cairn-runner',
      group: 'cairn-runner',
      groups: ['cairn-runner'],
      groupUsers: ['cairn-runner'],
      locked: true,
      ...change,
    };
    assert.throws(() => setupRunner({ host: f.host, log: () => {} }));
    assert.equal(f.changes.length, 0);
  }
});

test('setup provisions the boot-time broker directory rule', () => {
  const f = fixture();
  setupRunner({ host: f.host, log: () => {} });
  assert.deepEqual(f.state.tmpfiles, {
    content: 'd /run/cairn-token-broker 2710 ian cairn-runner -\n',
    uid: 0,
    gid: 0,
    mode: 0o644,
  });
  assert.equal(f.changes.filter((action) => action.type === 'tmpfiles').length, 1);
});

test('shell entry refuses unknown arguments without running setup', () => {
  const result = spawnSync(
    'sh',
    [new URL('./setup-runner-user.sh', import.meta.url).pathname, '--unexpected'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('foreign-owned protected paths are refused before mutation even in dry-run', () => {
  for (const dryRun of [false, true]) {
    const f = fixture();
    f.state.paths.get('/mnt/fast/cairn/server/server.db').uid = 0;
    assert.throws(() => setupRunner({ host: f.host, dryRun, log: () => {} }), /owner/i);
    assert.deepEqual(f.changes, []);
  }
});

test('the Cairn parent permits traversal only and workspaces deny runner access', () => {
  const f = fixture();
  setupRunner({ host: f.host, log: () => {} });
  assert.equal(f.state.paths.get('/mnt/fast/cairn').mode, 0o711);
  assert.equal(f.state.paths.get('/mnt/fast/cairn/workspaces').mode, 0o700);
});

test('configured protected locations replace the default data and workspace locations', () => {
  const f = fixture();
  for (const path of ['/fixture/cairn', '/fixture/data', '/fixture/workspaces', '/fixture/stale'])
    f.state.paths.set(path, { uid: 1000, gid: 1000, mode: 0o755, kind: 'directory' });
  setupRunner({
    host: f.host,
    locations: {
      parent: '/fixture/cairn',
      server: '/fixture/data',
      workspaces: '/fixture/workspaces',
      stale: '/fixture/stale',
    },
    log: () => {},
  });
  assert.equal(f.state.paths.get('/fixture/cairn').mode, 0o711);
  for (const path of ['/fixture/data', '/fixture/workspaces', '/fixture/stale'])
    assert.equal(f.state.paths.get(path).mode, 0o700);
  assert.equal(f.state.paths.get('/mnt/fast/cairn/server').mode, 0o755);
});

test('protection executes in a child with the owner uid and gid', () => {
  const action = { path: '/fixture', uid: 1000, gid: 1000, mode: 0o700 };
  let invocation;
  protectAsOwner(action, (command, args, options) => {
    invocation = { command, args, options };
  });
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.options.uid, action.uid);
  assert.equal(invocation.options.gid, action.gid);
  assert.equal(invocation.options.stdio, 'ignore');
});

test('owner protection refuses a planted or swapped symlink without changing the outside target', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'owner-protection-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tree = join(dir, 'tree');
  mkdirSync(tree);
  const outside = join(dir, 'outside');
  writeFileSync(outside, 'fixture', { mode: 0o644 });
  const original = lstatSync(outside);
  const target = join(tree, 'target');
  writeFileSync(target, 'fixture');
  const info = lstatSync(target);
  const action = {
    path: target,
    uid: info.uid,
    gid: info.gid,
    dev: info.dev,
    ino: info.ino,
    mode: 0o600,
    kind: 'file',
  };
  rmSync(target);
  symlinkSync(outside, target);
  assert.throws(() => tightenOwnerPath(action));
  assert.throws(() => tightenOwnerPath({ ...action, ...lstatSync(target) }));
  const after = lstatSync(outside);
  assert.equal(after.mode, original.mode);
  assert.equal(after.uid, original.uid);
  assert.equal(after.gid, original.gid);
});

test('owner protection pins the inode and refuses replacement or foreign ownership', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'owner-protection-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'target');
  writeFileSync(path, 'fixture', { mode: 0o644 });
  const info = lstatSync(path);
  const action = {
    path,
    uid: info.uid,
    gid: info.gid,
    dev: info.dev,
    ino: info.ino,
    mode: 0o600,
    kind: 'file',
  };
  assert.throws(() => tightenOwnerPath({ ...action, ino: info.ino + 1 }));
  assert.throws(() => tightenOwnerPath({ ...action, uid: info.uid + 1 }));
  assert.equal(lstatSync(path).mode & 0o777, 0o644);
  protectAsOwner(action);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
});
