import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import {
  aggregateResult,
  plantSentinels,
  recoverSentinels,
  remainingSentinels,
  runCanary,
  scanObjects,
  withCleanup,
} from './canary.mjs';
import { attack, connectionProbe, expectedTargets, networkTargets } from './canary-attacker.mjs';
import { poll, runCommand } from './canary-process.mjs';
import { startBridgeControl } from './canary-stack.mjs';
import { cleanupCanaryMachine } from './machine-cleanup.mjs';

function fixture(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'orb-canary-test-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const name of ['.cairn', '.ssh', '.codex', '.claude', 'workspace'])
    mkdirSync(join(home, name));
  return home;
}

function green() {
  const config = {
    hostHome: '/fixture',
    sentinels: [{ path: '/fixture/key', hash: 'a'.repeat(64) }],
    realPaths: ['/fixture/auth'],
    serverPort: 45678,
  };
  const routes = Object.fromEntries(
    Object.entries(expectedTargets(config)).map(([route, targets]) => [
      route,
      targets.map((target) => ({ target, blocked: true, detail: 'ENOENT' })),
    ]),
  );
  return {
    config,
    orb: { routes, githubReach: { ok: true, ms: 1 }, executor: 'orb' },
    negative: {
      executor: 'host',
      leaked: ['/fixture/key'],
      routes: {
        socketAndServer: networkTargets(config)
          .filter((target) => target !== 'http://127.0.0.1:8787')
          .map((target) => ({ target: `direct ${target}`, blocked: false, detail: 'connected' })),
      },
    },
    negativeObjectsContainMarker: true,
    pushedObjectsClean: true,
    orbName: 'cairn-orb-fixture',
    durationMs: 1,
  };
}

test('aggregation requires every expected target and every control', () => {
  assert.equal(aggregateResult(green()).ok, true);
  for (const route of ['directRead', 'symlinkPush', 'socketAndServer']) {
    for (const mode of ['unblocked', 'omitted', 'duplicate', 'unknown', 'malformed']) {
      const input = green();
      const rows = input.orb.routes[route];
      if (mode === 'unblocked') rows[0].blocked = false;
      if (mode === 'omitted') rows.pop();
      if (mode === 'duplicate') rows.push(rows[0]);
      if (mode === 'unknown') rows[0].target = 'unknown';
      if (mode === 'malformed') rows[0].blocked = 'true';
      assert.equal(aggregateResult(input).ok, false, `${route} ${mode}`);
    }
  }
  for (const change of [
    (x) => {
      x.orb.githubReach.ok = false;
    },
    (x) => {
      x.pushedObjectsClean = false;
    },
    (x) => {
      x.negative.leaked = [];
    },
    (x) => {
      x.negative.leaked = ['unknown'];
    },
    (x) => {
      x.orb.executor = 'host';
    },
  ]) {
    const input = green();
    change(input);
    assert.equal(aggregateResult(input).ok, false);
  }
});

test('sentinels are exclusive new files with hashes; conflicts clean partial planting', (t) => {
  const home = fixture(t);
  const existing = join(home, '.ssh/.cairn-canary-fixed');
  writeFileSync(existing, 'keep');
  assert.throws(() => plantSentinels(home, 'fixed'), /exist/i);
  assert.equal(readFileSync(existing, 'utf8'), 'keep');
  assert.equal(existsSync(join(home, '.cairn/.cairn-canary-fixed-pem')), false);
  const planted = plantSentinels(home, 'fresh');
  assert.equal(planted.sentinels.length, 5);
  for (const sentinel of planted.sentinels) {
    const marker = readFileSync(sentinel.path, 'utf8');
    assert.equal(sentinel.hash, createHash('sha256').update(marker).digest('hex'));
    assert.equal(JSON.stringify(planted.sentinels).includes(marker), false);
  }
  planted.cleanup();
  assert.ok(planted.sentinels.every(({ path }) => !existsSync(path)));
  assert.equal(readFileSync(existing, 'utf8'), 'keep');
});

test('sentinel symlink conflicts do not touch their target', (t) => {
  const home = fixture(t);
  const target = join(home, 'original');
  writeFileSync(target, 'keep');
  symlinkSync(target, join(home, '.cairn/.cairn-canary-fixed-pem'));
  assert.throws(() => plantSentinels(home, 'fixed'), /exist/i);
  assert.equal(readFileSync(target, 'utf8'), 'keep');
});

