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

function call(socketPath, path, headers = {}, timeoutMs = null) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        headers,
        ...(timeoutMs === null ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function upstream(init, fields = {}) {
  const body = init?.body === undefined ? {} : JSON.parse(init.body);
  return Response.json({
    token,
    expires_at: new Date(now + 3600_000).toISOString(),
    repositories: [
      ...(body.repositories ?? []).map((name) => ({ full_name: `octo/${name}` })),
      ...(body.repository_ids ?? []).map((id) => ({ id, full_name: 'octo/repo' })),
    ],
    ...(body.permissions === undefined ? {} : { permissions: body.permissions }),
    ...fields,
  });
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
    fetchImpl: async (url, init) =>
      url.endsWith('/app') ? Response.json({ slug: 'cairnwright' }) : upstream(init),
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
      return Response.json({
        token,
        expires_at: new Date(clock + 3600_000).toISOString(),
        repositories: [{ full_name: 'octo/alpha' }],
        permissions: { contents: 'write' },
      });
    },
  });
  const scope = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  const values = await Promise.all([source(scope), source(scope)]);
  assert.equal(calls, 1);
  assert.equal(values[0].token, token);
  clock = now + 3300_000 - 1;
  await source(scope);
  assert.equal(calls, 1);
  clock++;
  assert.equal(canReuseToken(values[0], clock), false);
  await source(scope);
  assert.equal(calls, 2);
  await source({ ...scope, force: true });
  assert.equal(calls, 3);
});

test('concurrent forced refreshes for one scope share one upstream exchange', async () => {
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      return upstream(init);
    },
  });
  const scope = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  const values = await Promise.all([
    source({ ...scope, force: true }),
    source({ ...scope, force: true }),
    source({ ...scope, force: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(values[0].token, token);
});

test('a caller mutating its permission object mid-mint cannot widen the granted scope', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const seen = [];
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) {
        await gate;
        return Response.json({ slug: 'cairnwright' });
      }
      seen.push(JSON.parse(init.body));
      return upstream(init);
    },
  });
  const permissions = { contents: 'read' };
  const pending = source({ owner: 'octo', repository: 'alpha', permissions });
  await new Promise((resolve) => setImmediate(resolve));
  permissions.contents = 'write';
  release();
  const result = await pending;
  assert.equal(seen[0].permissions.contents, 'read');
  assert.equal(result.permissions.contents, 'read');
  const again = await source({
    owner: 'octo',
    repository: 'alpha',
    permissions: { contents: 'read' },
  });
  assert.equal(again.token, result.token);
  assert.equal(again.permissions.contents, 'read');
});

test('case variants of one repository share the cached entry and one forced exchange', async () => {
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      return upstream(init);
    },
  });
  const lowercase = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  const values = await Promise.all([
    source({ ...lowercase, force: true }),
    source({ owner: 'Octo', repository: 'Alpha', permissions: { contents: 'write' }, force: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(values[0].token, values[1].token);
  const again = await source({
    owner: 'OCTO',
    repository: 'ALPHA',
    permissions: lowercase.permissions,
  });
  assert.equal(again.token, values[0].token);
  assert.equal(calls, 1);
});

test('a repository pinned by id exchanges by repository_ids and verifies the returned id', async () => {
  const bodies = [];
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      bodies.push(JSON.parse(init.body));
      const requested = JSON.parse(init.body).repository_ids ?? [];
      return Response.json({
        token,
        expires_at: new Date(now + 3600_000).toISOString(),
        repositories: requested.map((id) => ({ id, full_name: 'octo/renamed' })),
        permissions: { contents: 'write' },
      });
    },
  });
  const result = await source({
    owner: 'octo',
    repository: 'alpha',
    repositoryId: '42',
    permissions: { contents: 'write' },
  });
  assert.equal(result.token, token);
  assert.equal(result.repositoryId, 42);
  assert.deepEqual(result.repositories, ['octo/renamed']);
  assert.deepEqual(bodies.at(-1).repository_ids, [42]);
  assert.equal(bodies.at(-1).repositories, undefined);
});

