import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  buildJwt,
  canReuseToken,
  checkKeyPermissions,
  createTokenSource,
  startMint,
} from './mint.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const token = 'fake-installation-secret';
const now = 1_800_000_000_000;

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'app-mint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const privateKeyPath = join(dir, 'key.pem');
  await writeFile(privateKeyPath, pem, { mode: 0o600 });
  return { appId: '123', installationId: 456, privateKeyPath, socketPath: join(dir, 'mint.sock') };
}

function call(socketPath, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function upstream() {
  return Response.json({ token, expires_at: new Date(now + 3600_000).toISOString() });
}

test('JWT uses RS256 and bounded claims with a throwaway key', () => {
  const jwt = buildJwt('123', pem, now);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
    iat: now / 1000 - 60,
    exp: now / 1000 + 540,
    iss: '123',
  });
  assert.ok(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
  );
});

test('0644 refuses startup; 0600 starts with a 0600 Unix socket and no TCP address', async (t) => {
  const config = await fixture(t);
  await chmod(config.privateKeyPath, 0o644);
  await assert.rejects(startMint(config), /private key permissions/);
  assert.throws(
    () => checkKeyPermissions({ mode: 0o100600, uid: process.getuid() + 1 }, process.getuid()),
    /private key permissions/,
  );
  await chmod(config.privateKeyPath, 0o600);
  const server = await startMint(config, {
    fetchImpl: async (url) =>
      url.endsWith('/app') ? Response.json({ slug: 'cairnwright' }) : upstream(),
    now: () => now,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(server.address(), config.socketPath);
  assert.equal((await stat(config.socketPath)).mode & 0o777, 0o600);
  assert.equal((await call(config.socketPath, '/health')).status, 200);
  assert.equal((await call(config.socketPath, '/other')).status, 404);
});

test('cache reuses until five minutes before expiry, force refresh mints, concurrent requests coalesce', async () => {
  let clock = now;
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => clock,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      assert.equal(url, 'https://api.github.com/app/installations/456/access_tokens');
      assert.equal(init.method, 'POST');
      return Response.json({ token, expires_at: new Date(clock + 3600_000).toISOString() });
    },
  });
  const values = await Promise.all([source(), source()]);
  assert.equal(calls, 1);
  assert.equal(values[0].token, token);
  clock = now + 3300_000 - 1;
  await source();
  assert.equal(calls, 1);
  clock++;
  assert.equal(canReuseToken(values[0], clock), false);
  await source();
  assert.equal(calls, 2);
  await source(true);
  assert.equal(calls, 3);
});

test('exchange 401 and 503 report only status/message; secrets are redacted even if echoed', async () => {
  for (const status of [401, 503]) {
    let jwt;
    const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        jwt = init.headers.authorization.slice(7);
        return Response.json({ message: `Rejected ${pem} ${jwt} ${token}`, token }, { status });
      },
    });
    await assert.rejects(source(), (error) => {
      assert.match(error.message, new RegExp(`GitHub ${status}: Rejected`));
      for (const secret of [pem, jwt, token]) assert.ok(!error.message.includes(secret));
      return true;
    });
  }
});

test('HTTP output exposes token only at /token, never key/JWT; stdout/stderr stay empty', async (t) => {
  const config = await fixture(t);
  let jwt;
  const stdout = [];
  const stderr = [];
  let exchanges = 0;
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    const server = await startMint(config, {
      now: () => now,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        jwt = init.headers.authorization.slice(7);
        exchanges++;
        if (exchanges > 1)
          return Response.json(
            { message: `Rejected ${pem} ${jwt} ${token}`, token },
            { status: 503 },
          );
        return upstream();
      },
    });
    try {
      const result = await call(config.socketPath, '/token');
      assert.deepEqual(JSON.parse(result.body), {
        token,
        expiresAt: new Date(now + 3600_000).toISOString(),
        installationId: 456,
        appSlug: 'cairnwright',
      });
      assert.ok(!result.body.includes(pem));
      assert.ok(!result.body.includes(jwt));
      const health = await call(config.socketPath, '/health');
      assert.ok(!health.body.includes(token));
      const failure = await call(config.socketPath, '/token', { 'x-cairn-refresh': '1' });
      assert.equal(failure.status, 502);
      for (const secret of [pem, jwt, token]) assert.ok(!failure.body.includes(secret));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  for (const secret of [pem, jwt, token])
    assert.ok(![...stdout, ...stderr].join('').includes(secret));
});

test('refuses active sockets and ordinary files; removes only stale sockets', async (t) => {
  const config = await fixture(t);
  await writeFile(config.socketPath, 'keep');
  await assert.rejects(startMint(config), /socket path/);
  assert.equal(await readFile(config.socketPath, 'utf8'), 'keep');
  await rm(config.socketPath);
  const net = createNetServer();
  net.listen(config.socketPath);
  await once(net, 'listening');
  await assert.rejects(startMint(config), /already active/);
  await new Promise((resolve) => net.close(resolve));
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import { createServer } from 'node:net'; createServer().listen(process.argv[1], () => process.exit(0));",
    config.socketPath,
  ]);
  assert.ok((await stat(config.socketPath)).isSocket());
  const server = await startMint(config);
  assert.equal((await call(config.socketPath, '/health')).status, 200);
  await new Promise((resolve) => server.close(resolve));
});

test('HTTP errors and thrown fetch errors never expose secrets or log credentials', async (t) => {
  const config = await fixture(t);
  let calls = 0;
  let jwt;
  const server = await startMint(config, {
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      jwt = init.headers.authorization.slice(7);
      if (calls === 1)
        return Response.json(
          { message: `Rejected ${pem} ${jwt} ${token}`, token },
          { status: 503 },
        );
      throw new Error(`${pem} ${jwt} ${token}`);
    },
  });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await call(config.socketPath, '/token');
      assert.equal(result.status, 502);
      if (i === 0) assert.match(result.body, /GitHub 503: Rejected/);
      for (const secret of [pem, jwt, token]) assert.ok(!result.body.includes(secret));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('service umask preserves owner search permission on a new runtime directory', async (t) => {
  const config = await fixture(t);
  config.socketPath = join(dirname(config.privateKeyPath), 'run', 'mint.sock');
  const mask = process.umask(0o077);
  let server;
  try {
    server = await startMint(config);
    assert.equal((await stat(dirname(config.socketPath))).mode & 0o777, 0o700);
    assert.equal((await stat(config.socketPath)).mode & 0o777, 0o600);
    assert.equal((await call(config.socketPath, '/health')).status, 200);
  } finally {
    process.umask(mask);
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
