import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = import.meta.dirname;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-shell-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fake = join(bin, 'fake.mjs');
  writeFileSync(
    fake,
    `#!${process.execPath}
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
const cmd = basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.CAIRN_ORB_ROOT;
appendFileSync(join(root, 'calls'), JSON.stringify([cmd, ...args]) + '\\n');
if (process.env.FAIL_COMMAND === cmd) process.exit(1);
if (cmd === 'node') console.log(args[0].endsWith('/runtime-directory.mjs') ? '0 changes' : JSON.stringify({ http: process.env.http_proxy, https: process.env.https_proxy }));
if (cmd === 'sysctl') console.log(process.env.PROTECTED_HARDLINKS ?? '1');
if (cmd === 'id') console.log(args[0] === '-un' ? (process.env.FAKE_USER || 'root') : args.includes('ian') ? (process.env.AGENT_UID || '1000') : '0');
if (cmd === 'runuser' || cmd === 'bash') console.log(args.some((arg) => arg.includes('daemon-package.mjs')) ? (process.env.CAIRN_ORB_NODE_MAJOR || process.env.HOST_NODE_MAJOR || '26') : args.at(-1).includes('claude') ? (process.env.BAD_VERSION || '2.1.302 (Claude Code)') : 'codex-cli 0.163.0');
if (cmd !== 'systemd-nspawn' && cmd !== 'pacstrap' && args.some((arg) => arg === '-M' || arg.startsWith('--machine'))) process.exit(91);
if (cmd === 'machinectl' && args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg))) process.exit(92);
if (cmd === 'stat') console.log(args.includes('-f') ? (process.env.MACHINES_FILESYSTEM || 'ext4') : args.includes('%i') ? (existsSync(join(args.at(-1), '.fake-subvolume')) ? '256' : '257') : (process.env.DIR_OWNER || 'ian:700'));
if (cmd === 'btrfs') {
  const target = args.at(-1);
  if (args[1] === 'create') { mkdirSync(target); writeFileSync(join(target, '.fake-subvolume'), ''); }
  else if (args[1] === 'delete') {
    if (!existsSync(join(target, '.fake-subvolume'))) process.exit(2);
    const nested = readdirSync(target, { recursive: true }).some((entry) => String(entry).endsWith('/.fake-subvolume'));
    if (nested && !args.includes('-R')) { console.error('ERROR: Could not destroy subvolume: Directory not empty'); process.exit(1); }
    rmSync(target, { recursive: true });
  } else process.exit(2);
}
if (cmd === 'rm') {
  const target = args.at(-1);
  if (existsSync(join(target, '.fake-subvolume'))) { console.error('rm must never delete a subvolume'); process.exit(93); }
  rmSync(target, { recursive: true, force: true });
}
if (cmd === 'sha256sum') console.log('fake-recipe  ' + args[0]);
if (cmd === 'pacstrap') {
  if (process.env.APPEARED_IMAGE) {
    const appeared = join(root, 'var/lib/machines/cairn-orb-base/etc');
    mkdirSync(appeared, { recursive: true });
    writeFileSync(join(appeared, 'cairn-orb-image'), 'owner-created-image');
  }
  mkdirSync(join(args[2], 'etc'), { recursive: true });
  if (existsSync(join(args[2], '.fake-subvolume'))) {
    mkdirSync(join(args[2], 'var/lib/machines'), { recursive: true });
    writeFileSync(join(args[2], 'var/lib/machines/.fake-subvolume'), '');
  }
  if (process.env.MOUNTED_STAGE) writeFileSync(join(root, 'active-mount'), args[2] + '/dev');
}
if (cmd === 'findmnt' && args.includes('--target')) { console.log(process.env.RUN_MOUNT_OPTIONS ?? 'rw,nosuid,nodev'); process.exit(0); }
if (cmd === 'findmnt' && existsSync(join(root, 'active-mount'))) {
  const active = readFileSync(join(root, 'active-mount'), 'utf8');
  console.log(join(realpathSync(dirname(active)), basename(active)));
}
if (cmd === 'mv') {
  if (process.env.FAIL_PUBLISH && args.at(-2).includes('.cairn-orb-build.')) process.exit(1);
  if (existsSync(args.at(-1))) process.exit(1);
  renameSync(args.at(-2), args.at(-1));
}
if (cmd === 'arch-chroot') {
  const input = readFileSync(0, 'utf8');
  writeFileSync(join(root, 'guest-recipe'), input);
  writeFileSync(join(root, 'guest-args'), JSON.stringify(args));
  const gate = /^node -e '(.+)'/m.exec(input)?.[1];
  if (gate) runInNewContext(gate, {
    console,
    process: { argv: ['node', args.at(-1)], versions: { node: (process.env.GUEST_NODE_MAJOR || args.at(-1)) + '.1.0' }, exit: (code) => process.exit(code) },
  });
  if (!input.includes('major < 22') || !input.includes('passwd --lock root') || !input.includes('systemctl mask sshd')) process.exit(3);
}
if (cmd === 'machinectl') console.log('cairn-orb-base directory no');
if (cmd === 'systemctl') {
  const state = join(root, 'properties');
  if (args[0] === 'show') console.log(existsSync(state) ? readFileSync(state, 'utf8') : 'MemoryMax=infinity\\nCPUQuotaPerSecUSec=infinity\\nTasksMax=16384');
  if (args[0] === 'set-property') writeFileSync(state, 'MemoryMax=4294967296\\nCPUQuotaPerSecUSec=4s\\nTasksMax=4096');
}
if (cmd === 'install') {
  const dest = args.at(-1);
  mkdirSync(dirname(dest), { recursive: true });
  if (args.includes('-d')) mkdirSync(dest, { recursive: true });
  else copyFileSync(args.at(-2), dest);
}
if (cmd === 'ip') console.log('7: vz-cairn inet ' + (process.env.BRIDGE_IP || '10.203.0.1') + '/24 brd 10.203.0.255 scope global vz-cairn');
`,
  );
  chmodSync(fake, 0o755);
  for (const cmd of [
    'node',
    'npm',
    'sysctl',
    'bash',
    'id',
    'runuser',
    'sha256sum',
    'findmnt',
    'flock',
    'mv',
    'pacstrap',
    'arch-chroot',
    'machinectl',
    'systemctl',
    'install',
    'ip',
    'socat',
    'stat',
    'btrfs',
    'rm',
    'systemd-nspawn',
    'systemd-run',
  ])
    symlinkSync(fake, join(bin, cmd));
  const env = { ...process.env, CAIRN_ORB_ROOT: root, PATH: `${bin}:${process.env.PATH}` };
  const run = (file, args = [], extra = {}) =>
    spawnSync('/bin/bash', [join(source, file), ...args], {
      env: {
        ...env,
        CAIRN_ORB_NODE: join(bin, 'node'),
        CAIRN_ORB_FIXED_BINDS: `--bind=/run/cairn-orb/${args.at(-1)}:/run/cairn:idmap,norbind --bind-ro=/var/lib/cairn-orb/dist:/opt/cairn/daemon:idmap,norbind --bind-ro=/var/lib/cairn-orb/seed:/seed:idmap,norbind`,
        ...extra,
      },
      encoding: 'utf8',
    });
  const calls = () =>
    existsSync(join(root, 'calls'))
      ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
  return { root, run, calls, env };
}

