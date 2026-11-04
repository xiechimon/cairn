import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const unit = readFileSync(new URL('../systemd/cairn-orb-egress.service', import.meta.url), 'utf8');

function entries() {
  const map = new Map();
  for (const line of unit.split('\n')) {
    const match = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (match) map.set(match[1], [...(map.get(match[1]) ?? []), match[2]]);
  }
  return map;
}

test('the user unit serves the relay on an owner-only unix socket in the runtime directory', () => {
  const values = entries();
  assert.ok(
    values.get('Environment').includes('CAIRN_ORB_EGRESS_SOCKET=%t/cairn-orb-egress/egress.sock'),
  );
  assert.deepEqual(values.get('RuntimeDirectory'), ['cairn-orb-egress']);
  assert.deepEqual(values.get('RuntimeDirectoryMode'), ['0700']);
  assert.deepEqual(values.get('ExecStartPre'), ['/usr/bin/install -d -m 0700 %t/cairn-orb-egress']);
  assert.deepEqual(values.get('UMask'), ['0077']);
  assert.deepEqual(values.get('Restart'), ['on-failure']);
});

test('the unit runs the deployed relay with the pinned Node 24 and no privilege gain', () => {
  const values = entries();
  assert.match(
    values.get('ExecStart')[0],
    /^%h\/\.local\/share\/fnm\/node-versions\/v24\.14\.0\/installation\/bin\/node %h\/Code\/AgentProjects\/cairn-exec\/scripts\/ops\/orb\/egress-relay\.mjs$/,
  );
  assert.ok(
    values
      .get('Environment')
      .some((entry) =>
        /^PATH=%h\/\.local\/share\/fnm\/node-versions\/v24\.14\.0\/installation\/bin:/.test(entry),
      ),
  );
  assert.deepEqual(values.get('WorkingDirectory'), ['%h/Code/AgentProjects/cairn-exec']);
  assert.deepEqual(values.get('NoNewPrivileges'), ['yes']);
  assert.ok(!values.has('User'));
  assert.deepEqual(values.get('WantedBy'), ['default.target']);
});

test('the unit does not bind the nspawn bridge address or open a TCP listener', () => {
  assert.ok(!unit.includes('10.203.0.1'));
});

test('the relay command starts when only the deployment checkout exists', (t) => {
  const home = makeTestTempDir('egr-unit-');
  t.after(() => releaseTestTempDir(home));
  const directory = join(home, 'Code/AgentProjects/cairn-exec/scripts/ops/orb');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'egress-relay.mjs'), "process.stdout.write('deployment-relay');\n");
  const nodeDirectory = join(home, '.local/share/fnm/node-versions/v24.14.0/installation/bin');
  mkdirSync(nodeDirectory, { recursive: true });
  symlinkSync(process.execPath, join(nodeDirectory, 'node'));
  const [command, ...args] = entries().get('ExecStart')[0].replaceAll('%h', home).split(' ');
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'deployment-relay');
});