test('cleanup runs in reverse after failure and continues after cleanup errors', async () => {
  const calls = [];
  await assert.rejects(
    withCleanup(async (defer) => {
      defer(() => {
        calls.push('sentinels');
      });
      defer(() => {
        calls.push('server');
        throw new Error('cleanup failed');
      });
      defer(() => {
        calls.push('daemon');
      });
      throw new Error('runner failed');
    }),
    /runner failed.*cleanup failed/s,
  );
  assert.deepEqual(calls, ['daemon', 'server', 'sentinels']);
  await assert.rejects(
    withCleanup(async (defer) => {
      defer(() => {
        throw new Error('cleanup failed');
      });
      return true;
    }),
    /cleanup failed/,
  );
});

test('object scanning catches deleted intermediate blobs and packed objects', async (t) => {
  const home = fixture(t);
  const repo = join(home, 'workspace');
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Canary',
        GIT_AUTHOR_EMAIL: 'canary@example.invalid',
        GIT_COMMITTER_NAME: 'Canary',
        GIT_COMMITTER_EMAIL: 'canary@example.invalid',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-b', 'main']);
  writeFileSync(join(repo, 'file'), 'clean');
  git(['add', 'file']);
  git(['commit', '-m', 'seed']);
  const marker = 'random-marker-for-git-object-probe';
  assert.equal(await scanObjects(repo, 'main', [marker]), true);
  writeFileSync(join(repo, 'file'), marker);
  git(['add', 'file']);
  git(['commit', '-m', 'intermediate']);
  writeFileSync(join(repo, 'file'), 'clean again');
  git(['add', 'file']);
  git(['commit', '-m', 'final']);
  git(['gc']);
  assert.equal(await scanObjects(repo, 'main', [marker]), false);
  await assert.rejects(scanObjects(repo, 'missing', [marker]));
});

test('the actual attacker discovers fake-home leaks, copies only sentinels and emits no raw secrets', async (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'attack');
  t.after(planted.cleanup);
  const real = join(home, '.codex/auth.json');
  writeFileSync(real, 'DO_NOT_READ_REAL_CONTENT');
  const config = {
    hostHome: home,
    sentinels: planted.sentinels,
    realPaths: [real],
    serverPort: 45678,
  };
  const result = await attack(config, {
    cwd: join(home, 'workspace'),
    env: { HOME: home },
    network: false,
  });
  assert.equal(result.leaked.length, 5);
  assert.equal(result.routes.directRead.find((row) => row.target === real).blocked, false);
  assert.equal(result.routes.symlinkPush.find((row) => row.target === real).blocked, false);
  for (const marker of planted.markers)
    assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes('DO_NOT_READ_REAL_CONTENT'), false);
  assert.equal(existsSync(join(home, 'workspace/canary-copies/real-0')), false);
  assert.equal(result.routes.symlinkPush.length, config.sentinels.length + config.realPaths.length);
});

test('runner failure removes the planted files, stops scratch resources and removes its temp home', async (t) => {
  const home = fixture(t);
  let root;
  let sentinels;
  const stopped = [];
  await assert.rejects(
    runCanary({
      home,
      preflight: async () => {},
      stackFactory: async (input) => {
        root = input.root;
        sentinels = input.config.sentinels;
        input.defer(() => {
          stopped.push('server');
        });
        input.defer(() => {
          stopped.push('daemon');
        });
        return {
          port: 34567,
          run: async () => {
            throw new Error('injected runner failure');
          },
        };
      },
    }),
    /injected runner failure/,
  );
  assert.deepEqual(stopped, ['daemon', 'server']);
  assert.ok(sentinels.every(({ path }) => !existsSync(path)));
  assert.equal(existsSync(root), false);
});

test('a failed host prerequisite never plants sentinels or starts a stack', async (t) => {
  const home = fixture(t);
  await assert.rejects(
    runCanary({
      home,
      preflight: async () => {
        throw new Error('missing image');
      },
      stackFactory: async () => assert.fail('unexpected stack'),
    }),
    /missing image/,
  );
  assert.equal(existsSync(join(home, '.cairn/machine.json')), false);
});

test('the attacker CLI reports fake-home leaks and writes only metadata to its result', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'cli');
  t.after(planted.cleanup);
  const config = join(home, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      hostHome: home,
      sentinels: planted.sentinels,
      realPaths: [],
      serverPort: 45678,
      probeNetwork: false,
    }),
  );
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, 'canary-attacker.mjs'), config],
    { cwd: join(home, 'workspace'), encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } },
  );
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(readFileSync(join(home, 'workspace/canary-result.json'), 'utf8'));
  assert.equal(metadata.leaked.length, 5);
  for (const marker of planted.markers) assert.equal(result.stdout.includes(marker), false);
  assert.match(result.stdout, /^CAIRN_CANARY_RESULT=/);
});

