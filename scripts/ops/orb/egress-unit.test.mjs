import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

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

test('the unit runs the checked-in relay with the mise Node 24 and no privilege gain', () => {
  const values = entries();
  assert.match(
    values.get('ExecStart')[0],
    /^\/usr\/bin\/env node %h\/Code\/AgentProjects\/cairn\/scripts\/ops\/orb\/egress-relay\.mjs$/,
  );
  assert.ok(
    values
      .get('Environment')
      .some((entry) => /^PATH=%h\/\.local\/share\/mise\/installs\/node\/24\/bin:/.test(entry)),
  );
  assert.deepEqual(values.get('NoNewPrivileges'), ['yes']);
  assert.ok(!values.has('User'));
  assert.deepEqual(values.get('WantedBy'), ['default.target']);
});

test('the unit does not bind the nspawn bridge address or open a TCP listener', () => {
  assert.ok(!unit.includes('10.203.0.1'));
});
