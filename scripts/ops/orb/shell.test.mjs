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
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const cmd = basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.CAIRN_ORB_ROOT;
appendFileSync(join(root, 'calls'), JSON.stringify([cmd, ...args]) + '\\n');
if (process.env.FAIL_COMMAND === cmd) process.exit(1);
if (cmd === 'node') console.log(JSON.stringify({ http: process.env.http_proxy, https: process.env.https_proxy }));
if (cmd === 'id') console.log(args[0] === '-un' ? (process.env.FAKE_USER || 'root') : args.includes('ian') ? (process.env.AGENT_UID || '1000') : '0');
if (cmd === 'runuser' || cmd === 'bash') console.log(args.at(-1).includes('claude') ? (process.env.BAD_VERSION || '2.1.0 (Claude Code)') : 'codex-cli 0.100.0');
if (cmd !== 'systemd-nspawn' && cmd !== 'pacstrap' && args.some((arg) => arg === '-M' || arg.startsWith('--machine'))) process.exit(91);
if (cmd === 'machinectl' && args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg))) process.exit(92);
if (cmd === 'stat') console.log(process.env.DIR_OWNER || 'ian:700');
if (cmd === 'sha256sum') console.log('fake-recipe  ' + args[0]);
if (cmd === 'pacstrap') {
  if (process.env.APPEARED_IMAGE) {
    const appeared = join(root, 'var/lib/machines/cairn-orb-base/etc');
    mkdirSync(appeared, { recursive: true });
    writeFileSync(join(appeared, 'cairn-orb-image'), 'owner-created-image');
  }
  mkdirSync(join(args[2], 'etc'), { recursive: true });
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
    'systemd-nspawn',
    'systemd-run',
  ])
    symlinkSync(fake, join(bin, cmd));
  const env = { ...process.env, CAIRN_ORB_ROOT: root, PATH: `${bin}:${process.env.PATH}` };
  const run = (file, args = [], extra = {}) =>
    spawnSync('/bin/bash', [join(source, file), ...args], {
      env: {
        ...env,
        CAIRN_ORB_FIXED_BINDS: `--bind=/run/cairn-orb/${args.at(-1)}:/run/cairn:idmap,norbind --bind-ro=/var/lib/cairn-orb/dist:/opt/cairn/daemon:idmap,norbind --bind-ro=/var/lib/cairn-orb/seed:/seed:idmap,norbind`,
        ...extra,
      },
      encoding: 'utf8',
    });
  const calls = () =>
    existsSync(join(root, 'calls'))
      ? readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
  return { root, run, calls };
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
    assert.match(result.stdout, /@anthropic-ai\/claude-code@2.1.0/);
    assert.match(result.stdout, /@openai\/codex@0.100.0/);
    assert.match(result.stdout, /write \/etc\/environment/);
    assert.match(result.stdout, /mask SSH server/);
    assert.ok(f.calls().every(([cmd]) => ['id', 'runuser', 'sha256sum'].includes(cmd)));
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

test('guest runtime enforces Node minimum and keeps pnpm readable by agent', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.match(script, /COREPACK_HOME=\/usr\/local\/lib\/corepack/);
  assert.match(script, /runuser -u agent -- env COREPACK_HOME=.* pnpm --version/);
  assert.match(script, /DefaultEnvironment=.*COREPACK_HOME=/);
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

test('the actual image Node gate rejects versions below 22.19', () => {
  const gate = /^node -e '(.+)'$/m.exec(readFileSync(join(source, 'build-image.sh'), 'utf8'))[1];
  for (const node of ['20.19.0', '22.18.0']) {
    assert.throws(
      () =>
        runInNewContext(gate, {
          process: {
            versions: { node },
            exit: () => {
              throw new Error('unsupported');
            },
          },
        }),
      /unsupported/,
    );
  }
  for (const node of ['22.19.0', '24.14.0', '26.0.0']) {
    assert.doesNotThrow(() =>
      runInNewContext(gate, {
        process: {
          versions: { node },
          exit: () => {
            throw new Error('unsupported');
          },
        },
      }),
    );
  }
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
  assert.match(script, /daemon_entry=\/opt\/cairn\/daemon\/dist\/cli.mjs/);
  assert.match(script, /User=agent/);
  assert.match(script, /Restart=always/);
  assert.match(script, /After=local-fs.target/);
  assert.match(script, /orb-step --socket \/run\/cairn\/relay.sock/);
  assert.match(script, /PathExists=\/run\/cairn\/check-request/);
  assert.match(script, /systemctl enable cairn-orb-worker.service cairn-orb-check.path/);
  assert.match(script, /useradd --uid "\$4"/);
});

test('preparation rejects unsafe runtime ownership, modes and symlinked machine directories', () => {
  const f = fixture();
  try {
    const name = 'cairn-orb-test-a';
    const directory = join(f.root, 'run/cairn-orb', name);
    mkdirSync(directory, { recursive: true });
    for (const owner of ['ian:755', 'cairn-runner:700', 'root:700']) {
      assert.notEqual(f.run('prepare-machine.sh', [name], { DIR_OWNER: owner }).status, 0);
    }
    rmSync(directory, { recursive: true });
    symlinkSync(f.root, directory);
    assert.notEqual(f.run('prepare-machine.sh', [name]).status, 0);
    rmSync(directory);
    assert.notEqual(f.run('prepare-machine.sh', [name]).status, 0);
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