test('a pinned mint caches by requested name and grants; refresh replaces only that entry', async (t) => {
  const config = await fixture(t);
  let fullName = 'octo/alpha';
  let exchanges = 0;
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      return upstream(init, {
        token: `pinned-${++exchanges}`,
        repositories: [{ id: 42, full_name: fullName }],
      });
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const oldPath = '/token?repository=alpha&owner=octo&repository_id=42&permissions=metadata:read,contents:write';
  const newPath = '/token?repository=renamed&owner=octo&repository_id=42&permissions=metadata:read,contents:write';
  const variant = '/token?repository=RENAMED&owner=OCTO&repository_id=42&permissions=contents:write,metadata:read';
  const first = await call(config.socketPath, oldPath);
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.body).repositories, ['octo/alpha']);

  fullName = 'octo/renamed';
  const renamed = await call(config.socketPath, newPath);
  assert.equal(renamed.status, 200);
  assert.deepEqual(JSON.parse(renamed.body).repositories, ['octo/renamed']);
  assert.equal((await call(config.socketPath, variant)).body, renamed.body);

  const forced = await call(config.socketPath, newPath, { 'x-cairn-refresh': '1' });
  assert.equal(forced.status, 200);
  assert.equal(JSON.parse(forced.body).token, 'pinned-3');
  assert.equal((await call(config.socketPath, variant)).body, forced.body);
  assert.equal((await call(config.socketPath, oldPath)).body, first.body);
  assert.equal(exchanges, 3);
});

test('a minted repository id that differs from the pinned id is rejected and never cached', async () => {
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      return Response.json({
        token,
        expires_at: new Date(now + 3600_000).toISOString(),
        repositories: [{ id: 43, full_name: 'octo/alpha' }],
        permissions: { contents: 'write' },
      });
    },
  });
  await assert.rejects(
    source({
      owner: 'octo',
      repository: 'alpha',
      repositoryId: '42',
      permissions: { contents: 'write' },
    }),
    /GitHub 201: invalid token response/,
  );
  const minted = await source({
    owner: 'octo',
    repository: 'alpha',
    repositoryId: '43',
    permissions: { contents: 'write' },
  });
  assert.equal(minted.token, token);
  assert.equal(calls, 2);
});

for (const fullName of ['', 'alpha', 'octo/..', 'octo/alpha/extra', 'octo/alpha?', 'bad owner/alpha']) {
  test(`an ID-pinned mint refuses malformed full name ${JSON.stringify(fullName)} without caching`, async () => {
    let exchanges = 0;
    const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
      now: () => now,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        return upstream(init, {
          repositories: [{ id: 42, full_name: ++exchanges === 1 ? fullName : 'Octo-Org/.alpha_repo-2' }],
        });
      },
    });
    const scope = { owner: 'octo', repository: 'alpha', repositoryId: 42, permissions: { contents: 'write' } };
    await assert.rejects(source(scope), /GitHub 201: invalid token response/);
    assert.deepEqual((await source(scope)).repositories, ['Octo-Org/.alpha_repo-2']);
    assert.equal(exchanges, 2);
  });
}

test('the minter evicts the least recently used scoped token at capacity', async () => {
  let exchanges = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => url.endsWith('/app')
      ? Response.json({ slug: 'cairnwright' })
      : upstream(init, { token: `fixture-${++exchanges}` }),
  });
  const grant = (index) => source({ owner: 'octo', repository: `repo-${index}`, permissions: { contents: 'write' } });
  for (let index = 0; index < 256; index++) await grant(index);
  assert.equal((await grant(0)).token, 'fixture-1');
  await grant(256);
  assert.equal((await grant(0)).token, 'fixture-1');
  assert.equal((await grant(1)).token, 'fixture-258');
});

for (const eviction of ['access', 'sweep']) {
  test(`the minter drops an expired scoped token on ${eviction}`, async (t) => {
    let exchanges = 0;
    let clock = now;
    let sweep;
    const interval = globalThis.setInterval;
    t.mock.method(globalThis, 'setInterval', (callback, ...args) => {
      sweep = callback;
      return interval(callback, ...args);
    });
    const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
      now: () => clock,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        if (++exchanges === 2 && eviction === 'access') return Response.json({}, { status: 503 });
        return upstream(init, { token: `fixture-${exchanges}` });
      },
    });
    const scope = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
    assert.equal((await source(scope)).token, 'fixture-1');
    clock = now + 3600_000;
    if (eviction === 'sweep') {
      assert.equal(typeof sweep, 'function');
      sweep();
    } else {
      await assert.rejects(source(scope), /GitHub 503/);
    }
    clock = now;
    assert.equal((await source(scope)).token, eviction === 'sweep' ? 'fixture-2' : 'fixture-3');
  });
}

