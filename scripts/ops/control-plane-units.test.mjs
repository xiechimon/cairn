import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const NODE_MAJOR = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
const NODE_24 = '%h/.local/share/mise/installs/node/24/bin/node';
const UNIT_NAMES = ['cairn-server', 'cairn-daemon', 'cairn-coordinator'];

function parseUnit(name) {
  const text = readFileSync(new URL(`./systemd/${name}.service`, import.meta.url), 'utf8');
  const entries = new Map();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (match) entries.set(match[1], [...(entries.get(match[1]) ?? []), match[2]]);
  }
  const env = Object.fromEntries(
    (entries.get('Environment') ?? []).map((entry) => {
      const pair = entry.replace(/^"|"$/g, '');
      const at = pair.indexOf('=');
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
  return { text, entries, env };
}

const units = Object.fromEntries(UNIT_NAMES.map((name) => [name, parseUnit(name)]));
const selfDeploy = parseUnit('cairn-self-deploy');

test('the server binds loopback port 8787', () => {
  const { env } = units['cairn-server'];
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PORT, '8787');
});

test('every ExecStart runs the Node major in .nvmrc', () => {
  for (const name of UNIT_NAMES) {
    const [exec] = units[name].entries.get('ExecStart');
    const binary = exec.split(' ')[0];
    assert.equal(binary, NODE_24, name);
    assert.match(binary, new RegExp(`/node/${NODE_MAJOR}/bin/node$`), name);
    assert.ok(units[name].env.PATH.startsWith('%h/.local/share/mise/installs/node/24/bin:'), name);
  }
  assert.ok(selfDeploy.env.PATH.startsWith('%h/.local/share/mise/installs/node/24/bin:'));
});

test('the server caps its heap and memory', () => {
  const { entries } = units['cairn-server'];
  assert.match(entries.get('ExecStart')[0], /--max-old-space-size=\d+/);
  assert.ok(entries.get('MemoryMax')?.[0]);
});

test('daemon and coordinator reach the server on loopback', () => {
  assert.match(
    units['cairn-daemon'].entries.get('ExecStart')[0],
    /dist\/cli\.mjs start -f --server http:\/\/127\.0\.0\.1:8787$/,
  );
  assert.equal(
    units['cairn-coordinator'].env.CAIRN_COORDINATOR_SERVER_URL,
    'http://127.0.0.1:8787',
  );
  for (const name of ['cairn-daemon', 'cairn-coordinator']) {
    assert.deepEqual(units[name].entries.get('After'), ['cairn-server.service'], name);
  }
});

test('units are private and restart on failure', () => {
  for (const name of UNIT_NAMES) {
    assert.deepEqual(units[name].entries.get('UMask'), ['0077'], name);
    assert.ok(units[name].entries.get('Restart')?.[0], name);
    assert.deepEqual(units[name].entries.get('WantedBy'), ['default.target'], name);
  }
});

test('no unit sets TMPDIR without the shared heavy slot directory', () => {
  for (const { env } of [...Object.values(units), selfDeploy]) {
    assert.ok(!env.TMPDIR || env.CAIRN_HEAVY_SLOTS_DIR);
  }
});

test('no unit pins a removed mount or a tailnet address', () => {
  for (const { text } of [...Object.values(units), selfDeploy]) {
    assert.doesNotMatch(text, /\/mnt\/fast/);
    assert.doesNotMatch(text, /\b100\.\d+\.\d+\.\d+\b/);
    assert.doesNotMatch(text, /ts\.net/);
  }
});

test('self-deploy authenticates gh with a GitHub App token', () => {
  const [exec] = selfDeploy.entries.get('ExecStart');
  assert.match(exec, /%h\/\.cairn\/tools\/app-token\/token\.mjs/);
  assert.match(exec, /GH_TOKEN/);
  assert.match(exec, /deploy-watch\.sh/);
});
