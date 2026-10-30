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

for (const backend of ['unavailable'])
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
if (command === 'chown') (state.chowns ??= []).push(args);
if (['tailscale', 'nft', 'iptables', 'ip6tables', 'systemctl'].includes(command)) throw new Error('Removed dependency invoked');
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
    assert.ok(!readdirSync(root).some((name) => name.startsWith('firewall')));
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
    assert.equal(run().status, 0);
    assert.deepEqual(readdirSync(quarantine), entries);
  });