test('a malformed repository id is rejected at the source and at the route', async (t) => {
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      calls++;
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      return upstream(init);
    },
  });
  const permissions = { contents: 'write' };
  for (const repositoryId of [
    'abc',
    '0',
    '-1',
    '4.5',
    '4two',
    '042',
    '',
    '9007199254740993',
    [42],
    42n,
    Object(42),
    0,
    -1,
    4.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await assert.rejects(
      source({ owner: 'octo', repository: 'alpha', repositoryId, permissions }),
      /invalid token scope/,
    );
  }
  assert.equal(calls, 0);
  const minted = await source({
    owner: 'octo',
    repository: 'alpha',
    repositoryId: '42',
    permissions,
  });
  assert.equal(minted.token, token);
  assert.equal(
    await source({ owner: 'octo', repository: 'alpha', repositoryId: 42, permissions }),
    minted,
  );
  assert.equal(calls, 2);
  const config = await fixture(t);
  const fetched = [];
  const server = await startMint(config, {
    fetchImpl: async (url, init) => {
      fetched.push(url);
      return url.endsWith('/app') ? Response.json({ slug: 'cairnwright' }) : upstream(init);
    },
    now: () => now,
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const repositoryId of ['abc', '0', '4two', '9007199254740993']) {
    const response = await call(
      config.socketPath,
      `/token?repository=alpha&owner=octo&repository_id=${repositoryId}&permissions=metadata%3Aread`,
    );
    assert.equal(response.status, 400);
  }
  const duplicated = await call(
    config.socketPath,
    '/token?repository=alpha&owner=octo&repository_id=1&repository_id=2&permissions=metadata%3Aread',
  );
  assert.equal(duplicated.status, 400);
  assert.deepEqual(fetched, []);
  const ok = await call(
    config.socketPath,
    '/token?repository=alpha&owner=octo&repository_id=9007199254740991&permissions=metadata%3Aread',
  );
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).repositoryId, Number.MAX_SAFE_INTEGER);
});

test('a superseded exchange never overwrites the cached token', async () => {
  const gates = [];
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      const generation = gates.length + 1;
      await new Promise((resolve) => gates.push(resolve));
      return upstream(init, { token: `minted-${generation}` });
    },
  });
  const scope = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  const first = source(scope);
  const second = source({ ...scope, force: true });
  while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));
  gates[1]();
  assert.equal((await second).token, 'minted-2');
  gates[0]();
  assert.equal((await first).token, 'minted-1');
  assert.equal((await source(scope)).token, 'minted-2');
});

test('a failed newer exchange never lets the older in-flight exchange refill the cache', async () => {
  const gates = [];
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      const index = ++calls;
      if (index <= 2) await new Promise((resolve) => gates.push(resolve));
      if (index === 2) return Response.json({ message: 'upstream down' }, { status: 503 });
      return upstream(init, { token: `minted-${index}` });
    },
  });
  const scope = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  const first = source(scope);
  const second = source({ ...scope, force: true });
  while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));
  gates[1]();
  await assert.rejects(second, /503/);
  gates[0]();
  assert.equal((await first).token, 'minted-1');
  assert.equal((await source(scope)).token, 'minted-3');
});

test('a forced mint never joins a non-forced in-flight exchange for the same scope', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      await gate;
      return upstream(init);
    },
  });
  const slow = source({ owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } });
  const forced = source({
    owner: 'octo',
    repository: 'alpha',
    permissions: { contents: 'write' },
    force: true,
  });
  try {
    for (let i = 0; calls < 2 && i < 100; i++) await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
  } finally {
    release();
  }
  await Promise.all([slow, forced]);
});

test('the mint echoes the granted repository and permission scope for verification', async () => {
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      return Response.json({
        token,
        expires_at: new Date(now + 3600_000).toISOString(),
        repositories: [{ full_name: 'octo/alpha' }],
        permissions: { contents: 'write', metadata: 'read' },
      });
    },
  });
  const result = await source({
    owner: 'octo',
    repository: 'alpha',
    permissions: { contents: 'write', metadata: 'read' },
  });
  assert.deepEqual(result.repositories, ['octo/alpha']);
  assert.deepEqual(result.permissions, { contents: 'write', metadata: 'read' });
});

test('a malformed scope echo in the token exchange is rejected', async () => {
  for (const fields of [
    { repositories: [{ name: 'alpha' }] },
    { repositories: 'alpha' },
    { permissions: ['contents'] },
    { permissions: { contents: 1 } },
  ]) {
    const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
      now: () => now,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        return upstream(init, { repositories: [{ full_name: 'octo/alpha' }], ...fields });
      },
    });
    await assert.rejects(
      source({ owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } }),
      /invalid token response/,
    );
  }
});

