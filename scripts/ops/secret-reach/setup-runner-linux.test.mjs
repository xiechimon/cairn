import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

for (const backend of ['nft', 'iptables'])
  test(`setup ${backend} removes an existing privileged primary group and preserves quarantine on rerun`, (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'runner-fixture-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const owner = join(root, 'owner');
    const runner = join(root, 'runner');
    const server = join(root, 'server');
    for (const path of [owner, runner, server, join(owner, '.cairn/server.hdd-old')])
      mkdirSync(path, { recursive: true });
    writeFileSync(join(server, 'server.db'), 'transcript fixture');
    writeFileSync(join(owner, '.cairn/server.hdd-old/secretbox.key'), 'stale fixture');
    const statePath = join(root, 'state.json');
    writeFileSync(
      statePath,
      JSON.stringify({ primary: 'docker', groups: ['sudo', 'wheel'], knownGroups: [] }),
    );
    const stub = `#!${process.execPath}
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { basename } from 'node:path';
const state = JSON.parse(readFileSync(process.env.FIXTURE_STATE));
const args = process.argv.slice(2);
const command = basename(process.argv[1]);
if (command === 'uname') console.log('Linux');
if (command === 'id') console.log(args[0] === '-u' ? (args[1] === 'ian' ? '1000' : args[1] === 'cairn-runner' ? '2000' : '0') : args[0] === '-gn' ? 'owner-group' : 'fixture identity');
if (command === 'tailscale' && process.env.EMPTY_ADDRESSES) process.exit(0);
if (command === 'tailscale' && process.env.FAIL_ADDRESSES) process.exit(1);
if (command === 'tailscale') console.log('100.64.0.7');
if (command === 'tailscale') console.log('fd7a:115c:a1e0::7');
if (command === 'chown') (state.chowns ??= []).push(args);
if (command === 'nft' && process.env.FIXTURE_BACKEND === 'iptables') process.exit(1);
if (command === 'nft' && args.includes('-f')) (state.rules ??= []).push(readFileSync(0, 'utf8'));
if (['nft', 'iptables', 'ip6tables'].includes(command)) (state.firewall ??= []).push([command, ...args]);
if (process.env.CHECK_RULES && command === 'tailscale' && process.env.CHANGE_ADDRESS) { console.log('100.64.0.8'); process.exit(0); }
if (process.env.CHECK_RULES && command === 'nft') {
  const lines = state.rules.at(-1).split('\\n').filter(line => line.startsWith('add rule')).map(line => line.replace('add rule inet cairn_runner output ', ''));
  lines.unshift('type filter hook output priority -10; policy accept;');
  console.log(lines.filter((_, index) => String(index) !== process.env.MISSING_RULE).join('\\n'));
  process.exit(0);
}
if (process.env.CHECK_RULES && ['iptables', 'ip6tables'].includes(command)) {
  const key = [command, ...args].join(' ');
  if (key === process.env.MISSING_RULE) process.exit(1);
  process.exit(0);
}
if (command === 'getent') process.exit(state.knownGroups.includes(args[1]) ? 0 : 2);
if (command === 'groupadd') state.knownGroups.push(args.at(-1));
if (command === 'usermod' && args.at(-1) === 'cairn-runner') {
  if (args.includes('-g')) state.primary = args[args.indexOf('-g') + 1];
  if (args.includes('-G')) state.groups = args[args.indexOf('-G') + 1].split(',');
}
if (command === 'install') {
  mkdirSync(args.at(-1), { recursive: true });
  chmodSync(args.at(-1), Number.parseInt(args[args.indexOf('-m') + 1], 8));
}
writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state));
`;
    for (const command of [
      'tailscale',
      'uname',
      'id',
      'getent',
      'groupadd',
      'useradd',
      'usermod',
      'passwd',
      'chown',
      'install',
      'nft',
      'iptables',
      'ip6tables',
      'systemctl',
    ]) {
      const path = join(bin, command);
      writeFileSync(path, stub);
      chmodSync(path, 0o755);
    }
    const source = readFileSync(join(import.meta.dirname, 'setup-runner-linux.sh'), 'utf8')
      .replaceAll('/etc/cairn-runner-firewall', join(root, 'firewall'))
      .replaceAll(
        '/etc/systemd/system/cairn-runner-firewall.service',
        join(root, 'firewall.service'),
      )
      .replaceAll('/etc/systemd/system', root)
      .replaceAll('/home/cairn-runner', runner)
      .replaceAll('/home/ian', owner)
      .replaceAll('/mnt/fast/cairn/server', server);
    const script = join(root, 'setup.sh');
    writeFileSync(script, source);
    const run = (extra = {}) =>
      spawnSync('bash', [script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_STATE: statePath,
          FIXTURE_BACKEND: backend,
          ...extra,
        },
      });
    for (const extra of [{ EMPTY_ADDRESSES: '1' }, { FAIL_ADDRESSES: '1' }]) {
      assert.notEqual(run(extra).status, 0);
      assert.deepEqual(JSON.parse(readFileSync(statePath)).knownGroups, []);
    }
    const cairn = join(owner, '.cairn');
    const saved = join(owner, '.cairn-saved');
    renameSync(cairn, saved);
    writeFileSync(cairn, 'invalid ancestor');
    assert.notEqual(run().status, 0);
    assert.deepEqual(JSON.parse(readFileSync(statePath)).knownGroups, []);
    rmSync(cairn);
    renameSync(saved, cairn);
    const bad = join(server, 'server.db-bad');
    symlinkSync(join(server, 'server.db'), bad);
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.deepEqual(JSON.parse(readFileSync(statePath)).knownGroups, []);
    assert.equal(JSON.parse(readFileSync(statePath)).primary, 'docker');
    assert.equal(statSync(owner).mode & 0o777, 0o755);
    rmSync(bad);
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const state = JSON.parse(readFileSync(statePath));
    assert.ok(state.chowns.some((args) => args[0] === 'ian:owner-group' && args[1] === server));
    assert.ok(
      state.chowns.some(
        (args) => args[0] === 'ian:owner-group' && args[1] === join(server, 'server.db'),
      ),
    );
    assert.ok(state.firewall.length > 0);
    t.diagnostic(
      JSON.stringify({
        backend,
        emitted:
          backend === 'nft' ? state.rules[0] : state.firewall.filter((args) => args.includes('-A')),
      }),
    );
    if (backend === 'nft')
      assert.match(
        state.rules[0],
        /oifname "lo" tcp dport 8787 meta skuid != \{ 0, 1000 \} ct state new reject/,
      );
    else
      for (const tool of ['iptables', 'ip6tables']) {
        assert.ok(
          state.firewall.some(
            (args) => args[0] === tool && args.includes('--uid-owner') && args.includes('1000'),
          ),
        );
        assert.ok(state.firewall.some((args) => args[0] === tool && args.includes('REJECT')));
      }
    assert.match(
      readFileSync(join(root, 'firewall/apply.sh'), 'utf8'),
      backend === 'nft' ? /skuid/ : /uid-owner/,
    );
    const applied = readFileSync(join(root, 'firewall/apply.sh'), 'utf8');
    assert.match(applied, /100\.64\.0\.7/);
    assert.match(applied, /fd7a:115c:a1e0::7/);
    assert.match(applied, backend === 'nft' ? /ct state new/ : /--ctstate NEW/);
    if (backend === 'nft') {
      for (const address of ['100.64.0.7', 'fd7a:115c:a1e0::7']) {
        const rule = state.rules[0].split('\n').find((line) => line.includes(address));
        assert.ok(rule, address);
        assert.doesNotMatch(rule, /dport/);
        assert.match(rule, /ct state new.*meta skuid 2000.*reject/);
      }
    } else {
      for (const address of ['100.64.0.7', 'fd7a:115c:a1e0::7']) {
        const rule = state.firewall.find(
          (args) => args.includes(address) && args.includes('REJECT'),
        );
        assert.ok(rule, address);
        assert.ok(rule.includes('NEW'));
        assert.ok(rule.includes('2000'));
        assert.ok(!rule.includes('--dport'));
      }
    }
    assert.equal(state.primary, 'cairn-runner');
    assert.deepEqual(state.groups, ['cairn-broker']);
    for (const [path, mode] of [
      [owner, 0o700],
      [server, 0o750],
      [join(server, 'server.db'), 0o640],
    ])
      assert.equal(statSync(path).mode & 0o777, mode);
    const quarantine = join(owner, '.cairn/secret-quarantine');
    const entries = readdirSync(quarantine);
    assert.equal(entries.length, 1);
    assert.equal(
      readFileSync(join(quarantine, entries[0], 'secretbox.key'), 'utf8'),
      'stale fixture',
    );
    const checked = (extra = {}) =>
      spawnSync('bash', [join(root, 'firewall/apply.sh'), 'check'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FIXTURE_STATE: statePath,
          FIXTURE_BACKEND: backend,
          CHECK_RULES: '1',
          ...extra,
        },
      });
    const present = checked();
    assert.equal(present.status, 0, present.stderr);
    const missingRules =
      backend === 'nft'
        ? ['0', '1', '2', '3']
        : state.firewall
            .filter((args) => args.includes('-A'))
            .map((args) => args.map((arg) => (arg === '-A' ? '-C' : arg)).join(' '))
            .concat([
              'iptables -w -C OUTPUT -j CAIRN_RUNNER',
              'ip6tables -w -C OUTPUT -j CAIRN_RUNNER',
            ]);
    for (const rule of missingRules) {
      const missing = checked({ MISSING_RULE: rule });
      assert.notEqual(missing.status, 0, rule);
      assert.match(missing.stderr, /Missing rule:/);
      t.diagnostic(missing.stderr.trim());
    }
    assert.notEqual(checked({ CHANGE_ADDRESS: '1' }).status, 0);
    assert.equal(run().status, 0);
    assert.deepEqual(readdirSync(quarantine), entries);
    const remove = spawnSync('bash', [join(root, 'firewall/apply.sh'), 'stop'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_STATE: statePath,
        FIXTURE_BACKEND: backend,
      },
    });
    assert.equal(remove.status, 0, remove.stderr);
  });
