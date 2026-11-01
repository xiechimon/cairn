import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { aggregateResult } from './canary.mjs';
import * as attacker from './canary-attacker.mjs';
import * as processes from './canary-process.mjs';
import { poll, stopChild } from './canary-process.mjs';
import { plantSentinels, recoverSentinels, remainingSentinels } from './canary-sentinels.mjs';
import * as stack from './canary-stack.mjs';

function green() {
  const config = {
    hostHome: '/home/private-owner',
    sentinels: [{ path: '/home/private-owner/.ssh/.cairn-canary-fixture', hash: 'a'.repeat(64) }],
    realPaths: ['/home/private-owner/.cairn/private-app.pem', '/home/private-owner/.ssh'],
    serverPort: 34567,
  };
  const routes = Object.fromEntries(
    Object.entries(attacker.expectedTargets(config)).map(([name, targets]) => [
      name,
      targets.map((target) => ({ target, blocked: true, detail: 'ENOENT' })),
    ]),
  );
  return {
    config,
    orb: { executor: 'orb', routes, githubReach: { ok: true, ms: 1 } },
    negative: {
      executor: 'host',
      leaked: [config.sentinels[0].path],
      routes: {
        socketAndServer: attacker
          .networkTargets(config)
          .filter((url) => url !== 'http://127.0.0.1:8787')
          .map((url) => ({ target: `direct ${url}`, blocked: false, detail: 'connected' })),
      },
    },
    pushedObjectsClean: true,
    negativeObjectsContainMarker: true,
  };
}

test('every host network target is an owned scratch listener with a connected negative control', () => {
  const input = green();
  assert.equal(aggregateResult(input).ok, true);
  assert.deepEqual(attacker.networkTargets(input.config), [
    'http://127.0.0.1:8787',
    'http://127.0.0.1:34567',
    'http://10.203.0.1:34567',
    'http://tailnet-server:34567',
  ]);
  for (const mode of ['missing', 'refused', 'duplicate']) {
    const value = green();
    const rows = value.negative.routes.socketAndServer;
    if (mode === 'missing') rows.pop();
    if (mode === 'refused') rows[0] = { ...rows[0], blocked: true, detail: 'ECONNREFUSED' };
    if (mode === 'duplicate') rows.push(rows[0]);
    assert.equal(aggregateResult(value).ok, false, mode);
  }
});

test('published aggregation replaces home paths and private pem names in every route and control', () => {
  const output = aggregateResult(green());
  const json = JSON.stringify(output);
  assert.equal(json.includes('/home/private-owner'), false);
  assert.equal(json.includes('private-app.pem'), false);
  assert.ok(output.routes.symlinkPush.some((row) => row.target === '~/.cairn/1.pem'));
  assert.ok(output.routes.directRead.some((row) => row.target === '/proc/1/root~/.ssh'));
  assert.match(output.negativeControl.leaked[0], /^~\//);
});

test('a host marker claim cannot substitute for finding a marker in delivered git objects', () => {
  for (const value of [false, undefined])
    assert.equal(aggregateResult({ ...green(), negativeObjectsContainMarker: value }).ok, false);
});

test('file probes count only absence as blocked for real and sentinel paths', () => {
  for (const sentinel of [undefined, { hash: 'a'.repeat(64) }]) {
    for (const code of ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']) {
      const fail = () => {
        throw Object.assign(new Error(code), { code });
      };
      const result = attacker.fileProbe('/fixture', sentinel, undefined, {
        stat: fail,
        open: fail,
      });
      assert.equal(result.blocked, code === 'ENOENT');
      assert.equal(result.detail, ['EACCES', 'EPERM'].includes(code) ? 'present-but-denied' : code);
    }
  }
});

test('an exited unreaped child with an empty cmdline is already stopped', async () => {
  await stopChild(
    { pid: 123, exitCode: null, signalCode: null, kill: () => assert.fail('zombie signaled') },
    '/fixture',
    'entry.mjs',
    { platform: 'linux', read: () => '' },
  );
});

test('a stale sweep tolerates a manifest removed between listing and reading', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'canary-review-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.cairn/orb-canary-runs'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.cairn/orb-canary-runs/gone.jsonl'), 'gone');
  assert.doesNotThrow(() => recoverSentinels(home, undefined, { read: () => undefined }));
});