test('an unverifiable or over-broad mint scope echo is rejected and never cached', async () => {
  const scope = {
    owner: 'octo',
    repository: 'alpha',
    permissions: { contents: 'write', issues: 'read' },
  };
  for (const fields of [
    { repositories: undefined },
    { repositories: [] },
    { repositories: [{ full_name: 'octo/beta' }] },
    { repositories: [{ full_name: 'other/alpha' }] },
    { repositories: [{ full_name: 'octo/alpha' }, { full_name: 'octo/beta' }] },
    { repositories: [{ full_name: 'alpha' }] },
    { permissions: undefined },
    { permissions: {} },
    { permissions: { contents: 'write' } },
    { permissions: { contents: 'read', issues: 'read' } },
    { permissions: { contents: 'admin', issues: 'read' } },
    { permissions: { contents: 'write', issues: 'read', members: 'read' } },
    { permissions: { contents: 'bogus', issues: 'read' } },
  ]) {
    let bad = true;
    let calls = 0;
    const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
      now: () => now,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
        calls++;
        return upstream(init, bad ? fields : {});
      },
    });
    await assert.rejects(source(scope), /invalid token response/);
    bad = false;
    assert.equal((await source(scope)).token, token);
    assert.equal(calls, 2);
  }
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
    await assert.rejects(
      source({ owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } }),
      (error) => {
        assert.match(error.message, new RegExp(`GitHub ${status}: Rejected`));
        for (const secret of [pem, jwt, token]) assert.ok(!error.message.includes(secret));
        return true;
      },
    );
  }
});

test('errors redact indexed tokens still shared by another scope during refresh', async () => {
  const cachedToken = 'fixture-shared-credential';
  let fail = false;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      return fail
        ? Response.json({ message: `Rejected prefix${cachedToken}suffix` }, { status: 503 })
        : upstream(init, { token: cachedToken });
    },
  });
  const alpha = { owner: 'octo', repository: 'alpha', permissions: { contents: 'write' } };
  await source(alpha);
  await source({ ...alpha, repository: 'beta' });
  fail = true;
  await assert.rejects(source({ ...alpha, force: true }), {
    message: 'GitHub 503: Rejected prefix[redacted]suffix',
  });
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
        return upstream(init);
      },
    });
    try {
      const result = await call(
        config.socketPath,
        '/token?repository=alpha&owner=octo&permissions=metadata%3Aread',
      );
      assert.deepEqual(JSON.parse(result.body), {
        token,
        expiresAt: new Date(now + 3600_000).toISOString(),
        installationId: 456,
        appSlug: 'cairnwright',
        repositories: ['octo/alpha'],
        permissions: { metadata: 'read' },
      });
      assert.ok(!result.body.includes(pem));
      assert.ok(!result.body.includes(jwt));
      const health = await call(config.socketPath, '/health');
      assert.ok(!health.body.includes(token));
      const failure = await call(
        config.socketPath,
        '/token?repository=alpha&owner=octo&permissions=metadata%3Aread',
        {
          'x-cairn-refresh': '1',
        },
      );
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
      const result = await call(
        config.socketPath,
        '/token?repository=alpha&owner=octo&permissions=metadata%3Aread',
      );
      assert.equal(result.status, 502);
      if (i === 0) assert.match(result.body, /GitHub 503: Rejected/);
      for (const secret of [pem, jwt, token]) assert.ok(!result.body.includes(secret));
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a scoped mint narrows the token to its repository and permissions, cached per scope', async () => {
  const bodies = [];
  let calls = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      calls++;
      bodies.push(init.body === undefined ? null : JSON.parse(init.body));
      return upstream(init, { token: `scoped-${calls}` });
    },
  });
  const alpha = {
    owner: 'octo',
    repository: 'alpha',
    permissions: { contents: 'write', issues: 'read' },
  };
  assert.equal((await source(alpha)).token, 'scoped-1');
  assert.deepEqual(bodies.at(-1), {
    repositories: ['alpha'],
    permissions: { contents: 'write', issues: 'read' },
  });
  assert.equal((await source({ ...alpha, repository: 'beta' })).token, 'scoped-2');
  assert.deepEqual(bodies.at(-1).repositories, ['beta']);
  assert.equal((await source(alpha)).token, 'scoped-1');
  assert.equal((await source({ ...alpha, force: true })).token, 'scoped-3');
  assert.equal(
    (await source({ owner: 'octo', repository: 'gamma', permissions: { contents: 'read' } })).token,
    'scoped-4',
  );
  assert.deepEqual(bodies.at(-1), {
    repositories: ['gamma'],
    permissions: { contents: 'read' },
  });
  assert.equal(calls, 4);
});

