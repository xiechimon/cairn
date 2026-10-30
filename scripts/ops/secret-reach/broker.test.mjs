import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBroker, mintToken } from './broker.mjs';
import { requestToken } from './token-scope-probe.mjs';

const permissions = { contents: 'write', pull_requests: 'write', issues: 'write' };
const request = { type: 'mint', repository: 'xiechimon/cairn', permissions };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { appId: '123', installationId: '456', privateKey: keys.privateKey };
test('broker rejects other repositories, permissions and malformed requests before HTTP', async () => {
  for (const invalid of [
    { ...request, repository: 'other/repo' },
    { ...request, permissions: { ...permissions, administration: 'write' } },
    { ...request, extra: true },
    null,
  ]) {
    await assert.rejects(
      mintToken(invalid, { ...config, fetch: () => assert.fail('HTTP must not run') }),
    );
  }
});
test('broker signs JWT and sends only fixed repository permissions', async () => {
  const token = await mintToken(request, {
    ...config,
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.github.com/app/installations/456/access_tokens');
      assert.deepEqual(JSON.parse(options.body), { repositories: ['cairn'], permissions });
      const jwt = options.headers.Authorization.slice(7);
      const [header, payload, signature] = jwt.split('.');
      assert.equal(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
        true,
      );
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      assert.equal(claims.iss, '123');
      assert.ok(claims.exp - claims.iat <= 660);
      return { ok: true, json: async () => ({ token: 'fixture-token', expires_at: 'later' }) };
    },
  });
  assert.deepEqual(token, { token: 'fixture-token', expires_at: 'later' });
  await assert.rejects(
    mintToken(request, { ...config, fetch: async () => ({ ok: false }) }),
    /GitHub request failed/,
  );
});
test('socket enforces framing, mode and preserves existing paths', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'broker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socketPath = join(root, 'broker.sock');
  let server;
  try {
    server = await createBroker({
      ...config,
      socketPath,
      groupId: process.getgid(),
      fetch: () => assert.fail('invalid request'),
    });
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Sandbox denies Unix socket binding');
      return;
    }
    throw error;
  }
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(statSync(socketPath).mode & 0o777, 0o660);
  await assert.rejects(createBroker({ ...config, socketPath, groupId: process.getgid() }));
  for (const body of ['{}\n', 'bad\n', `${'a'.repeat(9000)}\n`]) {
    const result = await new Promise((resolve, reject) => {
      const socket = createConnection(socketPath);
      let output = '';
      socket.on('connect', () => socket.write(body));
      socket.on('data', (data) => {
        output += data;
      });
      socket.on('end', () => resolve(output));
      socket.on('error', reject);
    });
    assert.deepEqual(JSON.parse(result), { error: 'request refused' });
  }
});

test('broker rejects unsafe listener configuration before binding', async () => {
  for (const socketPath of [undefined, '', 'relative.sock', 8787])
    await assert.rejects(createBroker({ ...config, socketPath, groupId: 0 }), /socket path/i);
  for (const groupId of [undefined, '', ' ', 'abc', -1, NaN])
    await assert.rejects(
      createBroker({ ...config, socketPath: '/tmp/never-bind-2189.sock', groupId }),
      /socket group/i,
    );
});

test('runner client obtains token through socket without reading owner configuration', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'client-broker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const socketPath = join(root, 'broker.sock');
  let server;
  try {
    server = await createBroker({
      ...config,
      socketPath,
      groupId: process.getgid(),
      fetch: async () => ({
        ok: true,
        json: async () => ({ token: 'fixture-token', expires_at: 'later' }),
      }),
    });
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Sandbox denies Unix socket binding');
    throw error;
  }
  t.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  assert.equal(await requestToken(socketPath), 'fixture-token');
});

test('CLI rejects empty and nonnumeric GID before reading owner key', () => {
  for (const gid of ['', ' ', 'invalid']) {
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'broker.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_BROKER_GID: gid },
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Invalid socket group/);
  }
});
for (const signal of ['SIGTERM', 'SIGINT'])
  test(`broker removes socket on ${signal}`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'broker-signal-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const socketPath = join(root, 'broker.sock');
    const childPath = join(root, 'child.mjs');
    writeFileSync(
      childPath,
      `import { createBroker } from ${JSON.stringify(new URL('./broker.mjs', import.meta.url).href)};\nawait createBroker({socketPath: ${JSON.stringify(socketPath)}, groupId: ${process.getgid()}});\nprocess.stdout.write('ready');\n`,
    );
    const child = spawn(process.execPath, [childPath]);
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let error = '';
    child.stderr.on('data', (data) => {
      error += data;
    });
    const ready = await Promise.race([
      once(child.stdout, 'data').then(() => true),
      once(child, 'exit').then(() => false),
    ]);
    if (!ready) {
      if (error.includes('EPERM')) return t.skip('Sandbox denies Unix socket binding');
      assert.fail(error);
    }
    assert.equal(existsSync(socketPath), true);
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
    assert.equal(existsSync(socketPath), false);
  });
