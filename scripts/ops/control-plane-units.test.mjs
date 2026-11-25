import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';

const NODE_MAJOR = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
const NODE_24 = '%h/.local/share/mise/installs/node/24/bin/node';
const UNIT_NAMES = ['cairn-server', 'cairn-daemon'];

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

test('the deployed server fetch uses its configured HTTP proxy', { timeout: 10000 }, async (t) => {
  const proxy = createServer();
  proxy.on('connect', (request, socket) => {
    t.after(() => socket.destroy());
    assert.equal(request.url, 'cairn-egress-probe.invalid:80');
    socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
    socket.once('data', (data) => {
      assert.match(data.toString(), /^GET \/check HTTP\/1\.1/);
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied');
    });
  });
  proxy.on('request', (request, response) => {
    assert.equal(request.url, 'http://cairn-egress-probe.invalid/check');
    response.end('proxied');
  });
  await new Promise((ready) => proxy.listen(0, '127.0.0.1', ready));
  t.after(() => proxy.close());
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "console.log(await (await fetch('http://cairn-egress-probe.invalid/check', { signal: AbortSignal.timeout(5000) })).text())",
    ],
    {
      env: {
        PATH: process.env.PATH,
        ...units['cairn-server'].env,
        HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
        NO_PROXY: 'localhost,127.0.0.1,::1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
    },
  );
  t.after(() => child.kill());
  let output = '';
  let error = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    error += chunk;
  });
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', done);
  });
  assert.equal(code, 0, error);
  assert.equal(output.trim(), 'proxied');
});

test('long-running units use the pinned Node major while the artifact server uses the host PATH', () => {
  const [daemonExec] = units['cairn-daemon'].entries.get('ExecStart');
  const binary = daemonExec.split(' ')[0];
  assert.equal(binary, NODE_24);
  assert.match(binary, new RegExp(`/node/${NODE_MAJOR}/bin/node$`));
  assert.ok(
    units['cairn-daemon'].env.PATH.startsWith('%h/.local/share/mise/installs/node/24/bin:'),
  );
  assert.match(units['cairn-server'].entries.get('ExecStart')[0], /^\/usr\/bin\/env node /);
  assert.equal(selfDeploy.entries.get('EnvironmentFile')[0], '%h/.config/cairn/deploy.env');
});

test('the server caps its heap and memory', () => {
  const { entries } = units['cairn-server'];
  assert.match(entries.get('ExecStart')[0], /--max-old-space-size=\d+/);
  assert.ok(entries.get('MemoryMax')?.[0]);
});

test('the daemon reaches the server on loopback', () => {
  assert.match(
    units['cairn-daemon'].entries.get('ExecStart')[0],
    /dist\/cli\.mjs start -f --server http:\/\/127\.0\.0\.1:8787$/,
  );
  assert.deepEqual(units['cairn-daemon'].entries.get('After'), ['cairn-server.service']);
});

test('units are private and restart on failure', () => {
  for (const name of UNIT_NAMES) {
    assert.deepEqual(units[name].entries.get('UMask'), ['0077'], name);
    assert.ok(units[name].entries.get('Restart')?.[0], name);
    assert.deepEqual(units[name].entries.get('WantedBy'), ['default.target'], name);
  }
});

test('the server comes back after a clean exit that systemd did not ask for', () => {
  assert.deepEqual(units['cairn-server'].entries.get('Restart'), ['always']);
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

test('self-deploy takes host-specific values from the host env file', () => {
  const [exec] = selfDeploy.entries.get('ExecStart');
  assert.match(exec, /\$\{CAIRN_DEPLOY_BUILD_CHECKOUT\}\/scripts\/ops\/deploy-watch\.sh/);
  assert.doesNotMatch(exec, /GH_TOKEN|token\.mjs|CAIRN_GH_WRAPPER/);
  assert.doesNotMatch(selfDeploy.text, /Code\/AgentProjects|cairn-exec|omarchy/);
});

test('the server runs the stable artifact path and only the daemon runs from its source checkout', () => {
  assert.equal(units['cairn-server'].entries.get('WorkingDirectory')[0], '%h/cairn-server');
  assert.match(
    units['cairn-daemon'].entries.get('WorkingDirectory')[0],
    /^%h\/Code\/AgentProjects\/cairn-exec\/apps\//,
  );
  for (const script of ['deploy-self.sh', 'deploy-watch.sh']) {
    const text = readFileSync(new URL(`./${script}`, import.meta.url), 'utf8');
    assert.match(text, /CAIRN_DEPLOY_BUILD_CHECKOUT/, script);
    assert.doesNotMatch(text, /Code\/AgentProjects\/cairn-exec|omarchy/, script);
  }
});