test('a malformed request target answers 400 and leaves the mint healthy', async (t) => {
  const config = await fixture(t);
  let exchanges = 0;
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const bad = await call(config.socketPath, 'http://', {}, 5000);
  assert.equal(bad.status, 400);
  assert.ok(!bad.body.includes(token));
  assert.equal((await call(config.socketPath, '/health')).status, 200);
  assert.equal(exchanges, 0);
});

test('the socket refuses malformed repository and owner names', async (t) => {
  const config = await fixture(t);
  let exchanges = 0;
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const path of [
    '/token?repository=.&owner=octo&permissions=metadata%3Aread',
    '/token?repository=..&owner=octo&permissions=metadata%3Aread',
    '/token?repository=alpha&owner=.&permissions=metadata%3Aread',
    '/token?repository=alpha&owner=..&permissions=metadata%3Aread',
    '/token?repository=repo&owner=invalid_owner&repository_id=42&permissions=metadata%3Aread',
  ]) {
    const result = await call(config.socketPath, path);
    assert.equal(result.status, 400, path);
    assert.ok(!result.body.includes(token));
  }
  assert.equal(exchanges, 0);
});

test('a /token request without a repository is refused; the mint never reaches GitHub', async (t) => {
  const config = await fixture(t);
  let exchanges = 0;
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const path of [
    '/token',
    '/token?refresh=1',
    '/token?permissions=metadata%3Aread',
    '/token?permissions=contents%3Awrite',
    '/token?repository=alpha',
    '/token?repository=alpha&owner=octo',
    '/token?repository=alpha&permissions=metadata%3Aread',
    '/token?owner=octo&permissions=metadata%3Aread',
  ]) {
    const result = await call(config.socketPath, path);
    assert.equal(result.status, 400, path);
    assert.ok(!result.body.includes(token));
  }
  const scoped = await call(
    config.socketPath,
    '/token?repository=alpha&owner=octo&permissions=metadata%3Aread',
  );
  assert.equal(scoped.status, 200);
  assert.equal(JSON.parse(scoped.body).token, token);
  assert.equal(exchanges, 1);
});

test('the socket refuses repeated repository or permissions parameters', async (t) => {
  const config = await fixture(t);
  let exchanges = 0;
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const path of [
    '/token?repository=alpha&repository=alpha&owner=octo&permissions=contents%3Aread',
    '/token?repository=alpha&repository=beta&owner=octo&permissions=contents%3Aread',
    '/token?repository=alpha&owner=octo&owner=octo&permissions=contents%3Aread',
    '/token?repository=alpha&owner=octo&permissions=contents%3Aread&permissions=issues%3Aread',
    '/token?repository=alpha&owner=octo&permissions=contents%3Aread&permissions=',
  ]) {
    const result = await call(config.socketPath, path);
    assert.equal(result.status, 400, path);
    assert.ok(!result.body.includes(token));
  }
  assert.equal(exchanges, 0);
});