test('release mismatch refuses before starting the scratch stack or writing shared dist', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'canary-release-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const releaseFile = join(root, 'current.json');
  writeFileSync(releaseFile, JSON.stringify({ key: 'published' }));
  await assert.rejects(
    stack.requireMatchingRelease({ releaseFile, compute: async () => ({ key: 'different' }) }),
    { name: 'CanaryReleaseMismatchError' },
  );
  assert.deepEqual(JSON.parse(readFileSync(releaseFile, 'utf8')), { key: 'published' });
  assert.deepEqual(
    await stack.requireMatchingRelease({
      releaseFile,
      compute: async () => ({ key: 'published' }),
    }),
    { key: 'published' },
  );
});

for (const recovery of ['explicit', 'sweep']) {
  test(`SIGKILL parent recovery through ${recovery} stops recorded children and removes recorded resources only`, async (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'canary-kill-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const driver = join(root, 'parent.mjs');
    const worker = join(root, 'worker.mjs');
    writeFileSync(worker, 'setInterval(() => {}, 1000);');
    for (const directory of ['.cairn', '.ssh', '.codex', '.claude'])
      mkdirSync(join(root, directory));
    writeFileSync(
      driver,
      `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { plantSentinels } from ${JSON.stringify(new URL('./canary-sentinels.mjs', import.meta.url).href)};
import { childRecord } from ${JSON.stringify(new URL('./canary-process.mjs', import.meta.url).href)};
const planted = plantSentinels(${JSON.stringify(root)}, 'killed');
const child = spawn(process.execPath, [${JSON.stringify(worker)}], { cwd: ${JSON.stringify(root)}, detached: true, stdio: 'ignore' });
planted.record(childRecord(child, ${JSON.stringify(root)}, ${JSON.stringify(worker)}));
planted.record({ kind: 'machine', name: 'cairn-orb-019a3f00-0000-7000-8000-000000000001' });
planted.record({ kind: 'seed', path: '/var/lib/cairn-orb/seed/fixture-project' });
writeFileSync(${JSON.stringify(join(root, 'pid'))}, String(child.pid));
process.stdout.write('READY\\n');
setInterval(() => {}, 1000);
`,
    );
    const parent = spawn(process.execPath, [driver], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    parent.stdout.on('data', (chunk) => {
      output += chunk;
    });
    parent.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const closed = once(parent, 'close');
    t.after(async () => {
      if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
      await closed;
    });
    await poll(
      () => {
        if (output.includes('READY')) return true;
        if (parent.exitCode !== null || parent.signalCode !== null) throw new Error(errors);
        return false;
      },
      { timeout: 5000 },
    );
    const pid = Number(readFileSync(join(root, 'pid'), 'utf8'));
    t.after(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    });
    parent.kill('SIGKILL');
    await closed;
    const manifest = readFileSync(join(root, '.cairn/orb-canary-runs/killed.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    const record = manifest.find((row) => row.kind === 'child');
    assert.equal(record.pid, pid);
    assert.equal(record.cwd, root);
    assert.equal(record.entry, worker);
    assert.ok(record.startTime);
    const removed = [];
    if (recovery === 'explicit') {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      const log = join(root, 'machine-calls.jsonl');
      writeFileSync(
        join(bin, 'machinectl'),
        `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.includes('list-images')) console.log('cairn-orb-019a3f00-0000-7000-8000-000000000001 subvolume');
`,
        { mode: 0o700 },
      );
      writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\necho inactive\n', { mode: 0o700 });
      const output = spawnSync(
        '/bin/sh',
        [join(import.meta.dirname, 'canary.sh'), '--cleanup', 'killed'],
        {
          encoding: 'utf8',
          env: { ...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}` },
        },
      );
      assert.equal(output.status, 0, output.stdout + output.stderr);
      assert.equal(JSON.parse(output.stdout).ok, true);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(
        calls.filter((args) => args.includes('remove')),
        [['--no-ask-password', 'remove', 'cairn-orb-019a3f00-0000-7000-8000-000000000001']],
      );
    } else
      recoverSentinels(root, undefined, {
        cleanupResource: (resource) => {
          if (resource.kind === 'child') return processes.stopRecordedChildSync(resource);
          removed.push(resource);
        },
      });
    if (recovery === 'sweep')
      assert.deepEqual(
        removed.map((row) => row.kind),
        ['machine', 'seed'],
      );
    assert.deepEqual(remainingSentinels(root), []);
    if (process.platform === 'linux') {
      try {
        assert.equal(readFileSync(`/proc/${pid}/cmdline`, 'utf8'), '');
      } catch (error) {
        assert.equal(error.code, 'ENOENT');
      }
    } else assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(readFileSync(worker, 'utf8'), 'setInterval(() => {}, 1000);');
  });
}

test('failure JSON also redacts real home paths and pem filenames', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'canary-redact-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const directory of ['.cairn', '.ssh', '.codex', '.claude']) mkdirSync(join(home, directory));
  const output = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { canaryMain } from ${JSON.stringify(new URL('./canary.mjs', import.meta.url).href)};
await canaryMain(['--json'], { home: ${JSON.stringify(home)}, preflight: async () => { throw new Error(${JSON.stringify(join(home, '.cairn/private-key.pem'))}); } });
`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(output.status, 1);
  assert.equal(output.stdout.includes(home), false);
  assert.equal(output.stdout.includes('private-key.pem'), false);
  assert.match(JSON.parse(output.stdout).errors[0], /^~\/.cairn\/1.pem$/);
});

test('recorded process recovery ignores reused PIDs and refuses mismatched command and cwd', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'canary-identity-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, 'worker.mjs');
  writeFileSync(entry, 'setInterval(() => {}, 1000);');
  const child = spawn(process.execPath, [entry], { cwd: root, stdio: 'ignore' });
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill('SIGTERM');
    await closed;
  });
  const record = processes.childRecord(child, root, entry);
  assert.doesNotThrow(() => processes.stopRecordedChildSync({ ...record, startTime: 'different' }));
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  for (const change of [{ entry: 'different.mjs' }, { cwd: tmpdir() }]) {
    assert.throws(() => processes.stopRecordedChildSync({ ...record, ...change }), /different/);
    assert.doesNotThrow(() => process.kill(child.pid, 0));
  }
});

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'canary-round4-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['.cairn', '.ssh', '.codex', '.claude']) mkdirSync(join(root, name));
  return root;
}

test('wildcard control starts without a bridge and accepts loopback connections', async (t) => {
  const listener = await stack.startBridgeControl(0);
  t.after(() => new Promise((closed) => listener.close(closed)));
  assert.equal(listener.address().address, '0.0.0.0');
  assert.equal(
    (await attacker.connectionProbe({ host: '127.0.0.1', port: listener.address().port })).detail,
    'connected',
  );
});

test('scratch API and wildcard control use distinct ports without requiring a bridge', async (t) => {
  const root = fixture(t);
  await processes.withCleanup(async (defer) => {
    const running = await stack.startStack({
      root,
      config: { tailnetAddress: '127.0.0.1' },
      defer,
      requireOrbBuild: false,
      record: () => {},
    });
    assert.equal(
      (await attacker.connectionProbe({ host: '127.0.0.1', port: running.port })).detail,
      'connected',
    );
  });
});

test('host negative control requires loopback and tailnet but no idle bridge address', () => {
  const config = {
    hostHome: '/fixture',
    sentinels: [{ path: '/fixture/sentinel' }],
    realPaths: [],
    serverPort: 34567,
  };
  const routes = Object.fromEntries(
    Object.entries(attacker.expectedTargets(config)).map(([name, targets]) => [
      name,
      targets.map((target) => ({ target, blocked: true, detail: 'ETIMEDOUT' })),
    ]),
  );
  const input = {
    config,
    orb: { executor: 'orb', routes, githubReach: { ok: true, ms: 1 } },
    negative: {
      executor: 'host',
      leaked: ['/fixture/sentinel'],
      routes: {
        socketAndServer: attacker
          .networkTargets(config)
          .filter((target) => !target.includes('10.203.0.1') && !target.endsWith(':8787'))
          .map((target) => ({ target: `direct ${target}`, blocked: false, detail: 'connected' })),
      },
    },
    pushedObjectsClean: true,
    negativeObjectsContainMarker: true,
  };
  assert.equal(aggregateResult(input).ok, true);
  for (const target of ['127.0.0.1', 'tailnet-server']) {
    const broken = structuredClone(input);
    broken.negative.routes.socketAndServer = broken.negative.routes.socketAndServer.filter(
      (row) => !row.target.includes(target),
    );
    assert.equal(aggregateResult(broken).ok, false);
  }
});

for (const code of ['EACCES', 'EPERM', 'root']) {
  test(`proc1 alias is blocked when readlink reports ${code}`, () => {
    for (const sentinel of [undefined, { hash: 'a'.repeat(64) }]) {
      const result = attacker.fileProbe('/proc/1/root/fixture', sentinel, undefined, {
        readlink: (path) => {
          assert.equal(path, '/proc/1/root');
          if (code === 'root') return '/';
          throw Object.assign(new Error(code), { code });
        },
        stat: () => {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        },
        open: () => {
          throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        },
      });
      assert.deepEqual(result, { blocked: true, detail: 'proc1-root-not-host' });
    }
  });
}

test('a guest-root proc1 alias that still opens a sentinel is a leak', () => {
  const result = attacker.fileProbe('/proc/1/root/fixture', { hash: 'a'.repeat(64) }, undefined, {
    readlink: () => '/',
    open: () => {
      throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' });
    },
  });
  assert.equal(result.blocked, false);
  const readable = attacker.fileProbe('/proc/1/root/fixture', undefined, undefined, {
    readlink: () => '/',
    stat: () => ({}),
  });
  assert.deepEqual(readable, { blocked: false, detail: 'real path reachable (metadata only)' });
});

test('host-root aliases and ordinary paths still require ENOENT', () => {
  for (const path of ['/fixture', '/proc/1/root/fixture', '/proc/1/rootish/fixture']) {
    for (const code of ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EIO']) {
      const fail = () => {
        throw Object.assign(new Error(code), { code });
      };
      const result = attacker.fileProbe(path, undefined, undefined, {
        readlink: () => '/host',
        stat: fail,
      });
      assert.equal(result.blocked, code === 'ENOENT');
    }
  }
  assert.deepEqual(
    attacker.fileProbe('/proc/1/root/fixture', undefined, undefined, {
      readlink: () => {
        throw Object.assign(new Error('I/O'), { code: 'EIO' });
      },
    }),
    { blocked: false, detail: 'EIO' },
  );
});

test('resource failures still remove sentinels and successful resources from recovery inventory', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'failed-resource');
  const failed = { kind: 'child', pid: 123, entry: 'entry.mjs', cwd: home, startTime: 'fixture' };
  planted.record(failed);
  planted.record({ kind: 'seed', path: '/var/lib/cairn-orb/seed/fixture' });
  planted.record({ kind: 'machine', name: 'cairn-orb-019a3f00-0000-7000-8000-000000000001' });
  const rows = readFileSync(planted.manifest, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0].pid = 2147483647;
  writeFileSync(planted.manifest, `${rows.map(JSON.stringify).join('\n')}\n`);
  const attempted = [];
  assert.throws(
    () =>
      recoverSentinels(home, 'failed-resource', {
        cleanupResource: (resource) => {
          attempted.push(resource.kind);
          if (resource.kind === 'child') throw new Error('child cleanup failed');
        },
      }),
    /child cleanup failed/,
  );
  assert.deepEqual(attempted, ['child', 'machine', 'seed']);
  assert.deepEqual(remainingSentinels(home), []);
  const remaining = readFileSync(planted.manifest, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(remaining.slice(1), [failed]);
  recoverSentinels(home, 'failed-resource', {
    cleanupResource: (resource) => assert.deepEqual(resource, failed),
  });
  assert.equal(existsSync(planted.manifest), false);
});

test('scratch recovery validates against the recorded prefix instead of current tmpdir', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'prefix');
  const prefix = join(home, 'different-temp/cairn-orb-canary-');
  const scratch = `${prefix}owned`;
  mkdirSync(scratch, { recursive: true });
  const { dev, ino } = lstatSync(scratch);
  const rows = readFileSync(planted.manifest, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0] = { ...rows[0], pid: 2147483647, scratchPrefix: prefix };
  rows.push({ kind: 'scratch', path: scratch, dev, ino });
  writeFileSync(planted.manifest, `${rows.map(JSON.stringify).join('\n')}\n`);
  recoverSentinels(home, 'prefix');
  assert.equal(existsSync(scratch), false);
  assert.deepEqual(remainingSentinels(home), []);
});

