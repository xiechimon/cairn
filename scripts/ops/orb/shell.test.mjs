import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = import.meta.dirname;
const repoPnpm = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
  JSON.parse(readFileSync(join(source, '../../../package.json'), 'utf8')).packageManager,
)[1];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-shell-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const fake = join(bin, 'fake.mjs');
  writeFileSync(
    fake,
    `#!${process.execPath}
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
const cmd = basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.CAIRN_ORB_ROOT;
appendFileSync(join(root, 'calls'), JSON.stringify([cmd, ...args]) + '\\n');
if (process.env.FAIL_COMMAND === cmd) process.exit(1);
if (cmd === 'node') console.log(args[0].endsWith('/runtime-directory.mjs') || args[0].endsWith('/computer-home.mjs') ? (process.env.HOME_CHANGES ?? '0') + ' changes' : JSON.stringify({ http: process.env.http_proxy, https: process.env.https_proxy }));
if (cmd === 'sysctl') console.log(process.env.PROTECTED_HARDLINKS ?? '1');
if (cmd === 'id') console.log(args[0] === '-un' ? (process.env.FAKE_USER || 'root') : args.includes('ian') ? (process.env.AGENT_UID || '1000') : '0');
if (cmd === 'runuser' || cmd === 'bash') console.log(args.some((arg) => arg.includes('daemon-package.mjs')) ? (process.env.CAIRN_ORB_NODE_MAJOR || process.env.HOST_NODE_MAJOR || '26') : args.at(-1).includes('claude') ? (process.env.BAD_VERSION || '2.1.302 (Claude Code)') : 'codex-cli 0.163.0');
if (cmd !== 'systemd-nspawn' && cmd !== 'pacstrap' && args.some((arg) => arg === '-M' || arg.startsWith('--machine'))) process.exit(91);
if (cmd === 'machinectl' && args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg))) process.exit(92);
if (cmd === 'stat') console.log(args.includes('-f') ? (process.env.MACHINES_FILESYSTEM || 'ext4') : args.includes('%i') ? (existsSync(join(args.at(-1), '.fake-subvolume')) ? '256' : '257') : (process.env.DIR_OWNER || 'ian:700'));
if (cmd === 'btrfs') {
  const target = args.at(-1);
  if (args[1] === 'create') { mkdirSync(target); writeFileSync(join(target, '.fake-subvolume'), ''); }
  else if (args[1] === 'snapshot') { cpSync(args[2], target, { recursive: true }); writeFileSync(join(target, '.fake-subvolume'), ''); }
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
if (cmd === 'sha256sum') { readFileSync(0); console.log('fake-recipe  ' + args[0]); }
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
if (cmd === 'findmnt' && args.includes('--target')) { console.log(args.at(-1).includes('cairn-computer') ? (process.env.HOME_MOUNT_OPTIONS ?? 'rw,nosuid,nodev') : (process.env.RUN_MOUNT_OPTIONS ?? 'rw,nosuid,nodev')); process.exit(0); }
if (cmd === 'findmnt' && existsSync(join(root, 'active-mount'))) {
  const active = readFileSync(join(root, 'active-mount'), 'utf8');
  console.log(join(realpathSync(dirname(active)), basename(active)));
}
if (cmd === 'mv') {
  if (process.env.FAIL_PUBLISH && args.at(-2).includes('.cairn-orb-build.')) process.exit(1);
  if (!args.includes('-f') && existsSync(args.at(-1))) process.exit(1);
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
if (cmd === 'machinectl') console.log('cairn-orb-base directory no\\ncairn-orb-computer directory no');
if (cmd === 'cp') cpSync(args.at(-2).slice(0, -2), args.at(-1), { recursive: true });
if (cmd === 'systemd-nspawn' && args.includes('/usr/bin/node')) console.log(process.env.GUEST_NODE_MAJOR || '26');
if (cmd === 'systemctl') {
  const state = join(root, 'properties');
  if (args[0] === 'show') console.log(existsSync(state) ? readFileSync(state, 'utf8') : 'MemoryMax=infinity\\nCPUQuotaPerSecUSec=infinity\\nTasksMax=16384');
  if (args[0] === 'set-property') writeFileSync(state, 'MemoryAccounting=true\\n');
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
    'cp',
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
  'build-computer-image.sh',
  'prepare-machine.sh',
  'egress-relay.sh',
  'orb-host-check.sh',
]) {
  test(`${file} parses as bash and enables strict mode`, () => {
    assert.equal(spawnSync('bash', ['-n', join(source, file)]).status, 0);
    assert.match(readFileSync(join(source, file), 'utf8'), /^set -euo pipefail$/m);
  });
}

test('the recipe hash fixture drains its input before exiting', () => {
  const f = fixture();
  try {
    const result = spawnSync(
      '/bin/bash',
      [
        '-o',
        'pipefail',
        '-c',
        `"$1" -e 'process.stdout.write(Buffer.alloc(8 * 1024 * 1024))' | "$2"`,
        'recipe-test',
        process.execPath,
        join(f.root, 'bin/sha256sum'),
      ],
      { env: f.env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake-recipe/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('image dry-run prints pins and never invokes privileged mutations', () => {
  const f = fixture();
  try {
    const result = f.run('build-image.sh', ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@anthropic-ai\/claude-code@2.1.302/);
    assert.match(result.stdout, /@openai\/codex@0.163.0/);
    assert.ok(result.stdout.includes(` pnpm@${repoPnpm};`));
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

test('a computer Orb gets its persistent home bind and the computer template never starts', () => {
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
    const name = 'cairn-orb-computer-abc';
    const first = f.run('prepare-machine.sh', [name], { HOME_CHANGES: '1' });
    assert.equal(first.status, 0, first.stderr);
    assert.ok(
      f
        .calls()
        .some(
          (call) =>
            call[0] === 'node' && call[1].endsWith('/computer-home.mjs') && call[2] === name,
        ),
    );
    const binds = readFileSync(join(f.root, `run/systemd/nspawn/${name}.binds`), 'utf8');
    assert.match(
      binds,
      new RegExp(`--bind=/var/lib/cairn-computer/${name}:/home/agent:idmap,norbind`),
    );
    assert.match(
      binds,
      new RegExp(`--bind=/run/cairn-orb/${name}/computer:/run/cairn-computer:idmap,norbind`),
    );
    assert.match(binds, /--bind=\/run\/cairn-orb\//);
    assert.ok(existsSync(join(f.root, `run/cairn-orb/${name}/computer`)));
    const dry = f.run('prepare-machine.sh', ['--dry-run', name]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.ok(
      f
        .calls()
        .some(
          (call) =>
            call[0] === 'node' &&
            call.includes('--dry-run') &&
            call[1].endsWith('/computer-home.mjs'),
        ),
    );
    assert.notEqual(f.run('prepare-machine.sh', ['cairn-orb-computer']).status, 0);
    assert.equal(f.run('prepare-machine.sh', ['cairn-orb-task-a']).status, 0);
    assert.doesNotMatch(
      readFileSync(join(f.root, 'run/systemd/nspawn/cairn-orb-task-a.binds'), 'utf8'),
      /cairn-computer/,
    );
    assert.ok(
      !f
        .calls()
        .some(
          (call) => call[1]?.endsWith?.('/computer-home.mjs') && call.includes('cairn-orb-task-a'),
        ),
    );
    assert.notEqual(f.run('prepare-machine.sh', ['--stop', 'cairn-orb-computer']).status, 0);
    for (const options of ['rw,nodev', 'rw,nosuid', 'rw', '']) {
      const before = f.calls().length;
      const refused = f.run('prepare-machine.sh', ['cairn-orb-computer-def'], {
        HOME_MOUNT_OPTIONS: options,
      });
      assert.notEqual(refused.status, 0, options);
      assert.match(refused.stderr, /nosuid,nodev/);
      const later = f.calls().slice(before);
      assert.ok(
        later.some(
          (call) => call[0] === 'findmnt' && call.at(-1) === `${f.root}/var/lib/cairn-computer`,
        ),
      );
      assert.ok(!later.some((call) => call[1]?.endsWith?.('/computer-home.mjs')));
    }
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
    assert.match(first.stdout, /2 changes/);
    assert.ok(
      f
        .calls()
        .some((call) => call.includes('set-property') && call.includes('MemoryAccounting=true')),
    );
    for (const flags of ['rw,nodev', 'rw,nosuid', 'rw', '']) {
      assert.notEqual(
        f.run('prepare-machine.sh', ['cairn-orb-test-a'], { RUN_MOUNT_OPTIONS: flags }).status,
        0,
      );
    }
    const second = f.run('prepare-machine.sh', ['cairn-orb-test-a']);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /0 changes/);
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

test("the Orb pnpm pin matches the repository's packageManager", () => {
  assert.equal(readFileSync(join(source, 'pnpm.version'), 'utf8'), `${repoPnpm}\n`);
});

test('image dry-run works from a checkout of only scripts/ops/orb, as cairn-ops-run materializes it', () => {
  const f = fixture();
  try {
    const orbOnly = join(f.root, 'materialized/scripts/ops/orb');
    cpSync(source, orbOnly, { recursive: true });
    const result = spawnSync('/bin/bash', [join(orbOnly, 'build-image.sh'), '--dry-run'], {
      env: f.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(` pnpm@${repoPnpm};`));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("guest image pins the repo's pnpm through npm, not corepack, and verifies it as agent", () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.doesNotMatch(script, /corepack/);
  const install = script.indexOf('npm install --global --ignore-scripts');
  const pnpmCheck = script.indexOf('runuser -u agent -- pnpm --version');
  assert.ok(install >= 0);
  assert.ok(pnpmCheck > install, 'the agent verifies pnpm after the scripted-off install');
});

test('guest image installs bubblewrap for Claude Code subprocess isolation and verifies it as agent', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.match(script, /^pacstrap -K -M "\$stage" .*\bbubblewrap\b/m);
  assert.match(script, /runuser -u agent -- \/usr\/bin\/bwrap --version/);
});

test('guest image installs the CLI tools repo scripts call and verifies each as agent', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  for (const pkg of [
    'jq',
    'diffutils',
    'patch',
    'which',
    'inetutils',
    'rsync',
    'lsof',
    'ripgrep',
    'unzip',
  ])
    assert.match(script, new RegExp(`^pacstrap -K -M "\\$stage" .*\\b${pkg}\\b`, 'm'));
  const loop = script.match(
    /^for tool in ([^;]+); do runuser -u agent -- sh -c 'command -v "\$1"' sh "\$tool"/m,
  );
  assert.ok(loop, 'the guest verifies each tool as agent in one loop');
  assert.deepEqual(loop[1].split(' ').sort(), [
    'diff',
    'hostname',
    'jq',
    'lsof',
    'patch',
    'rg',
    'rsync',
    'unzip',
    'which',
  ]);
});

test('guest image installs socat for the Claude Code sandbox and verifies it as agent', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.match(script, /^pacstrap -K -M "\$stage" .*\bsocat\b/m);
  assert.match(script, /runuser -u agent -- \/usr\/bin\/socat -V/);
});

test('guest image installs Python and verifies python3 as agent', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.match(script, /^pacstrap -K -M "\$stage" .*\bpython\b/m);
  assert.match(script, /runuser -u agent -- \/usr\/bin\/python3 --version/);
});

test('the Orb worker cannot write core dumps that could hold the subscription token', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  const worker =
    /cat > \/etc\/systemd\/system\/cairn-orb-worker.service <<WORKER\n([\s\S]+?)\nWORKER/.exec(
      script,
    )[1];
  assert.match(worker, /^LimitCORE=0$/m);
});

test('guest image gives Claude a root-pinned config dir with the weaker nested sandbox the agent cannot tamper with', () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  assert.doesNotMatch(script, /\/etc\/claude-code/);
  assert.match(
    script,
    /install -d -o root -g root -m 755 \/var\/lib\/cairn-claude\ninstall -d -o root -g agent -m 1770 \/var\/lib\/cairn-claude\/config\nprintf '%s\\n' '\{"sandbox": \{"enableWeakerNestedSandbox": true\}\}' > \/var\/lib\/cairn-claude\/config\/settings\.json\nchown root:root \/var\/lib\/cairn-claude\/config\/settings\.json\nchmod 644 \/var\/lib\/cairn-claude\/config\/settings\.json/,
  );
  for (const check of [
    /runuser -u agent -- \/usr\/bin\/node -e .*enableWeakerNestedSandbox === true.*\/var\/lib\/cairn-claude\/config\/settings\.json/,
    /runuser -u agent -- touch \/var\/lib\/cairn-claude\/config\/\.agent-write-check/,
    /! runuser -u agent -- rm -f \/var\/lib\/cairn-claude\/config\/settings\.json/,
    /! runuser -u agent -- mv \/var\/lib\/cairn-claude\/config\/settings\.json/,
    /! runuser -u agent -- sh -c 'printf x > \/var\/lib\/cairn-claude\/config\/settings\.json'/,
    /! runuser -u agent -- mv \/var\/lib\/cairn-claude\/config \/var\/lib\/cairn-claude\/moved/,
  ]) {
    assert.match(script, check);
  }
  const worker =
    /cat > \/etc\/systemd\/system\/cairn-orb-worker.service <<WORKER\n([\s\S]+?)\nWORKER/.exec(
      script,
    )[1];
  assert.match(worker, /^Environment=CLAUDE_CONFIG_DIR=\/var\/lib\/cairn-claude\/config$/m);
  const settings = script.indexOf('/var/lib/cairn-claude/config/settings.json');
  const marker = script.indexOf('> "$stage/etc/cairn-orb-image"');
  assert.ok(
    settings >= 0 && settings < marker,
    'settings are written before the completion marker',
  );
});

test("guest image runs only Claude Code's own native installer and verifies both CLIs as agent", () => {
  const script = readFileSync(join(source, 'build-image.sh'), 'utf8');
  const install = script.indexOf('npm install --global --ignore-scripts');
  const native = script.indexOf('node install.cjs');
  const claudeCheck = script.indexOf('runuser -u agent -- /usr/bin/claude --version');
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
  const gate = /^node -e '(.+)' "\$6"$/m.exec(
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
          `pnpm@${repoPnpm}`,
        ],
      ],
    );
    assert.doesNotMatch(recipe, /@xiechimon\/cairn-cli|npm install --prefix/);
    const marker = readFileSync(
      join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'),
      'utf8',
    );
    assert.match(marker, /node_major=26/);
    assert.ok(marker.includes(`\npnpm=${repoPnpm}\n`));
    assert.doesNotMatch(marker, /daemon=|daemon_package=/);
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

test('an image built before pnpm was pinned rebuilds once and converges', () => {
  const f = fixture();
  try {
    const marker = join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image');
    mkdirSync(join(marker, '..'), { recursive: true });
    writeFileSync(
      marker,
      'recipe=fake-recipe\nclaude=2.1.302\ncodex=0.163.0\nnode_major=26\nagent_uid=1000\n',
    );
    const changed = f.run('build-image.sh');
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /rebuild cairn-orb-base/);
    assert.ok(readFileSync(marker, 'utf8').includes(`\npnpm=${repoPnpm}\n`));
    assert.equal(f.run('build-image.sh').stdout.trim(), '0 changes');
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

function computerFixture() {
  const f = fixture();
  const base = join(f.root, 'var/lib/machines/cairn-orb-base/etc');
  mkdirSync(base, { recursive: true });
  writeFileSync(
    join(base, 'cairn-orb-image'),
    'recipe=r\nclaude=2.1.302\ncodex=0.163.0\npnpm=10.0.0\nnode_major=26\nagent_uid=1000',
  );
  mkdirSync(join(f.root, 'etc/pacman.d'), { recursive: true });
  writeFileSync(
    join(f.root, 'etc/pacman.d/mirrorlist'),
    'Server = https://mirror.example/$repo/os/$arch\n',
  );
  const image = join(f.root, 'var/lib/machines/cairn-orb-computer');
  const stages = () =>
    readdirSync(join(f.root, 'var/lib/machines')).filter((name) =>
      name.startsWith('.cairn-orb-computer'),
    );
  return { ...f, image, stages };
}

test('computer image dry run plans the build without touching anything', () => {
  const f = computerFixture();
  try {
    const result = f.run('build-computer-image.sh', ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /pacman -Syu xorg-server-xvfb x11vnc fluxbox xdotool chromium imagemagick/,
    );
    assert.match(result.stdout, /1 planned changes/);
    assert.equal(existsSync(f.image), false);
    assert.ok(
      !f.calls().some(([cmd]) => ['systemd-nspawn', 'mv', 'flock', 'btrfs', 'cp'].includes(cmd)),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('computer image dry run on a fresh host plans the build after the base instead of failing', () => {
  const f = computerFixture();
  try {
    rmSync(join(f.root, 'var/lib/machines/cairn-orb-base'), { recursive: true });
    const result = f.run('build-computer-image.sh', ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /after cairn-orb-base is built/);
    assert.match(result.stdout, /1 planned changes/);
    assert.ok(
      !f.calls().some(([cmd]) => ['systemd-nspawn', 'mv', 'flock', 'btrfs', 'cp'].includes(cmd)),
    );
    assert.notEqual(f.run('build-computer-image.sh').status, 0);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('computer image builds from the base with the host mirrorlist read-only and converges', () => {
  const f = computerFixture();
  try {
    const first = f.run('build-computer-image.sh');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /1 changes/);
    const nspawn = f.calls().filter(([cmd]) => cmd === 'systemd-nspawn');
    assert.ok(nspawn.length > 0);
    for (const call of nspawn) {
      assert.ok(
        call.includes(`--bind-ro=${f.root}/etc/pacman.d/mirrorlist:/etc/pacman.d/mirrorlist`),
      );
      assert.ok(call.includes('--register=no'));
    }
    assert.ok(
      nspawn.some((call) =>
        [
          'pacman',
          '-Syu',
          'xorg-server-xvfb',
          'x11vnc',
          'fluxbox',
          'xdotool',
          'chromium',
          'imagemagick',
          'wqy-microhei',
        ].every((word) => call.includes(word)),
      ),
    );
    const policy = JSON.parse(
      readFileSync(join(f.image, 'etc/chromium/policies/managed/cairn.json'), 'utf8'),
    );
    assert.equal(policy.PasswordManagerEnabled, false);
    assert.equal(policy.SyncDisabled, true);
    const unit = readFileSync(
      join(f.image, 'etc/systemd/system/cairn-computer-desktop.service'),
      'utf8',
    );
    assert.match(unit, /^User=agent$/m);
    const agent = readFileSync(
      join(f.image, 'etc/systemd/system/cairn-computer-agent.service'),
      'utf8',
    );
    assert.match(agent, /^User=agent$/m);
    assert.match(agent, /^After=.*\bnetwork-online\.target\b/m);
    assert.match(agent, /^Wants=network-online\.target$/m);
    assert.ok(
      nspawn.some(
        (call) => call.includes('enable') && call.includes('systemd-networkd-wait-online.service'),
      ),
    );
    const waitOnline = readFileSync(
      join(f.image, 'etc/systemd/system/systemd-networkd-wait-online.service.d/ipv4.conf'),
      'utf8',
    );
    assert.match(waitOnline, /^ExecStart=$/m);
    assert.match(
      waitOnline,
      /^ExecStart=\/usr\/lib\/systemd\/systemd-networkd-wait-online --ipv4 --operational-state=routable --timeout=60$/m,
    );
    assert.match(agent, /^Environment=DISPLAY=:1$/m);
    assert.match(agent, /^Environment=AGENT_BROWSER_NO_VERSION_CHECK=1$/m);
    assert.match(agent, /^Environment=AGENT_BROWSER_EXECUTABLE_PATH=\/usr\/bin\/chromium$/m);
    assert.match(agent, /^Restart=always$/m);
    assert.match(agent, /^ExecStartPre=.*-S \/run\/cairn\/computer\.sock/m);
    assert.ok(
      nspawn.some(
        (call) =>
          call.includes('npm') &&
          call.includes('install') &&
          call.some((arg) => /^agent-browser@/.test(arg)) &&
          call.includes('--ignore-scripts') &&
          !call.includes('runuser'),
      ),
    );
    const install = nspawn.findIndex((call) => call.some((arg) => /^agent-browser@/.test(arg)));
    const chmod = nspawn.findIndex(
      (call) =>
        !call.includes('runuser') &&
        call.some((arg) => /chmod 755 .*agent-browser\/bin\/agent-browser-linux-/.test(arg)),
    );
    const runs = nspawn.findIndex(
      (call) =>
        call.includes('runuser') &&
        call.includes('agent') &&
        call.includes('agent-browser') &&
        call.includes('--version'),
    );
    assert.ok(install >= 0 && chmod > install && runs > chmod, JSON.stringify(nspawn));
    assert.match(
      agent,
      /^ExecStart=\/usr\/bin\/node \/opt\/cairn\/daemon\/cli\.mjs orb-computer --socket \/run\/cairn\/computer\.sock$/m,
    );
    const systemctl = f.calls().filter((call) => call.includes('systemctl'));
    assert.ok(
      systemctl.some(
        (call) => call.includes('enable') && call.includes('cairn-computer-agent.service'),
      ),
    );
    assert.ok(
      systemctl.some(
        (call) => call.includes('disable') && call.includes('cairn-orb-worker.service'),
      ),
    );
    const desktop = readFileSync(join(f.image, 'usr/local/lib/cairn-computer/desktop.sh'), 'utf8');
    assert.match(desktop, /-unixsock \/run\/cairn-computer\/view\.sock -viewonly/);
    assert.doesNotMatch(unit, /RuntimeDirectory=cairn-computer/);
    assert.match(unit, /ExecStartPre=.*-d \/run\/cairn-computer/);
    assert.match(desktop, /-nolisten tcp/);
    assert.doesNotMatch(desktop, /-rfbport [1-9]/);
    assert.equal(existsSync(join(f.image, 'etc/cairn-orb-image')), false);
    assert.match(readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8'), /^recipe=/);
    const published = join(f.root, 'var/lib/cairn-orb/computer-image');
    assert.equal(
      readFileSync(published, 'utf8'),
      readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8'),
    );
    assert.equal(statSync(published).mode & 0o777, 0o644);
    assert.deepEqual(f.stages(), []);
    rmSync(published);
    const second = f.run('build-computer-image.sh');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout.trim(), '0 changes');
    assert.equal(
      readFileSync(published, 'utf8'),
      readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8'),
    );
    writeFileSync(
      join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'),
      'recipe=r2\nclaude=2.1.302\ncodex=0.163.0\npnpm=10.0.0\nnode_major=26\nagent_uid=1000',
    );
    const rebuilt = f.run('build-computer-image.sh');
    assert.equal(rebuilt.status, 0, rebuilt.stderr);
    assert.match(rebuilt.stdout, /rebuild cairn-orb-computer/);
    assert.deepEqual(f.stages(), []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('computer image refuses a missing base, Node drift and an unrecognized image, and keeps the previous one on failure', () => {
  const f = computerFixture();
  try {
    assert.equal(f.run('build-computer-image.sh').status, 0);
    const marker = readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8');
    writeFileSync(
      join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'),
      'recipe=r3\nclaude=2.1.302\ncodex=0.163.0\npnpm=10.0.0\nnode_major=26\nagent_uid=1000',
    );
    const drift = f.run('build-computer-image.sh', [], { GUEST_NODE_MAJOR: '27' });
    assert.notEqual(drift.status, 0);
    assert.match(drift.stderr, /Guest Node major 27 differs/);
    assert.equal(readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8'), marker);
    assert.deepEqual(f.stages(), []);
    const failed = f.run('build-computer-image.sh', [], { FAIL_COMMAND: 'systemd-nspawn' });
    assert.notEqual(failed.status, 0);
    assert.equal(readFileSync(join(f.image, 'etc/cairn-orb-computer-image'), 'utf8'), marker);
    assert.deepEqual(f.stages(), []);
    rmSync(join(f.image, 'etc/cairn-orb-computer-image'));
    const unknown = f.run('build-computer-image.sh');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unrecognized existing computer image/);
    assert.ok(existsSync(f.image));
    rmSync(join(f.root, 'var/lib/machines/cairn-orb-base/etc/cairn-orb-image'));
    const calls = f.calls().length;
    const missing = f.run('build-computer-image.sh');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Build cairn-orb-base first/);
    assert.ok(
      !f
        .calls()
        .slice(calls)
        .some(([cmd]) => cmd === 'systemd-nspawn'),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