test('interrupting a running probe still cleans scratch state and sentinels', async (t) => {
  const home = fixture(t);
  const controller = new AbortController();
  let root;
  let paths;
  await assert.rejects(
    runCanary({
      home,
      signal: controller.signal,
      preflight: async () => {},
      stackFactory: async (input) => {
        root = input.root;
        paths = input.config.sentinels;
        return {
          port: 34567,
          run: async () => {
            controller.abort(new Error('interrupted'));
            input.signal.throwIfAborted();
          },
        };
      },
    }),
    /interrupted/,
  );
  assert.equal(existsSync(root), false);
  assert.ok(paths.every(({ path }) => !existsSync(path)));
});

test('TCP and proxy probes distinguish a connected service, explicit refusal and an invalid response', async (t) => {
  for (const [reply, blocked] of [
    ['HTTP/1.1 403 Forbidden\r\n\r\n', true],
    ['HTTP/1.1 200 Connection established\r\n\r\n', false],
    ['HTTP/1.1 502 Bad Gateway\r\n\r\n', false],
    ['', false],
  ]) {
    const server = createServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.end(reply));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise((done) => server.close(done)));
    const address = { host: '127.0.0.1', port: server.address().port };
    assert.equal((await connectionProbe(address)).blocked, false);
    assert.equal(
      (await connectionProbe(address, 'CONNECT fixture:8787 HTTP/1.1\r\n\r\n')).blocked,
      blocked,
    );
  }
});

test('attacker attempts every direct and proxy target and forces GitHub HTTPS through the proxy', async (t) => {
  const home = fixture(t);
  const config = {
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
    serverPort: 34567,
  };
  const calls = [];
  const result = await attack(config, {
    cwd: join(home, 'workspace'),
    env: { HOME: home, CAIRN_ORB: '1', HTTP_PROXY: 'http://127.0.0.1:12345', NO_PROXY: '*' },
    connectTarget: async (options, request) => {
      calls.push({ options, request });
      return {
        blocked: true,
        detail: request
          ? 'proxy HTTP 403'
          : options.host !== '127.0.0.1'
            ? 'ETIMEDOUT'
            : 'ECONNREFUSED',
      };
    },
    run: (command, args, options) => {
      assert.equal(command, 'git');
      assert.ok(args.includes('http.proxy=http://127.0.0.1:12345/'));
      assert.deepEqual(args.slice(-3), [
        'ls-remote',
        'https://github.com/xiechimon/cairn.git',
        'HEAD',
      ]);
      assert.equal(options.env.NO_PROXY, '');
      assert.equal(options.env.no_proxy, '');
      return { status: 0, stdout: `${'a'.repeat(40)}\tHEAD\n` };
    },
  });
  assert.equal(calls.length, 9);
  assert.match(
    result.routes.socketAndServer.find((row) => row.target === 'direct http://127.0.0.1:8787')
      .detail,
    /orb own loopback/,
  );
  assert.deepEqual(
    result.routes.socketAndServer.map((row) => row.target),
    expectedTargets(config).socketAndServer,
  );
  assert.ok(result.routes.socketAndServer.every((row) => row.blocked));
  assert.equal(result.githubReach.ok, true);
});

test('partial clones wait for stop hooks and cleanup removes only the exact scratch image', () => {
  const name = 'cairn-orb-019a3f00-0000-7000-8000-000000000001';
  const calls = [];
  const errors = [];
  let polls = 0;
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args.includes('list')) return { status: 0, stdout: `${name}-other container\n` };
    if (args.includes('list-images'))
      return { status: 0, stdout: `${name} subvolume\n${name}-other subvolume\n` };
    if (command === 'systemctl')
      return { status: 3, stdout: ++polls < 3 ? 'deactivating\n' : 'inactive\n' };
    return { status: 0, stdout: '' };
  };
  assert.equal(
    cleanupCanaryMachine({
      name,
      run,
      wait: () => {},
      directory: '/nonexistent-canary-runtime',
      errors,
    }),
    true,
  );
  assert.equal(polls, 3);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    calls.filter((call) => call.includes('remove')),
    [['machinectl', '--no-ask-password', 'remove', name]],
  );
  assert.equal(
    calls.some((call) => call.includes('poweroff')),
    false,
  );
  assert.throws(() =>
    cleanupCanaryMachine({ name: 'cairn-orb-base', run: () => assert.fail('unexpected command') }),
  );
});

