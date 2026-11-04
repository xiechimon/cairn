import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const here = import.meta.dirname;
const script = join(here, 'build-container-image.sh');
const imageDirectory = join(here, '../../../apps/daemon/orb-image');
const pinned = {
  CAIRN_ORB_CLAUDE_VERSION: '2.1.316',
  CAIRN_ORB_CODEX_VERSION: '0.166.0',
  CAIRN_ORB_NODE_MAJOR: '24',
};

const temporaryRoots = [];
process.on('exit', () => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-container-image-'));
  temporaryRoots.push(root);
  const bin = join(root, 'bin');
  const context = join(root, 'context');
  mkdirSync(bin);
  cpSync(imageDirectory, context, { recursive: true });
  const calls = join(root, 'calls');
  executable(
    join(bin, 'podman'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const record = { args };
if (args[0] === 'build') {
  record.lockHeld = spawnSync('flock', ['-n', process.env.CAIRN_HEAVY_LOCK, 'true']).status !== 0;
  console.log('STEP 1/1: build output that must not reach stdout');
}
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(record) + '\\n');
if (args[0] === 'image' && args[1] === 'exists') process.exit(process.env.FAKE_IMAGE_EXISTS === '1' ? 0 : 1);
if (args[0] === 'build') process.exit(Number(process.env.FAKE_BUILD_EXIT ?? 0));
`,
  );
  const environment = (extra = {}) => ({
    ...process.env,
    ...pinned,
    PATH: `${bin}:${process.env.PATH}`,
    CAIRN_ORB_IMAGE_CONTEXT: context,
    CAIRN_HEAVY_LOCK: join(root, 'heavy.lock'),
    FAKE_CALLS: calls,
    ...extra,
  });
  const run = (extra = {}) =>
    spawnSync('bash', [script], { env: environment(extra), encoding: 'utf8' });
  const recorded = () =>
    existsSync(calls)
      ? readFileSync(calls, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  return { root, context, run, recorded };
}

const lastLine = (output) => output.trim().split('\n').at(-1);

test('hash tag is stable for the same inputs and printed last on stdout', () => {
  const fixture = buildFixture();
  const first = fixture.run();
  const second = fixture.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim().split('\n').length, 1);
  assert.match(lastLine(first.stdout), /^cairn-orb-base:[0-9a-f]{16}$/);
  assert.equal(lastLine(second.stdout), lastLine(first.stdout));
});

test('hash tag changes with the Dockerfile, entry.sh and each pin', () => {
  const fixture = buildFixture();
  const baseline = lastLine(fixture.run().stdout);
  const tags = new Set([baseline]);
  const variants = [
    { CAIRN_ORB_CLAUDE_VERSION: '2.1.317' },
    { CAIRN_ORB_CODEX_VERSION: '0.167.0' },
    { CAIRN_ORB_NODE_MAJOR: '26' },
  ];
  for (const variant of variants) {
    const tag = lastLine(fixture.run(variant).stdout);
    assert.match(tag, /^cairn-orb-base:[0-9a-f]{16}$/);
    tags.add(tag);
  }
  const dockerfile = join(fixture.context, 'Dockerfile');
  const original = readFileSync(dockerfile, 'utf8');
  writeFileSync(dockerfile, `${original}\nRUN true\n`);
  tags.add(lastLine(fixture.run().stdout));
  writeFileSync(dockerfile, original);
  assert.equal(lastLine(fixture.run().stdout), baseline);
  const entry = join(fixture.context, 'entry.sh');
  writeFileSync(entry, `${readFileSync(entry, 'utf8')}\n:\n`);
  tags.add(lastLine(fixture.run().stdout));
  assert.equal(tags.size, 6);
});

test('an unrelated host environment change does not change the tag', () => {
  const fixture = buildFixture();
  const baseline = lastLine(fixture.run().stdout);
  assert.equal(
    lastLine(fixture.run({ HTTP_PROXY: 'http://127.0.0.1:1', LANG: 'C' }).stdout),
    baseline,
  );
});

test('an existing image skips the build', () => {
  const fixture = buildFixture();
  const result = fixture.run({ FAKE_IMAGE_EXISTS: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(lastLine(result.stdout), /^cairn-orb-base:[0-9a-f]{16}$/);
  const calls = fixture.recorded();
  assert.deepEqual(
    calls.map((call) => call.args.slice(0, 2)),
    [['image', 'exists']],
  );
  assert.equal(calls[0].args[2], lastLine(result.stdout));
});

test('a missing image is built rootless with the proxy disabled, the base target and the pins', () => {
  const fixture = buildFixture();
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  const tag = lastLine(result.stdout);
  const build = fixture.recorded().find((call) => call.args[0] === 'build');
  assert.ok(build);
  const { args } = build;
  assert.ok(args.includes('--http-proxy=false'));
  assert.equal(args[args.indexOf('--target') + 1], 'base');
  assert.equal(args[args.indexOf('-t') + 1], tag);
  assert.equal(args.at(-1), fixture.context);
  const buildArgs = args.flatMap((arg, index) => (args[index - 1] === '--build-arg' ? [arg] : []));
  const pnpm = readFileSync(join(here, 'pnpm.version'), 'utf8').trim();
  for (const expected of [
    'NODE_MAJOR=24',
    'CLAUDE_VERSION=2.1.316',
    'CODEX_VERSION=0.166.0',
    `PNPM_VERSION=${pnpm}`,
    'USER_UID=1000',
    `RECIPE_HASH=${tag.split(':')[1]}`,
  ])
    assert.ok(buildArgs.includes(expected), `${expected} in ${buildArgs.join(' ')}`);
  assert.ok(!args.includes('--privileged'));
  assert.ok(!args.includes('--network'));
});

test('the build runs under the shared heavy-work lock and its output stays off stdout', () => {
  const fixture = buildFixture();
  const result = fixture.run();
  assert.equal(fixture.recorded().find((call) => call.args[0] === 'build').lockHeld, true);
  assert.doesNotMatch(result.stdout, /STEP 1/);
  assert.match(result.stderr, /STEP 1/);
});

test('a failing build propagates its exit code and prints no tag', () => {
  const fixture = buildFixture();
  const result = fixture.run({ FAKE_BUILD_EXIT: '7' });
  assert.equal(result.status, 7);
  assert.equal(result.stdout, '');
});

test('every build argument is declared by the Dockerfile', () => {
  const fixture = buildFixture();
  fixture.run();
  const { args } = fixture.recorded().find((call) => call.args[0] === 'build');
  const dockerfile = readFileSync(join(imageDirectory, 'Dockerfile'), 'utf8');
  for (const [index, arg] of args.entries()) {
    if (args[index - 1] !== '--build-arg') continue;
    const name = arg.split('=')[0];
    assert.match(dockerfile, new RegExp(`^ARG ${name}(=.*)?$`, 'm'), name);
  }
});

test('invalid pins and arguments are refused before podman runs', () => {
  const fixture = buildFixture();
  for (const extra of [
    { CAIRN_ORB_CLAUDE_VERSION: 'latest' },
    { CAIRN_ORB_CODEX_VERSION: '1.2' },
    { CAIRN_ORB_NODE_MAJOR: '18' },
  ]) {
    const result = fixture.run(extra);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  const extraArgument = spawnSync('bash', [script, '--dry-run'], {
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(extraArgument.status, 2);
  assert.deepEqual(fixture.recorded(), []);
});

const dockerfile = readFileSync(join(imageDirectory, 'Dockerfile'), 'utf8');
const entry = readFileSync(join(imageDirectory, 'entry.sh'), 'utf8');

test('the Dockerfile ends as the unprivileged user and cannot ask for host privileges', () => {
  const users = [...dockerfile.matchAll(/^USER\s+(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(users, ['user']);
  assert.ok(dockerfile.lastIndexOf('USER user') > dockerfile.lastIndexOf('RUN '));
  assert.doesNotMatch(
    dockerfile + entry,
    /--privileged|--cap-add|--security-opt|--network[ =]host|--device|--pid[ =]host/,
  );
  assert.doesNotMatch(dockerfile, /^(EXPOSE|VOLUME)\b/m);
});

test('the Dockerfile pins its base by digest and keeps a base stage', () => {
  assert.match(dockerfile, /^FROM docker\.io\/library\/archlinux@sha256:[0-9a-f]{64} AS base$/m);
  for (const arg of [
    'NODE_MAJOR',
    'CLAUDE_VERSION',
    'CODEX_VERSION',
    'PNPM_VERSION',
    'USER_UID=1000',
  ])
    assert.match(dockerfile, new RegExp(`^ARG ${arg}$`, 'm'));
  assert.doesNotMatch(dockerfile, /AS computer/);
});

test('sudo is passwordless for user and keeps the proxy variables', () => {
  assert.match(dockerfile, /'user ALL=\(ALL\) NOPASSWD:ALL'/);
  assert.match(
    dockerfile,
    /'Defaults env_keep \+= "HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy"'/,
  );
  assert.match(dockerfile, /\/etc\/sudoers\.d\/user/);
  assert.match(dockerfile, /chmod 0440 \/etc\/sudoers\.d\/user/);
  assert.match(dockerfile, /visudo -cf/);
  assert.match(dockerfile, /useradd --uid "\$USER_UID"/);
});

test('the Dockerfile keeps the nspawn recipe packages, lifecycle script rules and marker', () => {
  for (const name of [
    'base',
    'git',
    'npm',
    'openssh',
    'ca-certificates',
    'curl',
    'bubblewrap',
    'socat',
    'python',
    'sudo',
    'tmux',
  ])
    assert.match(dockerfile, new RegExp(`\\b${name}\\b`));
  assert.match(dockerfile, /npm install --global --ignore-scripts /);
  assert.equal(dockerfile.match(/npm install/g).length, 1);
  assert.match(dockerfile, /node install\.cjs/);
  assert.match(dockerfile, /> \/etc\/cairn-orb-image/);
  assert.match(dockerfile, /enableWeakerNestedSandbox/);
  assert.match(dockerfile, /^COPY --chmod=0755 entry\.sh \/usr\/local\/bin\/cairn-orb-entry$/m);
  assert.match(dockerfile, /^CMD \["\/usr\/local\/bin\/cairn-orb-entry"\]$/m);
});

test('the entry script never runs the worker through a privilege change', () => {
  assert.doesNotMatch(entry, /\b(sudo|su|runuser|setpriv|doas)\b/);
  const workerLines = entry.split('\n').filter((line) => /\bnode\b/.test(line));
  assert.deepEqual(workerLines, ['  node "$DAEMON_ENTRY" orb-step --socket "$RELAY_SOCKET" &']);
  assert.match(entry, /\[\[ \$\(id -u\) == 0 \]\]/);
});

function entryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-entry-'));
  temporaryRoots.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const relay = join(root, 'relay.sock');
  const daemonEntry = join(root, 'cli.mjs');
  const log = join(root, 'log');
  const rewritten = readFileSync(join(imageDirectory, 'entry.sh'), 'utf8')
    .replace('readonly RELAY_SOCKET=/run/cairn/relay.sock', `readonly RELAY_SOCKET=${relay}`)
    .replace(
      'readonly DAEMON_ENTRY=/opt/cairn/daemon/cli.mjs',
      `readonly DAEMON_ENTRY=${daemonEntry}`,
    );
  const entryPath = join(root, 'entry.sh');
  executable(entryPath, rewritten);
  executable(
    join(bin, 'node'),
    `#!/usr/bin/env bash
count=$(cat "${root}/count" 2> /dev/null || echo 0)
count=$((count + 1))
printf '%s' "$count" > "${root}/count"
printf 'node %s\\n' "$*" >> "${log}"
printf 'env CAIRN_ORB=%s HTTP_PROXY=%s https_proxy=%s NO_PROXY=%s no_proxy=%s\\n' "\${CAIRN_ORB-}" "\${HTTP_PROXY-}" "\${https_proxy-}" "\${NO_PROXY-}" "\${no_proxy-}" >> "${log}"
if [[ -n \${FAKE_WORKER_SLEEP-} ]]; then
  trap 'printf "worker-term\\n" >> "${log}"; exit 0' TERM
  sleep 30 &
  wait
fi
IFS=, read -ra codes <<< "\${FAKE_WORKER_CODES:-0}"
exit "\${codes[$((count - 1))]:-0}"
`,
  );
  executable(
    join(bin, 'socat'),
    `#!/usr/bin/env bash
printf 'socat %s\\n' "$*" >> "${log}"
if [[ \${FAKE_SOCAT_EXIT-} ]]; then exit "$FAKE_SOCAT_EXIT"; fi
exec sleep 30
`,
  );
  executable(
    join(bin, 'ss'),
    '#!/usr/bin/env bash\n[[ -n "$FAKE_SOCAT_EXIT" ]] || echo "LISTEN 0 5 127.0.0.1:7890 0.0.0.0:*"\n',
  );
  const environment = (extra = {}) => {
    const base = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra };
    for (const name of [
      'CAIRN_ORB_EGRESS_SOCKET',
      'HTTP_PROXY',
      'https_proxy',
      'NO_PROXY',
      'no_proxy',
      'CAIRN_ORB',
    ])
      if (!(name in extra)) delete base[name];
    return base;
  };
  const listen = () =>
    new Promise((resolve) => {
      const server = createServer();
      server.listen(relay, () => resolve(server));
    });
  const lines = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  const start = (extra = {}) => {
    const child = spawn('bash', [entryPath], { env: environment(extra), stdio: 'ignore' });
    const exited = new Promise((resolve) =>
      child.on('exit', (code, signal) => resolve({ code, signal })),
    );
    return { child, exited };
  };
  return { root, bin, relay, daemonEntry, entryPath, listen, lines, start, environment };
}

test('the entry script refuses to run as root', () => {
  const fixture = entryFixture();
  executable(join(fixture.bin, 'id'), '#!/usr/bin/env bash\necho 0\n');
  const result = spawnSync('bash', [fixture.entryPath], {
    env: fixture.environment(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not run as root/);
  assert.deepEqual(fixture.lines(), []);
});

test('the entry script waits for the relay socket, then runs the worker with the exact argv', async () => {
  const fixture = entryFixture();
  const { exited } = fixture.start();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(fixture.lines(), []);
  const server = await fixture.listen();
  const { code } = await exited;
  server.close();
  assert.equal(code, 0);
  assert.equal(
    fixture.lines()[0],
    `node ${fixture.daemonEntry} orb-step --socket ${fixture.relay}`,
  );
  assert.match(
    fixture.lines()[1],
    /^env CAIRN_ORB=1 HTTP_PROXY= https_proxy= NO_PROXY= no_proxy=$/,
  );
});

test('with an egress socket the entry script bridges 127.0.0.1:7890 and exports the proxy variables', async () => {
  const fixture = entryFixture();
  const server = await fixture.listen();
  const { exited } = fixture.start({ CAIRN_ORB_EGRESS_SOCKET: '/run/cairn-egress/egress.sock' });
  const { code } = await exited;
  server.close();
  assert.equal(code, 0);
  assert.equal(
    fixture.lines()[0],
    'socat TCP-LISTEN:7890,bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:/run/cairn-egress/egress.sock',
  );
  assert.equal(
    fixture.lines()[2],
    'env CAIRN_ORB=1 HTTP_PROXY=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1',
  );
});

test('the entry script fails when the egress bridge cannot start', async () => {
  const fixture = entryFixture();
  const server = await fixture.listen();
  const { exited } = fixture.start({
    CAIRN_ORB_EGRESS_SOCKET: '/run/cairn-egress/egress.sock',
    FAKE_SOCAT_EXIT: '1',
  });
  const { code } = await exited;
  server.close();
  assert.equal(code, 1);
  assert.ok(!fixture.lines().some((line) => line.startsWith('node ')));
});

test('the worker restarts on exit 75 only', async () => {
  const fixture = entryFixture();
  const server = await fixture.listen();
  const restarted = await fixture.start({ FAKE_WORKER_CODES: '75,75,0' }).exited;
  assert.equal(restarted.code, 0);
  assert.equal(fixture.lines().filter((line) => line.startsWith('node ')).length, 3);
  for (const code of ['1', '2', '0', '74', '76']) {
    const next = entryFixture();
    const nextServer = await next.listen();
    const result = await next.start({ FAKE_WORKER_CODES: code }).exited;
    nextServer.close();
    assert.equal(result.code, Number(code), `worker exit ${code}`);
    assert.equal(next.lines().filter((line) => line.startsWith('node ')).length, 1);
  }
  server.close();
});

test('SIGTERM reaches the worker and the entry script exits', async () => {
  const fixture = entryFixture();
  const server = await fixture.listen();
  const { child, exited } = fixture.start({ FAKE_WORKER_SLEEP: '1' });
  await new Promise((resolve) => setTimeout(resolve, 800));
  child.kill('SIGTERM');
  const { code } = await exited;
  server.close();
  assert.equal(code, 0);
  assert.ok(fixture.lines().includes('worker-term'));
});
