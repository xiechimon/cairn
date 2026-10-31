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
if (cmd === 'id') console.log(args[0] === '-un' ? (process.env.FAKE_USER || 'root') : '0');
if (cmd === 'runuser' || cmd === 'bash') console.log(args.at(-1).includes('claude') ? (process.env.BAD_VERSION || '2.1.0 (Claude Code)') : 'codex-cli 0.100.0');
if (cmd === 'sha256sum') console.log('fake-recipe  ' + args[0]);
if (cmd === 'pacstrap') {
  mkdirSync(join(args[2], 'etc'), { recursive: true });
  if (process.env.MOUNTED_STAGE) writeFileSync(join(root, 'active-mount'), args[2] + '/dev');
}
if (cmd === 'findmnt' && existsSync(join(root, 'active-mount'))) {
  const active = readFileSync(join(root, 'active-mount'), 'utf8');
  console.log(join(realpathSync(dirname(active)), basename(active)));
}
if (cmd === 'mv') {
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
  ])
    symlinkSync(fake, join(bin, cmd));
  const env = { ...process.env, CAIRN_ORB_ROOT: root, PATH: `${bin}:${process.env.PATH}` };
  const run = (file, args = [], extra = {}) =>
    spawnSync('/bin/bash', [join(source, file), ...args], {
      env: { ...env, ...extra },
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
    const dry = f.run('prepare-machine.sh', ['--dry-run', 'cairn-orb-test-a']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(existsSync(join(f.root, 'run')), false);
    assert.ok(!f.calls().some((call) => call.includes('set-property')));
    const first = f.run('prepare-machine.sh', ['cairn-orb-test-a']);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /MemoryMax=4G CPUQuota=400% TasksMax=4096/);
    assert.equal(f.run('prepare-machine.sh', ['cairn-orb-test-a']).stdout.trim(), '0 changes');
    writeFileSync(
      join(f.root, 'properties'),
      'MemoryMax=42949672960\nCPUQuotaPerSecUSec=4s\nTasksMax=40960',
    );
    assert.match(f.run('prepare-machine.sh', ['cairn-orb-test-a']).stdout, /set-property/);
    const persistent = join(f.root, 'etc/systemd/nspawn/cairn-orb-test-a.nspawn');
    writeFileSync(persistent, '[Files]\nBind=/home\n');
    assert.notEqual(f.run('prepare-machine.sh', ['cairn-orb-test-a']).status, 0);
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
    const relay = f.calls().find(([cmd]) => cmd === 'socat');
    assert.deepEqual(relay.slice(1), [
      'TCP4-LISTEN:7890,bind=10.203.0.1,reuseaddr,fork,max-children=128,range=10.203.0.0/24',
      'TCP4:127.0.0.1:7890',
    ]);
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