for (const file of [
  'install-host.sh',
  'build-image.sh',
  'prepare-machine.sh',
  'egress-relay.sh',
  'orb-host-check.sh',
]) {
  test(`${file} parses as bash and enables strict mode`, () => {
    assert.equal(spawnSync('bash', ['-n', join(source, file)]).status, 0);
    assert.match(readFileSync(join(source, file), 'utf8'), /^set -euo pipefail$/m);
  });
}

test('image dry-run prints pins and never invokes privileged mutations', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@anthropic-ai\/claude-code@2.1.302/);
    assert.match(result.stdout, /@openai\/codex@0.163.0/);
    assert.match(result.stdout, /write \/etc\/environment/);
    assert.match(result.stdout, /mask SSH server/);
    assert.ok(f.calls().every(([cmd]) => ['id', 'runuser', 'sha256sum', 'stat'].includes(cmd)));
    assert.equal(existsSync(join(f.root, 'var')), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('image build publishes only a complete image and reruns without changes', () => {
  const f = fixture();
  try {
    const first = f.run('build-image.sh');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /1 changes/);
    assert.ok(existsSync(join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image')));
    const second = f.run('build-image.sh');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), '0 changes');
    assert.equal(f.calls().filter(([cmd]) => cmd === 'pacstrap').length, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const fail of ['pacstrap', 'arch-chroot']) {
  test(`failed ${fail} does not register or preserve a partial image`, () => {
    const f = fixture();
    try {
      const result = f.run('build-image.sh', [], { FAIL_COMMAND: fail });
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(f.root, 'var/lib/machines/cairn-orb-base')), false);
      assert.deepEqual(readdirSync(join(f.root, 'var/lib/machines')), []);
      assert.ok(!f.calls().some(([cmd]) => cmd === 'machinectl'));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('invalid host pins and an unrelated existing image fail closed', () => {
  const f = fixture();
  try {
    assert.notEqual(f.run('build-image.sh', ['--dry-run'], { BAD_VERSION: 'invalid' }).status, 0);
    mkdirSync(join(f.root, 'var/lib/machines/cairn-orb-base'), { recursive: true });
    const result = f.run('build-image.sh');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /preserve/);
    assert.ok(!f.calls().some(([cmd]) => cmd === 'pacstrap'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('preparation applies the shared template and actual runtime limits idempotently', () => {
  const f = fixture();
  try {
    for (const [from, to] of [
      ['cairn-orb.nspawn', 'etc/systemd/nspawn/cairn-orb.nspawn'],
      [
        'systemd-nspawn@cairn-orb-.service.d/limits.conf',
        'etc/systemd/system/systemd-nspawn@cairn-orb-.service.d/limits.conf',
      ],
    ]) {
      mkdirSync(join(f.root, to, '..'), { recursive: true });
      writeFileSync(join(f.root, to), readFileSync(join(source, from)));
    }
    mkdirSync(join(f.root, 'run/cairn-orb/cairn-orb-test-a'), { recursive: true });
    const dry = f.run('prepare-machine.sh', ['--dry-run', 'cairn-orb-test-a']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(existsSync(join(f.root, 'run/systemd')), false);
    assert.ok(!f.calls().some((call) => call.includes('set-property')));
    const first = f.run('prepare-machine.sh', ['cairn-orb-test-a']);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /MemoryMax=4G CPUQuota=400% TasksMax=4096/);
    assert.equal(f.run('prepare-machine.sh', ['cairn-orb-test-a']).stdout.trim(), '0 changes');
    for (const flags of ['rw,nodev', 'rw,nosuid', 'rw', '']) {
      assert.notEqual(
        f.run('prepare-machine.sh', ['cairn-orb-test-a'], { RUN_MOUNT_OPTIONS: flags }).status,
        0,
      );
    }
    writeFileSync(
      join(f.root, 'properties'),
      'MemoryMax=42949672960\nCPUQuotaPerSecUSec=4s\nTasksMax=40960',
    );
    assert.match(f.run('prepare-machine.sh', ['cairn-orb-test-a']).stdout, /set-property/);
    const persistent = join(f.root, 'etc/systemd/nspawn/cairn-orb-test-a.nspawn');
    writeFileSync(persistent, '[Files]\nBind=/home\n');
    assert.notEqual(f.run('prepare-machine.sh', ['cairn-orb-test-a']).status, 0);
    assert.equal(f.run('prepare-machine.sh', ['unrelated']).status, 0);
    assert.equal(
      readFileSync(join(f.root, 'run/systemd/nspawn/unrelated.binds'), 'utf8').trim(),
      'CAIRN_ORB_BINDS=',
    );
    assert.equal(f.run('prepare-machine.sh', ['unrelated']).stdout.trim(), '0 changes');
    assert.notEqual(f.run('prepare-machine.sh', ['cairn-orb-../../evil']).status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('relay binds only its expected bridge and forwards only to loopback', () => {
  const f = fixture();
  try {
    const dry = f.run('egress-relay.sh', ['--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(!f.calls().some(([cmd]) => cmd === 'socat'));
    assert.equal(f.run('egress-relay.sh').status, 0);
    const relay = f.calls().find(([cmd]) => cmd === 'node');
    assert.ok(relay[1].endsWith('/egress-relay.mjs'));
    assert.ok(!f.calls().some(([cmd]) => cmd === 'socat'));
    assert.notEqual(f.run('egress-relay.sh', [], { BRIDGE_IP: '192.0.2.1' }).status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('guest image provides Node and CLIs without package-manager bootstrapping', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.doesNotMatch(script, /corepack install|pnpm --version/);
  assert.match(script, /npm install --global --ignore-scripts/);
});

test("guest image runs only Claude Code's own native installer and verifies both CLIs as agent", () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  const install = script.indexOf('npm install --global --ignore-scripts');
  const native = script.indexOf('node install.cjs');
  const claudeCheck = script.indexOf('runuser -u agent -- claude --version');
  const codexCheck = script.indexOf('runuser -u agent -- codex --version');
  assert.ok(install >= 0, 'global CLI install keeps --ignore-scripts');
  assert.ok(native > install, "Claude Code's install.cjs runs after the scripted-off install");
  assert.ok(claudeCheck > native, 'the agent verifies the Claude Code binary after placement');
  assert.ok(codexCheck > native, 'the agent verifies the codex binary');
  assert.doesNotMatch(script, /--omit[= ]optional/);
  assert.match(script.slice(install, native), /@anthropic-ai\/claude-code/);
});

test('ian can preview image creation without runuser or privilege', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', ['--dry-run'], {
      FAKE_USER: 'ian',
      FAIL_COMMAND: 'runuser',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!f.calls().some(([cmd]) => cmd === 'runuser'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the actual image Node gate rejects a different major with an actionable error', () => {
  const gate = /^node -e '(.+)' "\$5"$/m.exec(
    readFileSync(join(source, 'build-image.sh'), 'utf8'),
  )?.[1];
  assert.ok(gate);
  for (const node of ['20.19.0', '22.18.0', '24.14.0', '28.0.0']) {
    const messages = [];
    assert.throws(
      () =>
        runInNewContext(gate, {
          console: { error: (message) => messages.push(message) },
          process: {
            argv: ['node', '26'],
            versions: { node },
            exit: () => {
              throw new Error('unsupported');
            },
          },
        }),
      /unsupported/,
    );
    assert.match(messages.join(' '), /guest Node.*host daemon.*26/i);
  }
  assert.doesNotThrow(() =>
    runInNewContext(gate, {
      console,
      process: {
        argv: ['node', '26'],
        versions: { node: '26.1.0' },
        exit: () => assert.fail('matching major rejected'),
      },
    }),
  );
});

test('failed image cleanup preserves a tree with active mounts', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', [], { FAIL_COMMAND: 'arch-chroot', MOUNTED_STAGE: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mounted image/);
    assert.ok(
      readdirSync(join(f.root, 'var/lib/machines')).some((name) =>
        name.startsWith('.cairn-orb-build.'),
      ),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a busy build lock prevents provisioning another image', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', [], { FAIL_COMMAND: 'flock' });
    assert.notEqual(result.status, 0);
    assert.ok(!f.calls().some(([cmd]) => cmd === 'pacstrap'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('installer supplies the loopback proxy to provisioning commands', () => {
  const f = fixture();
  try {
    const result = f.run('install-host.sh', ['--dry-run'], {
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      http_proxy: '',
      https_proxy: '',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      http: 'http://127.0.0.1:7890',
      https: 'http://127.0.0.1:7890',
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('CLI version drift rebuilds the base image and the next run prints zero changes', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const changed = f.run('build-image.sh', [], { BAD_VERSION: '2.2.0' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /rebuild cairn-orb-base/);
    assert.match(changed.stdout, /1 changes/);
    assert.match(
      readFileSync(join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'), 'utf8'),
      /claude=2.2.0/,
    );
    const next = f.run('build-image.sh', [], { BAD_VERSION: '2.2.0' });
    assert.equal(next.status, 0, next.stderr);
    assert.equal(next.stdout.trim(), '0 changes');
    assert.equal(f.calls().filter(([cmd]) => cmd === 'pacstrap').length, 2);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('failed replacement build preserves the completed base image', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const marker = join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image');
    const original = readFileSync(marker, 'utf8');
    assert.notEqual(
      f.run('build-image.sh', [], { BAD_VERSION: '2.2.0', FAIL_COMMAND: 'pacstrap' }).status,
      0,
    );
    assert.equal(readFileSync(marker, 'utf8'), original);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an image appearing during a build is preserved instead of being replaced', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', [], { APPEARED_IMAGE: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /preserve/);
    assert.equal(
      readFileSync(join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'), 'utf8'),
      'owner-created-image',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('failed image publication restores the previous base', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const marker = join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image');
    const original = readFileSync(marker, 'utf8');
    const result = f.run('build-image.sh', [], { BAD_VERSION: '2.2.0', FAIL_PUBLISH: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /restore previous base/);
    assert.equal(readFileSync(marker, 'utf8'), original);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('image ships enabled guest worker and trigger units with one daemon entry', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.match(script, /daemon_entry=\/opt\/cairn\/daemon\/cli.mjs/);
  assert.match(script, /User=agent/);
  assert.match(script, /Restart=always/);
  assert.match(script, /After=local-fs.target/);
  assert.match(script, /orb-step --socket \/run\/cairn\/relay.sock/);
  assert.match(script, /PathExists=\/run\/cairn\/check-request/);
  assert.match(script, /systemctl enable cairn-orb-worker.service cairn-orb-check.path/);
  assert.match(script, /useradd --uid "\$3"/);
});

test('preparation delegates source creation and stop to the root fd helper', () => {
  const f = fixture();
  try {
    const name = 'cairn-orb-test-a';
    mkdirSync(join(f.root, 'run/cairn-orb'), { recursive: true });
    writeFileSync(
      join(f.root, 'properties'),
      'MemoryMax=4294967296\nCPUQuotaPerSecUSec=4s\nTasksMax=4096',
    );
    const dry = f.run('prepare-machine.sh', ['--dry-run', name]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(
      f
        .calls()
        .some(
          ([cmd, path, flag, machine]) =>
            cmd === 'node' &&
            path.endsWith('/runtime-directory.mjs') &&
            flag === '--dry-run' &&
            machine === name,
        ),
    );
    const stopped = f.run('prepare-machine.sh', ['--stop', name]);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.ok(
      f
        .calls()
        .some(
          ([cmd, path, flag, machine]) =>
            cmd === 'node' &&
            path.endsWith('/runtime-directory.mjs') &&
            flag === '--stop' &&
            machine === name,
        ),
    );
    assert.equal(f.run('prepare-machine.sh', ['--stop', 'unrelated']).status, 0);
    assert.notEqual(
      f.run('prepare-machine.sh', ['--dry-run', name], { PROTECTED_HARDLINKS: '0' }).status,
      0,
    );
    assert.notEqual(f.run('prepare-machine.sh', ['cairn-orb-base']).status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('agent UID drift rebuilds the image and invalid mappings fail closed', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    assert.equal(f.run('build-image.sh', [], { AGENT_UID: '1001' }).status, 0);
    assert.match(
      readFileSync(join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'), 'utf8'),
      /agent_uid=1001/,
    );
    for (const uid of ['0', '65534', 'invalid'])
      assert.notEqual(f.run('build-image.sh', ['--dry-run'], { AGENT_UID: uid }).status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('image recipe only installs CLI packages and retains the mounted release entry', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const args = JSON.parse(readFileSync(join(f.root, 'guest-args'), 'utf8'));
    const recipe = readFileSync(join(f.root, 'guest-recipe'), 'utf8');
    const installs = recipe.split('\n').filter((line) => /^npm install /.test(line));
    assert.equal(installs.length, 1);
    const worker =
      /cat > \/etc\/systemd\/system\/cairn-orb-worker.service <<WORKER\n([\s\S]+?)\nWORKER/.exec(
        recipe,
      )[1];
    const guest = spawnSync('/bin/bash', ['-s', '--', ...args.slice(args.indexOf('--') + 1)], {
      input: `${installs.join('\n')}\ncat <<WORKER\n${worker}\nWORKER\n`,
      env: f.env,
      encoding: 'utf8',
    });
    assert.equal(guest.status, 0, guest.stderr);
    assert.match(
      guest.stdout,
      /^ExecStart=\/usr\/bin\/node \/opt\/cairn\/daemon\/cli.mjs orb-step --socket \/run\/cairn\/relay.sock$/m,
    );
    assert.deepEqual(
      f.calls().filter(([cmd]) => cmd === 'npm'),
      [
        [
          'npm',
          'install',
          '--global',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '@anthropic-ai/claude-code@2.1.302',
          '@openai/codex@0.163.0',
        ],
      ],
    );
    assert.doesNotMatch(recipe, /@xiechimon\/cairn-cli|npm install --prefix/);
    const marker = readFileSync(
      join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'),
      'utf8',
    );
    assert.match(marker, /node_major=26/);
    assert.doesNotMatch(marker, /daemon=|daemon_package=|pnpm=/);
    assert.equal(
      f.run('build-image.sh', [], { CAIRN_ORB_DAEMON_VERSION: '999.0.0' }).stdout.trim(),
      '0 changes',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Node major drift rebuilds and converges', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const changed = f.run('build-image.sh', [], { HOST_NODE_MAJOR: '28' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /rebuild cairn-orb-base/);
    const marker = readFileSync(
      join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'),
      'utf8',
    );
    assert.match(marker, /node_major=28/);
    assert.equal(f.run('build-image.sh', [], { HOST_NODE_MAJOR: '28' }).stdout.trim(), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('legacy image markers rebuild without retaining npm daemon pins', () => {
  const f = fixture();
  try {
    const marker = join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image');
    mkdirSync(join(marker, '..'), { recursive: true });
    for (const daemon of ['', '\ndaemon_package=@xiechimon/cairn-cli\ndaemon=0.2.2']) {
      writeFileSync(
        marker,
        `recipe=old\nclaude=2.1.0\ncodex=0.100.0\npnpm=12.5.1\nagent_uid=1000${daemon}\n`,
      );
      const changed = f.run('build-image.sh');
      assert.equal(changed.status, 0, changed.stderr);
      assert.match(changed.stdout, /rebuild cairn-orb-base/);
      assert.match(readFileSync(marker, 'utf8'), /node_major=26/);
      assert.doesNotMatch(readFileSync(marker, 'utf8'), /daemon=/);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('guest Node mismatch aborts staging before image registration', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', [], { GUEST_NODE_MAJOR: '24' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Guest Node 24.1.0 must match host daemon Node major 26/);
    assert.equal(existsSync(join(f.root, 'var/lib/machines/cairn-orb-base')), false);
    assert.ok(!f.calls().some(([cmd]) => cmd === 'machinectl'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('generated guest check unit permits the network wait and subsequent probes', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh');
    assert.equal(result.status, 0, result.stderr);
    const recipe = readFileSync(join(f.root, 'guest-recipe'), 'utf8');
    const unit =
      /cat > \/etc\/systemd\/system\/cairn-orb-check.service <<'CHECK'\n([\s\S]+?)\nCHECK/.exec(
        recipe,
      )?.[1];
    assert.ok(unit);
    assert.match(unit, /^TimeoutStartSec=240$/m);
    assert.match(
      unit,
      /^ExecStart=\/usr\/bin\/node \/usr\/local\/lib\/cairn-orb\/guest-check.mjs$/m,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('btrfs image build publishes a subvolume and reruns without changes', () => {
  const f = fixture();
  try {
    const env = { MACHINES_FILESYSTEM: 'btrfs' };
    const first = f.run('build-image.sh', [], env);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /1 changes/);
    const image = join(f.root, 'var/lib/machines/cairn-orb-base');
    assert.ok(existsSync(join(image, '.fake-subvolume')));
    const calls = f.calls();
    const create = calls.findIndex(([cmd, , action]) => cmd === 'btrfs' && action === 'create');
    assert.ok(create >= 0 && create < calls.findIndex(([cmd]) => cmd === 'pacstrap'));
    assert.equal(f.run('build-image.sh', [], env).stdout.trim(), '0 changes');
    assert.equal(f.calls().filter(([cmd]) => cmd === 'pacstrap').length, 1);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a directory base on btrfs rebuilds once even with matching image pins', () => {
  const f = fixture();
  try {
    assert.equal(f.run('build-image.sh').status, 0);
    const changed = f.run('build-image.sh', [], { MACHINES_FILESYSTEM: 'btrfs' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /rebuild cairn-orb-base:.*subvolume/);
    assert.match(changed.stdout, /1 changes/);
    assert.ok(existsSync(join(f.root, 'var/lib/machines/cairn-orb-base/.fake-subvolume')));
    assert.equal(
      f.run('build-image.sh', [], { MACHINES_FILESYSTEM: 'btrfs' }).stdout.trim(),
      '0 changes',
    );
    assert.equal(f.calls().filter(([cmd]) => cmd === 'pacstrap').length, 2);
    assert.ok(
      f
        .calls()
        .some(([cmd, ...args]) => cmd === 'rm' && args.at(-1).includes('.cairn-orb-previous.')),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('btrfs replacement deletes the old subvolume and its nested subvolumes without rm', () => {
  const f = fixture();
  try {
    const env = { MACHINES_FILESYSTEM: 'btrfs' };
    assert.equal(f.run('build-image.sh', [], env).status, 0);
    const changed = f.run('build-image.sh', [], { ...env, BAD_VERSION: '2.2.0' });
    assert.equal(changed.status, 0, changed.stderr);
    assert.ok(
      f
        .calls()
        .some(
          ([cmd, , action, ...rest]) =>
            cmd === 'btrfs' &&
            action === 'delete' &&
            rest.includes('-R') &&
            rest.at(-1).includes('.cairn-orb-previous.'),
        ),
    );
    assert.deepEqual(readdirSync(join(f.root, 'var/lib/machines')), ['cairn-orb-base']);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

for (const failure of ['pacstrap', 'arch-chroot', 'publish']) {
  test(`btrfs ${failure} failure preserves the base and deletes the staging subvolume`, () => {
    const f = fixture();
    try {
      const env = { MACHINES_FILESYSTEM: 'btrfs' };
      assert.equal(f.run('build-image.sh', [], env).status, 0);
      const image = join(f.root, 'var/lib/machines/cairn-orb-base');
      const original = readFileSync(join(image, 'etc/cairn-orb-image'), 'utf8');
      const result = f.run('build-image.sh', [], {
        ...env,
        BAD_VERSION: '2.2.0',
        ...(failure === 'publish' ? { FAIL_PUBLISH: '1' } : { FAIL_COMMAND: failure }),
      });
      assert.notEqual(result.status, 0);
      assert.ok(existsSync(join(image, '.fake-subvolume')));
      assert.equal(readFileSync(join(image, 'etc/cairn-orb-image'), 'utf8'), original);
      assert.ok(
        f
          .calls()
          .some(
            ([cmd, , action, ...rest]) =>
              cmd === 'btrfs' &&
              action === 'delete' &&
              rest.includes('-R') &&
              rest.at(-1).includes('.cairn-orb-build.'),
          ),
      );
      assert.deepEqual(readdirSync(join(f.root, 'var/lib/machines')), ['cairn-orb-base']);
      if (failure === 'publish') assert.match(result.stdout, /restore previous base/);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('btrfs dry run plans subvolume staging without creating it', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', ['--dry-run'], { MACHINES_FILESYSTEM: 'btrfs' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /subvolume/);
    assert.ok(!f.calls().some(([cmd]) => ['btrfs', 'pacstrap', 'rm'].includes(cmd)));
    assert.equal(existsSync(join(f.root, 'var')), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('btrfs mounted staging subvolume is preserved on failure', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', [], {
      MACHINES_FILESYSTEM: 'btrfs',
      FAIL_COMMAND: 'arch-chroot',
      MOUNTED_STAGE: '1',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mounted image/);
    const stage = readdirSync(join(f.root, 'var/lib/machines')).find((name) =>
      name.startsWith('.cairn-orb-build.'),
    );
    assert.ok(stage && existsSync(join(f.root, 'var/lib/machines', stage, '.fake-subvolume')));
    assert.ok(!f.calls().some(([cmd, , action]) => cmd === 'btrfs' && action === 'delete'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