test('only a repo-not-installed 422 reaches the socket as a 422', async (t) => {
  const config = await fixture(t);
  for (const [message, expected] of [
    [
      'There is at least one repository that does not exist or is not accessible to the parent installation.',
      422,
    ],
    ['The permissions requested are not granted to this installation.', 502],
    ['The GitHub App is not installed on this account.', 502],
    ['Validation Failed', 502],
  ]) {
    const server = await startMint(config, {
      now: () => now,
      fetchImpl: async (url) =>
        url.endsWith('/app')
          ? Response.json({ slug: 'cairnwright' })
          : Response.json({ message }, { status: 422 }),
    });
    try {
      const result = await call(
        config.socketPath,
        '/token?repository=alpha&owner=octo&permissions=metadata%3Aread',
      );
      assert.equal(result.status, expected, message);
      if (expected === 422) assert.equal(JSON.parse(result.body).error, 'repo-not-installed');
      assert.ok(!result.body.includes(token));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('the token source refuses a mint that names no repository', async () => {
  let exchanges = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  await assert.rejects(source(), /repository/);
  await assert.rejects(source({ owner: 'octo', permissions: { contents: 'write' } }), /repository/);
  await assert.rejects(source({ force: true }), /repository/);
  await assert.rejects(
    source({ repository: 'alpha', permissions: { contents: 'write' } }),
    /repository/,
  );
  await assert.rejects(source({ owner: 'octo', repository: 'alpha' }), /permissions/);
  assert.equal(exchanges, 0);
});

test('the token source rejects malformed scope before any upstream exchange', async () => {
  let exchanges = 0;
  const source = createTokenSource({ appId: '123', installationId: 456 }, pem, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      exchanges++;
      return upstream(init);
    },
  });
  for (const scope of [
    { owner: '', repository: 'alpha', permissions: { contents: 'write' } },
    { owner: 'octo', repository: '', permissions: { contents: 'write' } },
    { owner: 'octo', repository: '.', permissions: { contents: 'write' } },
    { owner: 'octo', repository: '..', permissions: { contents: 'write' } },
    { owner: 'octo', repository: 'bad name', permissions: { contents: 'write' } },
    {
      owner: 'invalid_owner',
      repository: 'repo',
      repositoryId: 42,
      permissions: { contents: 'write' },
    },
    { owner: 'octo', repository: 'alpha', permissions: {} },
    { owner: 'octo', repository: 'alpha', permissions: { contents: 'admin' } },
    { owner: 'octo', repository: 'alpha', permissions: { Contents: 'read' } },
    { owner: 'octo', repository: 'alpha', permissions: null },
    { owner: 'octo', repository: 'alpha', permissions: ['contents:write'] },
  ])
    await assert.rejects(source(scope), /token scope|permissions/);
  assert.equal(exchanges, 0);
  assert.equal(
    (
      await source({
        owner: 'octo',
        repository: 'alpha',
        permissions: { contents: 'write' },
      })
    ).token,
    token,
  );
  assert.equal(exchanges, 1);
});

test('grant names that shadow Object.prototype members parse as ordinary names', async (t) => {
  const config = await fixture(t);
  const bodies = [];
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      bodies.push(init.body === undefined ? null : JSON.parse(init.body));
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const [query, expected] of [
    ['__proto__:read', Object.fromEntries([['__proto__', 'read']])],
    ['constructor:write', Object.fromEntries([['constructor', 'write']])],
  ]) {
    const result = await call(
      config.socketPath,
      `/token?repository=alpha&owner=octo&permissions=${encodeURIComponent(query)}`,
    );
    assert.equal(result.status, 200, query);
    assert.deepEqual(bodies.at(-1).permissions, expected);
    assert.equal(JSON.parse(result.body).token, token);
  }
  const duplicate = await call(
    config.socketPath,
    `/token?repository=alpha&owner=octo&permissions=${encodeURIComponent('constructor:read,constructor:write')}`,
  );
  assert.equal(duplicate.status, 400);
});

test('/token narrows on repository and permissions; malformed scope is rejected', async (t) => {
  const config = await fixture(t);
  const bodies = [];
  const server = await startMint(config, {
    now: () => now,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/app')) return Response.json({ slug: 'cairnwright' });
      bodies.push(init.body === undefined ? null : JSON.parse(init.body));
      return upstream(init);
    },
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const scoped = await call(
    config.socketPath,
    `/token?repository=alpha&owner=octo&permissions=${encodeURIComponent('contents:write,issues:read')}`,
  );
  assert.equal(scoped.status, 200);
  assert.equal(JSON.parse(scoped.body).token, token);
  assert.deepEqual(bodies.at(-1), {
    repositories: ['alpha'],
    permissions: { contents: 'write', issues: 'read' },
  });
  const narrowed = await call(
    config.socketPath,
    `/token?repository=beta&owner=octo&permissions=${encodeURIComponent('contents:read')}`,
  );
  assert.equal(narrowed.status, 200);
  assert.deepEqual(bodies.at(-1), {
    repositories: ['beta'],
    permissions: { contents: 'read' },
  });
  for (const bad of [
    '/token?permissions=metadata%3Aread',
    '/token?repository=beta',
    '/token?repository=beta&owner=octo',
    '/token?repository=beta&permissions=contents%3Aread',
    '/token?repository=bad&owner=bad/name&permissions=contents%3Aread',
    '/token?repository=&owner=octo&permissions=contents%3Aread',
    '/token?repository=alpha&owner=octo&permissions=contents:admin',
    '/token?repository=alpha&owner=octo&permissions=',
    '/token?repository=alpha&owner=octo&permissions=contents',
  ]) {
    const result = await call(config.socketPath, bad);
    assert.equal(result.status, 400, bad);
    assert.ok(!result.body.includes(token));
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