test('a refused known bridge listener invalidates the run and tailnet targets stay redacted', async (t) => {
  const home = fixture(t);
  const config = {
    hostHome: '/nonexistent-canary-home',
    sentinels: [],
    realPaths: [],
    serverPort: 34567,
    tailnetAddress: '192.0.2.25',
  };
  const result = await attack(config, {
    cwd: join(home, 'workspace'),
    env: { HOME: home, CAIRN_ORB: '1' },
    connectTarget: async (_options, request) => ({
      blocked: true,
      detail: request ? 'proxy HTTP 403' : 'ECONNREFUSED',
    }),
    run: () => ({ status: 0, stdout: `${'a'.repeat(40)}\tHEAD\n` }),
  });
  assert.equal(
    result.routes.socketAndServer.find((row) => row.target === 'direct http://10.203.0.1:34567')
      .blocked,
    false,
  );
  assert.ok(
    result.routes.socketAndServer.some(
      (row) => row.target === 'direct http://tailnet-server:34567',
    ),
  );
  assert.equal(JSON.stringify(result).includes(config.tailnetAddress), false);
});

test('a detached prerequisite process has its own terminal signal group', async () => {
  const result = await runCommand(
    process.execPath,
    [
      '-e',
      "process.stdout.write(require('node:child_process').execFileSync('ps',['-o','pid=,pgid=','-p',String(process.pid)],{encoding:'utf8'}))",
    ],
    { detached: true },
  );
  const [pid, group] = result.trim().split(/\s+/);
  assert.equal(pid, group);
});

test('the known host listener accepts TCP before it is used as the firewall control', async (t) => {
  const server = await startBridgeControl(0, '127.0.0.1');
  t.after(() => new Promise((closed) => server.close(closed)));
  assert.equal(
    (await connectionProbe({ host: '127.0.0.1', port: server.address().port })).blocked,
    false,
  );
});

