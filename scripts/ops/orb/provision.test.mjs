import assert from 'node:assert/strict';
import fs, {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { daemonNodeMajor } from './daemon-package.mjs';
import { installHost } from './install-host.mjs';
import { runtimeDirectory } from './runtime-directory.mjs';

function policy() {
  let rule;
  runInNewContext(readFileSync(new URL('./50-cairn-orb.rules', import.meta.url), 'utf8'), {
    polkit: {
      Result: { YES: 'yes', NO: 'no', NOT_HANDLED: 'skip' },
      addRule: (fn) => {
        rule = fn;
      },
    },
  });
  return (id, details, user = 'ian') => rule({ id, lookup: (key) => details[key] }, { user });
}

test('polkit clone checks source, destination, verb and user', () => {
  const evaluate = policy();
  const id = 'org.freedesktop.machine1.manage-images';
  const allowed = { image: 'cairn-orb-base', verb: 'clone', new_name: 'cairn-orb-task-a' };
  assert.equal(evaluate(id, allowed), 'yes');
  for (const details of [
    { ...allowed, new_name: 'not-cairn-x' },
    { ...allowed, image: 'other-image' },
    { ...allowed, new_name: undefined },
    { ...allowed, verb: 'rename', new_name: 'not-cairn-x' },
    {},
  ])
    assert.notEqual(evaluate(id, details), 'yes');
  assert.notEqual(evaluate(id, allowed, 'other'), 'yes');
});

test('polkit grants no unrelated units, names, actions or users', () => {
  const evaluate = policy();
  const unit = 'org.freedesktop.systemd1.manage-units';
  assert.equal(
    evaluate(unit, { unit: 'systemd-nspawn@cairn-orb-task-a.service', verb: 'start' }),
    'yes',
  );
  for (const name of [
    'ssh.service',
    'systemd-nspawn@other.service',
    'cairn-orb-evil.service',
    'systemd-nspawn@cairn-orb-../evil.service',
  ]) {
    assert.notEqual(evaluate(unit, { unit: name, verb: 'start' }), 'yes');
  }
  for (const verb of ['stop', 'restart', 'set-property', 'enable', undefined]) {
    assert.notEqual(
      evaluate(unit, { unit: 'systemd-nspawn@cairn-orb-task-a.service', verb }),
      'yes',
    );
  }
  assert.equal(
    evaluate('org.freedesktop.machine1.manage-machines', {
      machine: 'cairn-orb-task-a',
      verb: 'terminate',
    }),
    'yes',
  );
  for (const id of [
    'org.freedesktop.machine1.manage-machines',
    'org.freedesktop.machine1.shell',
    'org.freedesktop.machine1.unrecognized',
  ]) {
    assert.notEqual(evaluate(id, { machine: 'other' }), 'yes');
    assert.notEqual(evaluate(id, { machine: 'cairn-orb-task-a' }, 'root'), 'yes');
    assert.notEqual(evaluate(id, {}), 'yes');
  }
  assert.notEqual(
    evaluate('org.freedesktop.login1.power-off', { machine: 'cairn-orb-task-a' }),
    'yes',
  );
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-install-'));
  const state = new Set();
  const calls = [];
  const logs = [];
  const run = (cmd, args) => {
    assert.notEqual(cmd, 'systemd-run');
    assert.ok(!args.some((arg) => arg === '-M' || arg.startsWith('--machine')));
    if (cmd === 'machinectl')
      assert.ok(
        !args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg)),
      );
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (cmd === 'pacman' && args[0] === '-Q')
      return { status: state.has('package') ? 0 : 1, stdout: '' };
    if (cmd === 'pacman') state.add('package');
    const userCommand = cmd === 'runuser';
    const ctl = userCommand ? args.slice(7) : args;
    const scope = userCommand ? 'user ' : '';
    if (cmd === 'stat')
      return {
        status: state.has('directories') ? 0 : 1,
        stdout: state.has('directories')
          ? args.at(-1).endsWith('/dist') || args.at(-1).endsWith('/seed')
            ? 'directory:ian:755'
            : 'directory:root:root:755'
          : '',
      };
    if (cmd === 'systemd-tmpfiles') state.add('directories');
    if ((cmd === 'systemctl' || userCommand) && ['is-active', 'is-enabled'].includes(ctl[0]))
      return { status: state.has(scope + ctl.join(' ')) ? 0 : 1, stdout: '' };
    if ((cmd === 'systemctl' || userCommand) && ['start', 'enable'].includes(ctl[0]))
      state.add(`${scope}is-${ctl[0] === 'start' ? 'active' : 'enabled'} ${ctl[1]}`);
    if (cmd === 'networkctl' && args.includes('list'))
      return {
        status: 0,
        stdout:
          '1 lo loopback carrier unmanaged\n2 vz-cairn bridge no-carrier configured\n3 eth0 ether routable unmanaged\n',
      };
    if (cmd === 'id') return { status: 0, stdout: '1234\n' };
    if (cmd === 'bash') {
      const stdout = state.has('image') ? '0 changes\n' : '1 changes\n';
      if (!args.includes('--dry-run')) state.add('image');
      return { status: 0, stdout };
    }
    if (cmd === 'loginctl' && args[0] === 'show-user')
      return { status: 0, stdout: state.has('linger') ? 'yes\n' : 'no\n' };
    if (cmd === 'loginctl') state.add('linger');
    return { status: 0, stdout: '' };
  };
  return {
    root,
    state,
    calls,
    logs,
    run,
    nodeBinary: Buffer.from([0, 255, 254, 128]),
    log: (line) => logs.push(line),
  };
}

