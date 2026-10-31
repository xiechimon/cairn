import assert from 'node:assert/strict';
import {
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
import { installHost } from './install-host.mjs';

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
  for (const verb of ['set-property', 'enable', undefined]) {
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
    const key = [cmd, ...args].join(' ');
    calls.push(key);
    if (cmd === 'pacman' && args[0] === '-Q')
      return { status: state.has('package') ? 0 : 1, stdout: '' };
    if (cmd === 'pacman') state.add('package');
    const ctl = args[0] === '--user' ? args.slice(2) : args;
    const scope = args[0] === '--user' ? 'user ' : '';
    if (cmd === 'systemctl' && ['is-active', 'is-enabled'].includes(ctl[0]))
      return { status: state.has(scope + ctl.join(' ')) ? 0 : 1, stdout: '' };
    if (cmd === 'systemctl' && ['start', 'enable'].includes(ctl[0]))
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
        /node --version|nft --version|nft list table inet cairn_orb|ip -Version|nmcli --version|networkctl .*list|pacman -Q|systemctl .*is-|systemctl is-|loginctl show-user|id -u|bash .*build-image.sh --dry-run/.test(
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
  for (const verb of ['open_root_directory', 'poweroff', 'reboot']) {
    assert.equal(
      evaluate('org.freedesktop.machine1.manage-machines', { machine: 'cairn-orb-task-a', verb }),
      'no',
    );
  }
  for (const verb of ['kill', 'terminate', 'unregister']) {
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