async function childRun(t, home, mode, shell = false) {
  const driver = join(home, 'driver.mjs');
  writeFileSync(
    driver,
    `import { canaryMain } from ${JSON.stringify(new URL('./canary.mjs', import.meta.url).href)};
import { poll } from ${JSON.stringify(new URL('./canary-process.mjs', import.meta.url).href)};
await canaryMain(['--json'], {
  home: ${JSON.stringify(home)},
  preflight: async () => {},
  stackFactory: async ({ signal }) => {
    process.stdout.write('READY\\n');
    if (${JSON.stringify(mode)} === 'kill') process.kill(process.pid, 'SIGKILL');
    return { run: async () => poll(() => false, { signal, timeout: 10000 }) };
  },
  timeout: 10000,
});
`,
  );
  let command = process.execPath;
  let args = [driver];
  let env = { ...process.env, HOME: home, CAIRN_CANARY_RUN_ID: 'child-run' };
  if (shell) {
    const bin = join(home, 'bin');
    mkdirSync(bin);
    const node = join(bin, 'node');
    writeFileSync(
      node,
      `#!/bin/sh\nif [ "$1" = '${join(import.meta.dirname, 'canary.mjs')}' ] && [ "$2" = '--json' ]; then\nexec '${process.execPath}' '${driver}'\nfi\nexec '${process.execPath}' "$@"\n`,
      { mode: 0o700 },
    );
    command = '/bin/sh';
    args = [join(import.meta.dirname, 'canary.sh'), '--json'];
    env = { ...env, PATH: `${bin}:${process.env.PATH}` };
  }
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  await poll(
    () => {
      if (output.includes('READY\n')) return true;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Child failed before planting: ${errors}`);
      return false;
    },
    { timeout: 5000 },
  );
  return { child, closed, output: () => output };
}

test('sentinels use unique dotfiles and mode 0600 with a private recovery manifest', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'mode');
  t.after(planted.cleanup);
  assert.equal(planted.sentinels.length, 5);
  for (const { path } of planted.sentinels) {
    assert.match(basename(path), /^\.cairn-canary-mode(?:-[a-z]+)?$/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  assert.equal(statSync(planted.manifest).mode & 0o777, 0o600);
  const manifest = readFileSync(planted.manifest, 'utf8');
  for (const { path } of planted.sentinels) assert.ok(manifest.includes(path));
  for (const marker of planted.markers) assert.equal(manifest.includes(marker), false);
  planted.cleanup();
  assert.equal(existsSync(planted.manifest), false);
  assert.deepEqual(remainingSentinels(home), []);
});

test('an existing dotfile aborts partial planting without modifying its bytes or metadata', (t) => {
  const home = fixture(t);
  const path = join(home, '.ssh/.cairn-canary-collision');
  writeFileSync(path, 'owner file', { mode: 0o640 });
  const before = lstatSync(path);
  assert.throws(() => plantSentinels(home, 'collision'), /exist/i);
  const after = lstatSync(path);
  for (const field of ['ino', 'mode', 'mtimeMs', 'ctimeMs', 'atimeMs'])
    assert.equal(after[field], before[field], field);
  assert.equal(readFileSync(path, 'utf8'), 'owner file');
  assert.deepEqual(remainingSentinels(home), [path]);
});

test('an error thrown immediately after planting removes every sentinel and manifest', async (t) => {
  const home = fixture(t);
  await assert.rejects(
    runCanary({
      home,
      preflight: async () => {},
      stackFactory: async () => {
        throw new Error('after planting');
      },
    }),
    /after planting/,
  );
  assert.deepEqual(remainingSentinels(home), []);
  assert.deepEqual(readdirSync(join(home, '.cairn/orb-canary-runs')), []);
});

test('a timed out run removes every sentinel and manifest', async (t) => {
  const home = fixture(t);
  await assert.rejects(
    runCanary({
      home,
      timeout: 30,
      preflight: async () => {},
      stackFactory: async ({ signal }) => ({
        run: () => poll(() => false, { signal, timeout: 200 }),
      }),
    }),
    /timeout|timed out/i,
  );
  assert.deepEqual(remainingSentinels(home), []);
  assert.deepEqual(readdirSync(join(home, '.cairn/orb-canary-runs')), []);
});

for (const shell of [false, true]) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    test(`a ${shell ? 'shell wrapper' : 'Node child'} receiving ${signal} cleans its sentinels and exits nonzero`, async (t) => {
      const home = fixture(t);
      const run = await childRun(t, home, 'signal', shell);
      assert.equal(remainingSentinels(home).length, 5);
      run.child.kill(signal);
      const [code] = await run.closed;
      assert.notEqual(code, 0);
      assert.deepEqual(remainingSentinels(home), []);
      assert.deepEqual(readdirSync(join(home, '.cairn/orb-canary-runs')), []);
      const result = JSON.parse(run.output().slice('READY\n'.length));
      assert.equal(result.ok, false);
      assert.deepEqual(result.sentinelsRemaining, []);
    });
  }
}

for (const recovery of ['explicit', 'next-run', 'shell-exit']) {
  test(`SIGKILL recovery through ${recovery} removes only recorded inodes`, async (t) => {
    const home = fixture(t);
    const run = await childRun(t, home, 'kill', recovery === 'shell-exit');
    await run.closed;
    if (recovery === 'shell-exit') {
      assert.deepEqual(remainingSentinels(home), []);
      return;
    }
    const paths = remainingSentinels(home);
    assert.equal(paths.length, 5);
    const unrelated = join(home, '.ssh/.cairn-canary-unrelated');
    writeFileSync(unrelated, 'preserve', { mode: 0o640 });
    if (recovery === 'explicit') {
      const result = spawnSync(
        '/bin/sh',
        [join(import.meta.dirname, 'canary.sh'), '--cleanup', 'child-run'],
        {
          encoding: 'utf8',
          env: { ...process.env, HOME: home },
        },
      );
      assert.notEqual(result.status, 0);
      assert.deepEqual(JSON.parse(result.stdout).sentinelsRemaining, [
        unrelated.replace(home, '~'),
      ]);
    } else {
      await assert.rejects(
        runCanary({
          home,
          preflight: async () => {
            throw new Error('stop after recovery');
          },
        }),
        /stop after recovery/,
      );
    }
    assert.ok(paths.every((path) => !existsSync(path)));
    assert.equal(readFileSync(unrelated, 'utf8'), 'preserve');
    assert.equal(statSync(unrelated).mode & 0o777, 0o640);
  });
}

test('the final assertion records leftovers in failure JSON and exits nonzero', async (t) => {
  const home = fixture(t);
  const leftover = join(home, '.claude/.cairn-canary-untracked');
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { canaryMain } from ${JSON.stringify(new URL('./canary.mjs', import.meta.url).href)};
import { writeFileSync } from 'node:fs';
await canaryMain(['--json'], {
  home: ${JSON.stringify(home)}, preflight: async () => {},
  stackFactory: async () => {
    writeFileSync(${JSON.stringify(leftover)}, 'preserve');
    throw new Error('injected failure');
  },
});`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.sentinelsRemaining, [leftover.replace(home, '~')]);
  assert.equal(readFileSync(leftover, 'utf8'), 'preserve');
});