test('scratch inventory rejects paths outside its recorded directory prefix', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'outside');
  t.after(planted.cleanup);
  const header = JSON.parse(readFileSync(planted.manifest, 'utf8').split('\n')[0]);
  assert.equal(header.scratchPrefix, join(realpathSync(tmpdir()), 'cairn-orb-canary-'));
  for (const path of [
    join(home, 'unowned'),
    `${header.scratchPrefix}owned/nested`,
    `${header.scratchPrefix}../unowned`,
  ])
    assert.throws(() => planted.record({ kind: 'scratch', path, dev: 1, ino: 1 }), /Invalid/);
});

test('scratch child is durably recorded synchronously before spawn returns to its caller', async (t) => {
  const root = fixture(t);
  const planted = plantSentinels(root, 'spawn');
  t.after(planted.cleanup);
  const entry = join(root, 'worker.mjs');
  writeFileSync(entry, 'setInterval(() => {}, 1000);');
  const child = processes.spawnRecordedChild(process.cwd(), entry, [], process.env, planted.record);
  const closed = once(child, 'close');
  t.after(async () => {
    child.kill('SIGTERM');
    await closed;
  });
  const rows = readFileSync(planted.manifest, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).pid, child.pid);
  assert.equal(rows.at(-1).entry, entry);
  assert.ok(rows.at(-1).startTime);
});
