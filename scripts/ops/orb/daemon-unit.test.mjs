import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const unitPath = new URL('../systemd/cairn-daemon-orb.service', import.meta.url);

test('Orb daemon uses a separate machine identity and state with the production server URL', () => {
  const unit = readFileSync(unitPath, 'utf8');
  const entries = new Map();
  for (const line of unit.split('\n')) {
    const match = /^([^=]+)=(.*)$/.exec(line);
    if (match) entries.set(match[1], [...(entries.get(match[1]) ?? []), match[2]]);
  }
  const env = Object.fromEntries(
    (entries.get('Environment') ?? []).map((entry) => {
      const pair = entry.replace(/^"|"$/g, '');
      const at = pair.indexOf('=');
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  assert.equal(env.CAIRN_EXECUTOR, 'orb');
  assert.equal(env.CAIRN_HOME, '%h/.cairn-orb-daemon');
  assert.notEqual(env.CAIRN_HOME, '%h/.cairn');
  assert.equal(env.CAIRN_WORKSPACES_DIR, '%h/.cairn-orb-daemon/workspaces');
  assert.ok(!env.TMPDIR || env.CAIRN_HEAVY_SLOTS_DIR);
  assert.deepEqual(entries.get('WorkingDirectory'), ['%h/Code/AgentProjects/cairn/apps/daemon']);
  assert.match(
    entries.get('ExecStart')[0],
    /node dist\/cli\.mjs start -f --server http:\/\/127\.0\.0\.1:8787 --name omarchy-orb$/,
  );
  assert.deepEqual(entries.get('ExecStartPre'), ['/usr/bin/mkdir -p %h/.cairn-orb-daemon']);
  assert.deepEqual(entries.get('Restart'), ['always']);
  assert.deepEqual(entries.get('WantedBy'), ['default.target']);
  assert.ok(!unit.includes('cairn-daemon.service'));
});