for (const controlMarker of [false, true]) {
  for (const leftover of [false, true]) {
    test(`a completed run with marker=${controlMarker} ${leftover ? 'fails its final leftover assertion' : 'cleans every sentinel'}`, async (t) => {
      const home = fixture(t);
      const result = await runCanary({
        home,
        preflight: async () => {},
        stackFactory: async ({ root, config }) => {
          await runCommand('git', ['init', '-b', 'main', root]);
          await runCommand('git', [
            '-c',
            'user.name=Canary',
            '-c',
            'user.email=canary@example.invalid',
            '-C',
            root,
            'commit',
            '--allow-empty',
            '-m',
            'Seed',
          ]);
          return {
            port: 34567,
            run: async (executor) => {
              if (executor === 'host') {
                if (leftover) writeFileSync(join(home, '.ssh/.cairn-canary-leftover'), 'preserve');
                writeFileSync(
                  join(root, 'marker'),
                  controlMarker ? readFileSync(config.sentinels[0].path) : 'missing marker',
                );
                await runCommand('git', ['-C', root, 'add', 'marker']);
                await runCommand('git', [
                  '-c',
                  'user.name=Canary',
                  '-c',
                  'user.email=canary@example.invalid',
                  '-C',
                  root,
                  'commit',
                  '-m',
                  'Control marker',
                ]);
                return {
                  repo: root,
                  branch: 'main',
                  result: {
                    executor,
                    leaked: [config.sentinels[0].path],
                    routes: {
                      socketAndServer: networkTargets(config)
                        .filter((target) => target !== 'http://127.0.0.1:8787')
                        .map((target) => ({
                          target: `direct ${target}`,
                          blocked: false,
                          detail: 'connected',
                        })),
                    },
                  },
                };
              }
              return {
                repo: root,
                branch: 'main',
                orbName: 'fixture',
                result: {
                  executor,
                  githubReach: { ok: true, ms: 1 },
                  routes: Object.fromEntries(
                    Object.entries(expectedTargets(config)).map(([route, targets]) => [
                      route,
                      targets.map((target) => ({ target, blocked: true, detail: 'blocked' })),
                    ]),
                  ),
                },
              };
            },
          };
        },
      });
      assert.equal(result.ok, !leftover && controlMarker);
      assert.equal(result.negativeObjectsContainMarker, controlMarker);
      assert.deepEqual(
        result.sentinelsRemaining,
        leftover ? ['~/.ssh/.cairn-canary-leftover'] : [],
      );
    });
  }
}

test('cleanup preserves replaced files and symlinks and keeps their recovery record', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'replace');
  const [first, second] = planted.sentinels;
  renameSync(first.path, join(home, 'original-inode'));
  writeFileSync(first.path, 'replacement', { mode: 0o640 });
  renameSync(second.path, join(home, 'second-inode'));
  symlinkSync(join(home, 'original-inode'), second.path);
  assert.throws(planted.cleanup, /replaced/i);
  assert.equal(readFileSync(first.path, 'utf8'), 'replacement');
  assert.equal(statSync(first.path).mode & 0o777, 0o640);
  assert.ok(lstatSync(second.path).isSymbolicLink());
  assert.ok(existsSync(planted.manifest));
  assert.ok(planted.sentinels.slice(2).every(({ path }) => !existsSync(path)));
});

test('recovery refuses an active run and invalid run IDs', (t) => {
  const home = fixture(t);
  const planted = plantSentinels(home, 'active');
  assert.throws(() => recoverSentinels(home, 'active'), /still active/i);
  assert.throws(() => recoverSentinels(home, '../outside'), /invalid/i);
  assert.ok(planted.sentinels.every(({ path }) => existsSync(path)));
  planted.cleanup();
});

test('private creation uses mode 0600 even with a restrictive inherited umask', (t) => {
  const home = fixture(t);
  const previous = process.umask(0o777);
  let planted;
  try {
    planted = plantSentinels(home, 'umask');
    assert.equal(process.umask(), 0o777);
    for (const { path } of planted.sentinels) assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(planted.manifest).mode & 0o777, 0o600);
  } finally {
    process.umask(previous);
    planted?.cleanup();
  }
});