test('dry-run prints all privileged steps and leaves the fixture untouched', () => {
  const f = fixture();
  try {
    installHost({ ...f, dryRun: true });
    assert.deepEqual(readdirSync(f.root), []);
    assert.equal(f.state.size, 0);
    assert.ok(f.logs.some((line) => line.includes('pacman')));
    assert.ok(f.logs.some((line) => line.includes('build-image')));
    assert.ok(
      f.calls.every((line) =>
        /stat -c|runuser .*is-|node --version|nft --version|nft list table inet cairn_orb|ip -Version|nmcli --version|networkctl .*list|pacman -Q|systemctl .*is-|systemctl is-|loginctl show-user|id -u|bash .*build-image.sh --dry-run/.test(
          line,
        ),
      ),
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('stateful install converges, preserves file modes and prints zero changes', () => {
  const f = fixture();
  try {
    installHost(f);
    assert.ok(f.logs.length > 5);
    assert.equal(
      statSync(join(f.root, 'etc/polkit-1/rules.d/50-cairn-orb.rules')).mode & 0o777,
      0o644,
    );
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('failed changes do not become completed installs', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        installHost({
          ...f,
          run: (cmd, args) => (cmd === 'pacman' ? { status: 1, stdout: '' } : f.run(cmd, args)),
        }),
      /pacman/,
    );
    installHost(f);
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('privileged bind and copy cannot expose host files', () => {
  const evaluate = policy();
  for (const verb of ['bind', 'copy']) {
    for (const src of ['/home', '/home/ian', '/run/user', '/var/run/docker.sock', '/etc/shadow']) {
      assert.equal(
        evaluate('org.freedesktop.machine1.manage-machines', {
          machine: 'cairn-orb-task-a',
          verb,
          src,
          dest: '/stolen',
        }),
        'no',
      );
    }
  }
});

test('failed reload is retried even when all files already match', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        installHost({
          ...f,
          run: (cmd, args) => (cmd === 'nmcli' ? { status: 1, stdout: '' } : f.run(cmd, args)),
        }),
      /nmcli/,
    );
    f.calls.length = 0;
    installHost(f);
    assert.ok(f.calls.includes('nmcli general reload conf'));
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('network configuration isolates physical links and allows proxy-only guest routing', () => {
  const f = fixture();
  try {
    installHost(f);
    const unmanaged = readFileSync(
      join(f.root, 'etc/systemd/network/00-cairn-unmanaged.network'),
      'utf8',
    );
    assert.match(unmanaged, /Name=!ve-\* vz-\*/);
    const bridge = readFileSync(join(f.root, 'etc/systemd/network/10-cairn.network'), 'utf8');
    assert.match(bridge, /ConfigureWithoutCarrier=yes/);
    for (const property of [
      'IPMasquerade=no',
      'IPv4Forwarding=no',
      'IPv6Forwarding=no',
      'EmitRouter=no',
      'EmitDNS=no',
    ])
      assert.ok(bridge.includes(property));
    const manager = readFileSync(
      join(f.root, 'etc/NetworkManager/conf.d/90-cairn-orb.conf'),
      'utf8',
    );
    assert.match(manager, /interface-name:ve-\*;interface-name:vz-\*;interface-name:vb-\*/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('polkit cannot mutate, start or substitute the base image', () => {
  const evaluate = policy();
  for (const verb of ['rename', 'remove']) {
    assert.equal(
      evaluate('org.freedesktop.machine1.manage-images', {
        image: 'cairn-orb-base',
        verb,
        new_name: 'cairn-orb-poison',
      }),
      'no',
    );
  }
  for (const verb of ['clone', 'rename']) {
    assert.equal(
      evaluate('org.freedesktop.machine1.manage-images', {
        image: 'cairn-orb-task-a',
        verb,
        new_name: 'cairn-orb-base',
      }),
      'no',
    );
  }
  assert.equal(
    evaluate('org.freedesktop.systemd1.manage-units', {
      unit: 'systemd-nspawn@cairn-orb-base.service',
      verb: 'start',
    }),
    'no',
  );
  assert.equal(evaluate('org.freedesktop.machine1.shell', { machine: 'cairn-orb-base' }), 'no');
  assert.equal(
    evaluate('org.freedesktop.machine1.manage-machines', {
      machine: 'cairn-orb-task-a',
      verb: 'unknown-operation',
    }),
    'no',
  );
});

test('missing host relay tooling fails before installing files', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        installHost({
          ...f,
          run: (cmd, args) => (cmd === 'nft' ? { status: 1 } : f.run(cmd, args)),
        }),
      /nft/,
    );
    assert.deepEqual(readdirSync(f.root), []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('NetworkManager exclusions append to existing host policy', () => {
  const f = fixture();
  try {
    installHost(f);
    assert.match(
      readFileSync(join(f.root, 'etc/NetworkManager/conf.d/90-cairn-orb.conf'), 'utf8'),
      /^unmanaged-devices\+=/m,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('preflight preserves an uplink already managed by networkd', () => {
  const f = fixture();
  f.state.add('is-active systemd-networkd.service');
  try {
    assert.throws(
      () =>
        installHost({
          ...f,
          run: (cmd, args) =>
            cmd === 'networkctl' && args.includes('list')
              ? { status: 0, stdout: '2 eth0 ether routable configured\n' }
              : f.run(cmd, args),
        }),
      /networkd.*eth0/i,
    );
    assert.deepEqual(readdirSync(f.root), []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('unrelated admin actions retain the existing authentication policy', () => {
  const evaluate = policy();
  assert.equal(
    evaluate('org.freedesktop.systemd1.manage-units', { unit: 'sshd.service', verb: 'start' }),
    'skip',
  );
  assert.equal(
    evaluate('org.freedesktop.machine1.manage-machines', {
      machine: 'unrelated',
      verb: 'terminate',
    }),
    'skip',
  );
  assert.equal(
    evaluate('org.freedesktop.machine1.manage-images', { image: 'unrelated', verb: 'remove' }),
    'skip',
  );
  assert.equal(
    evaluate('org.freedesktop.machine1.manage-images', {
      image: 'cairn-orb-base',
      verb: 'clone',
      new_name: 'not-cairn-x',
    }),
    'no',
  );
});

test('relay children and user-unit tasks are bounded', () => {
  assert.match(
    readFileSync(new URL('./egress-relay.mjs', import.meta.url), 'utf8'),
    /maxConnections: 128/,
  );
  assert.match(
    readFileSync(new URL('./egress-relay.service', import.meta.url), 'utf8'),
    /^TasksMax=256$/m,
  );
});

test('inactive networkd cannot activate an earlier host network configuration', () => {
  const f = fixture();
  const earlier = join(f.root, 'etc/systemd/network/00-bond.network');
  try {
    mkdirSync(join(earlier, '..'), { recursive: true });
    writeFileSync(earlier, '[Match]\nName=eth0\n');
    assert.throws(() => installHost(f), /earlier networkd configuration/i);
    assert.equal(readFileSync(earlier, 'utf8'), '[Match]\nName=eth0\n');
    assert.deepEqual(readdirSync(join(f.root, 'etc/systemd/network')), ['00-bond.network']);
    assert.ok(!f.calls.some((line) => line.startsWith('pacman -S')));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('polkit denies root-directory access and dead power verbs while retaining scoped lifecycle', () => {
  const evaluate = policy();
  for (const verb of ['open_root_directory', 'poweroff', 'reboot', 'unregister']) {
    assert.equal(
      evaluate('org.freedesktop.machine1.manage-machines', { machine: 'cairn-orb-task-a', verb }),
      'no',
    );
  }
  for (const verb of ['kill', 'terminate']) {
    assert.equal(
      evaluate('org.freedesktop.machine1.manage-machines', { machine: 'cairn-orb-task-a', verb }),
      'yes',
    );
  }
});

test('host changes print both stdout and stderr including successful enable output', () => {
  const f = fixture();
  try {
    installHost({
      ...f,
      run: (cmd, args) => ({
        ...f.run(cmd, args),
        ...(cmd === 'systemctl' && args.includes('enable')
          ? { stdout: 'enabled stdout', stderr: 'Created symlink stderr' }
          : {}),
      }),
    });
    assert.ok(f.logs.includes('enabled stdout'));
    assert.ok(f.logs.includes('Created symlink stderr'));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('firewall owns only cairn_orb, persists before networkd and converges on rerun', () => {
  const f = fixture();
  try {
    installHost(f);
    const rules = readFileSync(join(f.root, 'etc/cairn-orb/firewall.nft'), 'utf8');
    assert.match(rules, /table inet cairn_orb/);
    assert.match(rules, /flush table inet cairn_orb/);
    assert.doesNotMatch(rules, /flush ruleset|delete table/);
    assert.match(
      rules,
      /iifname "vz-cairn" ip saddr 10\.203\.0\.0\/24 ip daddr 10\.203\.0\.1 tcp dport 7890 accept/,
    );
    assert.match(rules, /iifname "vz-cairn" udp sport 68 udp dport 67 accept/);
    assert.match(rules, /iifname "vz-cairn" drop/g);
    assert.equal((rules.match(/iifname "vz-cairn" drop/g) || []).length, 2);
    const unit = readFileSync(
      join(f.root, 'etc/systemd/system/cairn-orb-firewall.service'),
      'utf8',
    );
    assert.match(unit, /Before=systemd-networkd.service/);
    assert.match(unit, /ExecStart=\/usr\/bin\/nft -f \/etc\/cairn-orb\/firewall.nft/);
    assert.ok(f.logs.includes(rules.trim()));
    assert.ok(
      f.calls.indexOf('systemctl start cairn-orb-firewall.service') <
        f.calls.indexOf('systemctl start systemd-networkd.service'),
    );
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('installer counts and prints a rebuilt image then converges to zero changes', () => {
  const f = fixture();
  try {
    installHost(f);
    f.logs.length = 0;
    installHost({
      ...f,
      run: (cmd, args) =>
        cmd === 'bash'
          ? {
              status: 0,
              stdout: 'rebuild cairn-orb-base: pinned CLI versions changed\n1 changes\n',
            }
          : f.run(cmd, args),
    });
    assert.ok(f.logs.some((line) => line.includes('rebuild cairn-orb-base')));
    assert.equal(f.logs.at(-1), '1 changes');
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('firewall activates before reloading an already active networkd', () => {
  const f = fixture();
  f.state.add('is-active systemd-networkd.service');
  try {
    installHost(f);
    assert.ok(
      f.calls.indexOf('systemctl start cairn-orb-firewall.service') <
        f.calls.indexOf('networkctl reload'),
    );
    for (const unit of ['systemd-networkd.service', 'systemd-nspawn@.service']) {
      const dropin = readFileSync(
        join(f.root, `etc/systemd/system/${unit}.d/20-cairn-orb.conf`),
        'utf8',
      );
      assert.match(dropin, /Requires=cairn-orb-firewall.service/);
      assert.match(dropin, /After=cairn-orb-firewall.service/);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a lost firewall table is reapplied and a failed apply never starts networking', () => {
  const f = fixture();
  try {
    installHost(f);
    f.logs.length = 0;
    installHost({
      ...f,
      run: (cmd, args) =>
        cmd === 'nft' && args[0] === 'list'
          ? { status: 1, stderr: 'No such table' }
          : f.run(cmd, args),
    });
    assert.ok(f.logs.includes('systemctl reload cairn-orb-firewall.service'));
    assert.notEqual(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
  const failed = fixture();
  try {
    assert.throws(
      () =>
        installHost({
          ...failed,
          run: (cmd, args) =>
            cmd === 'systemctl' && args[0] === 'start' && args[1] === 'cairn-orb-firewall.service'
              ? { status: 1, stderr: 'fixture nft failure' }
              : failed.run(cmd, args),
        }),
      /nft failure/,
    );
    assert.ok(!failed.calls.includes('systemctl start systemd-networkd.service'));
    assert.ok(!failed.calls.some((call) => call.endsWith('start egress-relay.service')));
  } finally {
    rmSync(failed.root, { recursive: true, force: true });
  }
});

test('relay runtime remains executable with ProtectHome and binary installs converge', () => {
  const f = fixture();
  try {
    installHost(f);
    const runtime = join(f.root, 'usr/local/lib/cairn-orb/node');
    assert.deepEqual(readFileSync(runtime), f.nodeBinary);
    assert.equal(statSync(runtime).mode & 0o777, 0o755);
    const unit = readFileSync(join(f.root, 'etc/systemd/user/egress-relay.service'), 'utf8');
    assert.match(unit, /ProtectHome=yes/);
    assert.match(unit, /Environment=CAIRN_ORB_NODE=\/usr\/local\/lib\/cairn-orb\/node/);
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('polkit denies guest execution while keeping only required lifecycle grants', () => {
  const evaluate = policy();
  for (const action of ['shell', 'login', 'open-pty', 'inspect-machines']) {
    assert.equal(
      evaluate(`org.freedesktop.machine1.${action}`, { machine: 'cairn-orb-task-a' }),
      'no',
    );
  }
});

test('installer provisions root-owned bind parents and owner content directories', () => {
  const f = fixture();
  try {
    installHost(f);
    const config = readFileSync(join(f.root, 'etc/tmpfiles.d/cairn-orb.conf'), 'utf8');
    for (const path of ['/run/cairn-orb', '/var/lib/cairn-orb'])
      assert.ok(config.includes(`d ${path} 0755 root root -`));
    for (const path of ['/var/lib/cairn-orb/dist', '/var/lib/cairn-orb/seed'])
      assert.ok(config.includes(`d ${path} 0755 ian - -`));
    assert.equal(
      readFileSync(join(f.root, 'usr/local/lib/cairn-orb/runtime-directory.mjs'), 'utf8'),
      readFileSync(new URL('./runtime-directory.mjs', import.meta.url), 'utf8'),
    );
    assert.ok(f.calls.some((call) => call.startsWith('systemd-tmpfiles --create')));
    assert.ok(!f.calls.some((call) => call.includes('--machine')));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('template launches fixed specifier binds and never exposes the runtime parent', () => {
  const f = fixture();
  try {
    installHost(f);
    const template = readFileSync(
      join(f.root, 'etc/systemd/system/systemd-nspawn@.service.d/20-cairn-orb.conf'),
      'utf8',
    );
    assert.match(template, /--bind=\/run\/cairn-orb\/%i:\/run\/cairn:idmap,norbind/);
    assert.match(
      template,
      /--bind-ro=\/var\/lib\/cairn-orb\/dist:\/opt\/cairn\/daemon:idmap,norbind/,
    );
    assert.match(template, /--bind-ro=\/var\/lib\/cairn-orb\/seed:\/seed:idmap,norbind/);
    assert.doesNotMatch(template, /--bind=\/run\/cairn-orb:/);
    assert.match(
      template,
      /ExecStopPost=\+\/usr\/local\/lib\/cairn-orb\/prepare-machine.sh --stop %i/,
    );
    assert.match(template, /EnvironmentFile=-\/run\/systemd\/nspawn\/%i.binds/);
    assert.match(template, /ExecStart=systemd-nspawn .*--machine=%i \$CAIRN_ORB_BINDS/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('installer refuses symlinked bind paths before tmpfiles or image mutations', () => {
  for (const path of [
    '/run/cairn-orb',
    '/var/lib/cairn-orb',
    '/var/lib/cairn-orb/dist',
    '/var/lib/cairn-orb/seed',
  ]) {
    const f = fixture();
    try {
      assert.throws(
        () =>
          installHost({
            ...f,
            run: (cmd, args) =>
              cmd === 'stat' && args.at(-1) === join(f.root, path)
                ? { status: 0, stdout: 'symbolic link:ian:755' }
                : f.run(cmd, args),
          }),
        /directory/i,
      );
      assert.ok(!f.calls.some((call) => call.startsWith('systemd-tmpfiles')));
      assert.ok(!f.calls.some((call) => call.startsWith('bash ')));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  }
});

function runtimeFixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'cairn-orb-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const parent = join(root, 'run/cairn-orb');
  const state = join(root, 'run/systemd/nspawn');
  fs.mkdirSync(parent, { recursive: true, mode: 0o755 });
  fs.mkdirSync(state, { recursive: true, mode: 0o755 });
  const name = 'cairn-orb-test-a';
  const directory = join(parent, name);
  const calls = [];
  const descriptors = new Map();
  let mounted = false;
  const io = {
    ...fs,
    lstatSync(path, ...args) {
      const stat = fs.lstatSync(path, ...args);
      if (path === parent || path === state) return Object.assign(stat, { uid: 0, gid: 0 });
      if (path === directory && mounted)
        return Object.assign(stat, { dev: stat.dev + 1, ino: stat.ino + 1 });
      return stat;
    },
    fstatSync(fd) {
      const stat = fs.fstatSync(fd);
      return descriptors.get(fd)
        ? Object.assign(stat, { dev: stat.dev + 1, ino: stat.ino + 1 })
        : stat;
    },
    openSync(path, flags, ...args) {
      const fd = fs.openSync(path, flags, ...args);
      calls.push(['open', path, flags, fd]);
      descriptors.set(fd, mounted);
      return fd;
    },
    fchownSync(fd, uid, gid) {
      calls.push(['fchown', fd, uid, gid]);
      fs.fchownSync(fd, uid, gid);
    },
    fchmodSync(fd, mode) {
      calls.push(['fchmod', fd, mode]);
      fs.fchmodSync(fd, mode);
    },
  };
  const run = (cmd, args, options) => {
    calls.push([cmd, args, options]);
    if (cmd === '/usr/bin/mount') {
      mounted = true;
      return { status: 0 };
    }
    if (cmd === '/usr/bin/umount') {
      mounted = false;
      return { status: 0 };
    }
    assert.equal(cmd, '/usr/bin/rm');
    assert.deepEqual(args, ['--recursive', '--force', '--one-file-system', '--', directory]);
    fs.rmSync(directory, { recursive: true });
    return { status: 0 };
  };
  const options = { root, name, uid: process.getuid(), gid: process.getgid(), io, run };
  return { options, parent, state, directory, calls, run };
}

test('root preparation creates and opens a private directory before fd ownership changes', (t) => {
  const f = runtimeFixture(t);
  assert.equal(runtimeDirectory(f.options), 1);
  const stat = fs.lstatSync(f.directory);
  assert.ok(stat.isDirectory());
  assert.equal(stat.uid, f.options.uid);
  assert.equal(stat.gid, f.options.gid);
  assert.equal(stat.mode & 0o777, 0o700);
  const opened = f.calls.find(([op, path]) => op === 'open' && path === f.directory);
  assert.equal(
    opened[2],
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  assert.deepEqual(
    f.calls.filter(([op]) => op.startsWith('f')),
    [
      ['fchown', opened[3], f.options.uid, f.options.gid],
      ['fchmod', opened[3], 0o700],
    ],
  );
  assert.equal(runtimeDirectory(f.options), 0);
  fs.writeFileSync(join(f.directory, 'relay.sock'), 'relay');
  const outside = join(f.parent, 'keep');
  fs.writeFileSync(outside, 'host data');
  fs.symlinkSync(outside, join(f.directory, 'link'));
  assert.equal(runtimeDirectory({ ...f.options, stop: true }), 1);
  assert.equal(fs.existsSync(f.directory), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'host data');
  assert.equal(runtimeDirectory({ ...f.options, stop: true }), 0);
  assert.equal(runtimeDirectory(f.options), 1);
});

for (const kind of ['symlink', 'file', 'directory']) {
  test(`preparation and stop refuse a pre-planted ${kind}`, (t) => {
    const f = runtimeFixture(t);
    const victim = join(f.parent, 'victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(join(victim, 'keep'), 'host data');
    if (kind === 'symlink') fs.symlinkSync(victim, f.directory);
    if (kind === 'file') fs.writeFileSync(f.directory, 'untrusted');
    if (kind === 'directory') fs.mkdirSync(f.directory);
    for (const stop of [false, true])
      assert.throws(() => runtimeDirectory({ ...f.options, stop }), /unrecognized runtime/i);
    assert.equal(fs.readFileSync(join(victim, 'keep'), 'utf8'), 'host data');
    assert.equal(f.calls.length, 0);
  });
}

test('stop refuses a replacement symlink even with a preparation record', (t) => {
  const f = runtimeFixture(t);
  runtimeDirectory(f.options);
  fs.renameSync(f.directory, `${f.directory}.original`);
  const victim = join(f.parent, 'victim');
  fs.mkdirSync(victim);
  fs.writeFileSync(join(victim, 'keep'), 'host data');
  fs.symlinkSync(victim, f.directory);
  assert.throws(() => runtimeDirectory({ ...f.options, stop: true }), /unrecognized runtime/i);
  assert.equal(fs.readFileSync(join(victim, 'keep'), 'utf8'), 'host data');
});

test('dry-run plans creation and removal without touching the filesystem', (t) => {
  const f = runtimeFixture(t);
  assert.equal(runtimeDirectory({ ...f.options, dryRun: true }), 1);
  assert.equal(fs.existsSync(f.directory), false);
  assert.deepEqual(fs.readdirSync(f.state), []);
  runtimeDirectory(f.options);
  assert.equal(runtimeDirectory({ ...f.options, dryRun: true, stop: true }), 1);
  assert.ok(fs.existsSync(f.directory));
});

test('unsafe parents, invalid machines and unmappable owners fail before creation', (t) => {
  const f = runtimeFixture(t);
  for (const parent of [f.parent, f.state]) {
    fs.chmodSync(parent, 0o777);
    assert.throws(() => runtimeDirectory(f.options), /root-owned parent/i);
    fs.chmodSync(parent, 0o755);
  }
  for (const uid of [0, 65534, -1, NaN])
    assert.throws(() => runtimeDirectory({ ...f.options, uid }), /owner/i);
  for (const name of ['cairn-orb-base', 'cairn-orb-../../evil', 'unrelated'])
    assert.throws(() => runtimeDirectory({ ...f.options, name }), /machine/i);
  assert.equal(fs.existsSync(f.directory), false);
});

test('a symlink appearing before open cannot receive ownership or mode changes', (t) => {
  const f = runtimeFixture(t);
  const victim = join(f.parent, 'victim');
  fs.mkdirSync(victim, { mode: 0o755 });
  const io = {
    ...f.options.io,
    openSync(path, flags) {
      if (path === f.directory) {
        fs.renameSync(path, `${path}.original`);
        fs.symlinkSync(victim, path);
      }
      return f.options.io.openSync(path, flags);
    },
  };
  assert.throws(() => runtimeDirectory({ ...f.options, io }), /ELOOP|ENOTDIR/);
  assert.equal(fs.statSync(victim).mode & 0o777, 0o755);
  assert.ok(!f.calls.some(([op]) => op === 'fchown' || op === 'fchmod'));
});

test('failed fd ownership changes close the fd and never certify the directory', (t) => {
  const f = runtimeFixture(t);
  let closed = false;
  const io = {
    ...f.options.io,
    fchownSync() {
      throw new Error('ownership failed');
    },
    closeSync(fd) {
      closed = true;
      fs.closeSync(fd);
    },
  };
  assert.throws(() => runtimeDirectory({ ...f.options, io }), /ownership failed/);
  assert.equal(closed, true);
  assert.deepEqual(fs.readdirSync(f.state), []);
  assert.throws(() => runtimeDirectory(f.options), /unrecognized runtime/i);
});

test('failed stop cleanup preserves the root identity record for retry', (t) => {
  const f = runtimeFixture(t);
  runtimeDirectory(f.options);
  assert.throws(
    () => runtimeDirectory({ ...f.options, stop: true, run: () => ({ status: 1 }) }),
    /unmount/,
  );
  assert.ok(fs.existsSync(f.directory));
  assert.equal(fs.readdirSync(f.state).length, 1);
  assert.equal(runtimeDirectory({ ...f.options, stop: true }), 1);
});

test('first-start dry-run does not require or create the systemd runtime state directory', (t) => {
  const f = runtimeFixture(t);
  fs.rmdirSync(f.state);
  assert.equal(runtimeDirectory({ ...f.options, dryRun: true }), 1);
  assert.equal(fs.existsSync(f.state), false);
  assert.equal(fs.existsSync(f.directory), false);
});

test('runtime tmpfs is bounded, hardened and mounted through the no-follow fd', (t) => {
  const f = runtimeFixture(t);
  runtimeDirectory(f.options);
  const mount = f.calls.find(([op]) => op === '/usr/bin/mount');
  assert.ok(mount);
  assert.deepEqual(mount[1], [
    '--no-canonicalize',
    '-t',
    'tmpfs',
    '-o',
    `size=64M,nr_inodes=4096,mode=0700,uid=${f.options.uid},gid=${f.options.gid},nosuid,nodev,noexec`,
    'cairn-orb',
    '/proc/self/fd/3',
  ]);
  const opened = f.calls.find(([op]) => op === 'open');
  assert.equal(mount[2].stdio[3], opened[3]);
  assert.equal(mount[2].encoding, 'utf8');
  assert.equal(runtimeDirectory(f.options), 0);
  assert.equal(f.calls.filter(([op]) => op === '/usr/bin/mount').length, 1);
});

test('stop unmounts before removal and retries a busy mount lazily using its fd', (t) => {
  const f = runtimeFixture(t);
  runtimeDirectory(f.options);
  f.calls.length = 0;
  const run = (cmd, args, options) => {
    if (cmd === '/usr/bin/umount' && !args.includes('--lazy')) {
      f.calls.push([cmd, args, options]);
      return { status: 1 };
    }
    return f.run(cmd, args, options);
  };
  assert.equal(runtimeDirectory({ ...f.options, stop: true, run }), 1);
  const commands = f.calls.filter(([op]) => op.startsWith('/usr/bin/'));
  assert.deepEqual(
    commands.map(([op, args]) => [op, args]),
    [
      ['/usr/bin/umount', ['--no-canonicalize', '--', '/proc/self/fd/3']],
      ['/usr/bin/umount', ['--no-canonicalize', '--lazy', '--', '/proc/self/fd/3']],
      ['/usr/bin/rm', ['--recursive', '--force', '--one-file-system', '--', f.directory]],
    ],
  );
  assert.ok(commands.slice(0, 2).every(([, , options]) => Number.isInteger(options.stdio[3])));
  assert.equal(fs.existsSync(f.directory), false);
  assert.deepEqual(fs.readdirSync(f.state), []);
});

test('failed tmpfs mount cannot certify an unbounded runtime directory', (t) => {
  const f = runtimeFixture(t);
  assert.throws(() => runtimeDirectory({ ...f.options, run: () => ({ status: 1 }) }), /mount/i);
  assert.deepEqual(fs.readdirSync(f.state), []);
  assert.ok(!f.calls.some(([op]) => op === 'fchown'));
});

test('failed removal after unmount can retry without unmounting the host filesystem', (t) => {
  const f = runtimeFixture(t);
  runtimeDirectory(f.options);
  assert.throws(
    () =>
      runtimeDirectory({
        ...f.options,
        stop: true,
        run: (cmd, args, options) =>
          cmd === '/usr/bin/rm' ? { status: 1 } : f.run(cmd, args, options),
      }),
    /remove/,
  );
  f.calls.length = 0;
  assert.equal(runtimeDirectory({ ...f.options, stop: true }), 1);
  assert.ok(!f.calls.some(([op]) => op === '/usr/bin/umount'));
});

test('daemon Node major comes from the service ExecStart binary, not the login Node', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemctl')
      return {
        status: 0,
        stdout:
          '{ path=/home/ian/.local/share/mise/installs/node/26.1.0/bin/node ; argv[]=/home/ian/.local/share/mise/installs/node/26.1.0/bin/node dist/cli.mjs start -f ; }',
      };
    assert.equal(cmd, '/home/ian/.local/share/mise/installs/node/26.1.0/bin/node');
    assert.deepEqual(args, ['--version']);
    return { status: 0, stdout: 'v26.1.0\n' };
  };
  assert.equal(daemonNodeMajor({ run }), 26);
  assert.deepEqual(calls[0], [
    'systemctl',
    '--user',
    'show',
    'cairn-daemon.service',
    '-p',
    'ExecStart',
    '--value',
  ]);
});

test('explicit daemon Node major avoids service access and invalid majors fail closed', () => {
  const run = () => assert.fail('unexpected discovery');
  assert.equal(daemonNodeMajor({ major: '26', run }), 26);
  for (const major of ['0', '20', '026', '26.1', 'v26', 'latest', '26;echo bad'])
    assert.throws(() => daemonNodeMajor({ major, run }), /CAIRN_ORB_NODE_MAJOR/);
});

test('missing service, invalid ExecStart and failed Node probes require an explicit major', () => {
  for (const result of [
    { status: 1 },
    { status: 0, stdout: '' },
    { status: 0, stdout: '{ path=relative/node ; }' },
  ])
    assert.throws(() => daemonNodeMajor({ run: () => result }), /CAIRN_ORB_NODE_MAJOR/);
  for (const result of [
    { status: 1 },
    { status: 0, stdout: 'v20.19.0' },
    { status: 0, stdout: 'not-node' },
  ])
    assert.throws(
      () =>
        daemonNodeMajor({
          run: (cmd) =>
            cmd === 'systemctl' ? { status: 0, stdout: '{ path=/mise/node ; }' } : result,
        }),
      /CAIRN_ORB_NODE_MAJOR/,
    );
});

test('installer leaves release publication to the owner daemon', () => {
  const f = fixture();
  try {
    const dist = join(f.root, 'var/lib/cairn-orb/dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'current.json'), 'owner release');
    fs.symlinkSync('current/dist/cli.mjs', join(dist, 'cli.mjs'));
    installHost(f);
    assert.equal(
      readFileSync(join(f.root, 'var/lib/cairn-orb/dist/current.json'), 'utf8'),
      'owner release',
    );
    assert.equal(
      fs.readlinkSync(join(f.root, 'var/lib/cairn-orb/dist/cli.mjs')),
      'current/dist/cli.mjs',
    );
    assert.ok(!f.calls.some((call) => /deploy|npm install|chown.*releases/.test(call)));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a failed image build after host changes resumes, builds the image, then converges to zero changes', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        installHost({
          ...f,
          run: (cmd, args) =>
            cmd === 'bash' && !args.includes('--dry-run')
              ? { status: 1, stdout: '', stderr: 'Error: claude native binary not installed.' }
              : f.run(cmd, args),
        }),
      /build-image failed/,
    );
    assert.ok(!f.state.has('image'));
    assert.equal(
      readFileSync(join(f.root, 'var/lib/cairn-orb/install-pending'), 'utf8'),
      'pending\n',
    );
    f.logs.length = 0;
    installHost(f);
    assert.ok(f.state.has('image'));
    assert.notEqual(f.logs.at(-1), '0 changes');
    assert.equal(
      readFileSync(join(f.root, 'var/lib/cairn-orb/install-pending'), 'utf8'),
      'complete\n',
    );
    f.logs.length = 0;
    installHost(f);
    assert.equal(f.logs.at(-1), '0 changes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
