import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { chmodSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createTokenMinter, scope, startBroker } from './broker.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const request = {
  operation: 'token',
  repository: 'xiechimon/cairn',
  permissions: { contents: 'write', pull_requests: 'write', issues: 'write' },
};

async function fixture(t, overrides = {}) {
  const calls = [];
  const api = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({
      url: req.url,
      method: req.method,
      body,
      authorization: req.headers.authorization,
    });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET')
      res.end(JSON.stringify({ account: { login: overrides.owner ?? 'xiechimon' } }));
    else
      res.end(
        JSON.stringify(
          overrides.response ?? {
            token: 'fixture-token',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            permissions: { ...request.permissions, metadata: 'read' },
          },
        ),
      );
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => api.close(resolve)));
  const mint = createTokenMinter({
    appId: '123',
    installationId: '456',
    privateKey,
    fetchImpl: (url, options) =>
      fetch(`http://127.0.0.1:${api.address().port}${new URL(url).pathname}`, options),
  });
  return { calls, mint };
}

function exchange(path, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let output = '';
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (data) => {
      output += data;
    });
    socket.on('error', reject);
    socket.on('end', () => resolve(JSON.parse(output)));
  });
}

test('fake API receives only the exact repository and permissions, signed by a generated key', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.mint(request)).token, 'fixture-token');
  assert.deepEqual(
    f.calls.map(({ method, url }) => [method, url]),
    [
      ['GET', '/app/installations/456'],
      ['POST', '/app/installations/456/access_tokens'],
    ],
  );
  assert.deepEqual(JSON.parse(f.calls[1].body), {
    repositories: ['cairn'],
    permissions: request.permissions,
  });
  assert.deepEqual(scope, { repositories: ['cairn'], permissions: request.permissions });
  const jwt = f.calls[0].authorization.slice('Bearer '.length).split('.');
  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(jwt.slice(0, 2).join('.')),
      keys.publicKey,
      Buffer.from(jwt[2], 'base64url'),
    ),
    true,
  );
  const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
  assert.equal(claims.iss, '123');
  assert.ok(claims.exp - claims.iat <= 600);
});

test('all alternate scopes are refused before contacting the API', async (t) => {
  const f = await fixture(t);
  for (const change of [
    { repository: 'xiechimon/other' },
    { repository: 'other/cairn' },
    { repositories: ['cairn', 'other'] },
    { installationId: '999' },
    { operation: 'admin' },
    { permissions: { ...request.permissions, administration: 'write' } },
    { permissions: { ...request.permissions, workflows: 'write' } },
    { permissions: { ...request.permissions, actions: 'write' } },
    { permissions: { ...request.permissions, secrets: 'write' } },
    { permissions: { contents: 'read' } },
  ]) {
    await assert.rejects(f.mint({ ...request, ...change }));
  }
  assert.equal(f.calls.length, 0);
});

test('upstream repository expansion is refused even with matching permissions', async (t) => {
  for (const extra of [
    { repository_selection: 'all' },
    { repositories: [{ full_name: 'xiechimon/other' }] },
    { repositories: [{ full_name: 'xiechimon/cairn' }, { full_name: 'xiechimon/other' }] },
  ]) {
    const f = await fixture(t, {
      response: {
        token: 'fixture-token',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        permissions: request.permissions,
        ...extra,
      },
    });
    await assert.rejects(f.mint(request));
  }
});

test('wrong installation owner and wider or malformed upstream tokens are refused', async (t) => {
  const wrongOwner = await fixture(t, { owner: 'other' });
  await assert.rejects(wrongOwner.mint(request));
  assert.equal(wrongOwner.calls.length, 1);
  for (const response of [
    {
      token: 'sensitive-fixture',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      permissions: { ...request.permissions, actions: 'write' },
    },
    { token: 'sensitive-fixture' },
    {
      token: 'sensitive-fixture',
      expires_at: '2000-01-01T00:00:00Z',
      permissions: request.permissions,
    },
  ]) {
    const f = await fixture(t, { response });
    await assert.rejects(f.mint(request), (error) => !error.message.includes('sensitive-fixture'));
  }
});

test('real Unix socket enforces directory and socket modes and refuses malformed frames', async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'broker-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  chmodSync(dir, 0o2710);
  const f = await fixture(t);
  const path = join(dir, 'broker.sock');
  const broker = await startBroker({
    socketPath: path,
    runnerGid: statSync(dir).gid,
    mint: f.mint,
  });
  t.after(() => broker.close());
  assert.equal(statSync(path).mode & 0o777, 0o660);
  assert.equal((await exchange(path, `${JSON.stringify(request)}\n`)).token, 'fixture-token');
  for (const payload of [
    '{}\n',
    '{\n',
    `${'x'.repeat(4097)}\n`,
    `${JSON.stringify(request)}\n{}\n`,
  ]) {
    assert.deepEqual(await exchange(path, payload), { error: 'request refused' });
  }
  assert.equal(f.calls.length, 2);
});

test('unsafe directories and existing socket paths are never replaced', async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'broker-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'broker.sock');
  await assert.rejects(
    startBroker({ socketPath: path, runnerGid: statSync(dir).gid, mint: async () => ({}) }),
  );
  chmodSync(dir, 0o2710);
  writeFileSync(path, 'keep');
  await assert.rejects(
    startBroker({ socketPath: path, runnerGid: statSync(dir).gid, mint: async () => ({}) }),
  );
  assert.equal(statSync(path).size, 4);
});
