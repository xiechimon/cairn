import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const webRequire = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { build } = await import(webRequire.resolve('vite'));
const bundled = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    minify: false,
    lib: { entry: fileURLToPath(new URL('./ingress.ts', import.meta.url)), formats: ['es'] },
  },
});
const output = Array.isArray(bundled) ? bundled[0] : bundled;
const environment = {
  INSTALLATION_ID: randomUUID(),
  ENVIRONMENT_ID: randomUUID(),
  PUBLIC_ORIGIN: 'https://relay.example',
  HOST_CAPABILITY: randomBytes(32).toString('hex'),
};
const token = randomBytes(32).toString('hex');
const code = randomBytes(24).toString('base64url');
const cookie = `__Host-cairn_relay=${token}`;
const pair = { code, name: 'Phone' };
const body = JSON.stringify(pair);
const invalid = { ok: false, status: 400, error: 'invalid' };
const denied = { ok: false, status: 401, error: 'denied' };
const large = { ok: false, status: 413, error: 'too_large' };
const unavailable = { ok: false, status: 503, error: 'unknown' };
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'ingress-tests',
    host: '127.0.0.1',
    port: 0,
    compatibilityDate: '2026-11-15',
    bindings: { TEST_ENVIRONMENT: JSON.stringify(environment) },
    modules: [
      {
        type: 'ESModule',
        path: 'index.js',
        contents: `import {readRelayIngress} from './ingress.js';
export default {async fetch(input, env) {
  const spec = await input.json();
  const environment = {...JSON.parse(env.TEST_ENVIRONMENT), ...spec.environment};
  let cancelled = false;
  let position = 0;
  const chunks = spec.chunks;
  const stream = chunks && new ReadableStream({
    pull(controller) {
      if (spec.readFailure) return controller.error(new Error('sensitive test exception'));
      if (position < chunks.length) controller.enqueue(new Uint8Array(chunks[position++]));
      else controller.close();
    },
    cancel() {cancelled = true; if (spec.cancelFailure) throw new Error('sensitive cancel');},
  });
  const request = new Request(spec.url ?? environment.PUBLIC_ORIGIN + spec.path, {
    method: spec.method, headers: spec.headers, body: stream ?? spec.body,
  });
  const lock = spec.locked && request.body.getReader();
  try {
    const decision = await readRelayIngress(request, environment);
    return Response.json({decision, cancelled, bodyUsed:request.bodyUsed});
  } finally {lock?.releaseLock();}
}};`,
      },
      { type: 'ESModule', path: 'ingress.js', contents: output.output[0].code },
    ],
  }),
);
after(() => runtime.dispose());

async function call(path, options = {}) {
  const response = await runtime.dispatchFetch('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({
      path,
      method: path === '/pair' ? 'POST' : 'GET',
      headers:
        path === '/connect/host'
          ? { Authorization: `Bearer ${environment.HOST_CAPABILITY}`, Upgrade: 'websocket' }
          : {
              Origin: environment.PUBLIC_ORIGIN,
              ...(path === '/pair'
                ? { 'Content-Type': 'application/json' }
                : { Cookie: cookie, Upgrade: 'websocket' }),
            },
      ...(path === '/pair' ? { body } : {}),
      ...options,
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('all four ingress decisions stay distinct and descriptor/host never expose capability', async () => {
  assert.deepEqual((await call('/descriptor', { headers: {} })).decision, {
    ok: true,
    entry: {
      kind: 'descriptor',
      descriptor: {
        v: 1,
        installationId: environment.INSTALLATION_ID,
        environmentId: environment.ENVIRONMENT_ID,
      },
    },
  });
  assert.deepEqual((await call('/connect/host')).decision, { ok: true, entry: { kind: 'host' } });
  assert.deepEqual((await call('/connect/client')).decision, {
    ok: true,
    entry: { kind: 'client', sessionToken: token },
  });
  assert.deepEqual(
    (await call('/pair', { body: JSON.stringify({ code, name: '  Phone  ' }) })).decision,
    {
      ok: true,
      entry: { kind: 'pair', ...pair },
    },
  );
});

test('malformed configuration fails closed before body reads, including normalized-away ports', async () => {
  const faults = Object.keys(environment).map((key) => ({ [key]: null }));
  faults.push(
    { INSTALLATION_ID: 'bad' },
    { ENVIRONMENT_ID: `A${environment.ENVIRONMENT_ID.slice(1)}` },
    { HOST_CAPABILITY: `A${environment.HOST_CAPABILITY.slice(1)}` },
    { HOST_CAPABILITY: token.slice(1) },
    ...[
      'http://relay.example',
      'https://relay.example/',
      'https://relay.example:443',
      'https://relay.example:444',
      'https://relay.example?',
      'https://relay.example#',
      'https://user@relay.example',
      'https://relay.example/path',
      'https://RELAY.example',
      'https://localhost',
      'https://localhost.',
      'https://a.localhost',
      'https://a.localhost.',
      'https://127.1',
      'https://[::1]',
      'https://0.0.0.0',
      'https://relay.example.evil/',
    ].map((PUBLIC_ORIGIN) => ({ PUBLIC_ORIGIN })),
  );
  for (const fault of faults) {
    const result = await call('/pair', { url: 'https://relay.example/pair', environment: fault });
    assert.deepEqual(result.decision, unavailable, JSON.stringify(fault));
    assert.equal(result.bodyUsed, false);
  }
});

test('exact routes, normalized origins and methods deny query, fragment and alternate dispatch', async () => {
  for (const path of ['/api/teams', '/connect/host/', '/app', '/%70air', '/PAIR']) {
    assert.deepEqual((await call(path)).decision, { ok: false, status: 404, error: 'invalid' });
  }
  for (const path of ['/descriptor', '/pair', '/connect/host', '/connect/client']) {
    assert.deepEqual((await call(path, { method: 'OPTIONS', body: undefined })).decision, {
      ok: false,
      status: 405,
      error: 'invalid',
    });
  }
  for (const url of [
    'https://elsewhere.example/descriptor',
    'http://relay.example/descriptor',
    'https://relay.example/descriptor?x=1',
    'https://relay.example/descriptor?',
    'https://relay.example/descriptor#x',
    'https://relay.example/descriptor#',
    'https://user:password@relay.example/descriptor',
  ]) {
    assert.deepEqual((await call('/descriptor', { url })).decision, invalid, url);
  }
});

test('host transport verifies the complete bearer and refuses browser credentials by presence', async () => {
  for (const Authorization of [
    '',
    `Bearer ${token}`,
    `bearer ${environment.HOST_CAPABILITY}`,
    `Bearer ${environment.HOST_CAPABILITY}, Bearer ${environment.HOST_CAPABILITY}`,
    `Bearer ${environment.HOST_CAPABILITY.slice(1)}`,
    'Bearer not-hex',
  ]) {
    assert.deepEqual(
      (await call('/connect/host', { headers: { Authorization, Upgrade: 'websocket' } })).decision,
      denied,
    );
  }
  assert.deepEqual(
    (await call('/connect/host', { headers: { Upgrade: 'websocket' } })).decision,
    denied,
  );
  for (const header of ['Origin', 'Cookie', 'Sec-WebSocket-Protocol']) {
    assert.deepEqual(
      (
        await call('/connect/host', {
          headers: {
            Authorization: `Bearer ${environment.HOST_CAPABILITY}`,
            Upgrade: 'websocket',
            [header]: '',
          },
        })
      ).decision,
      invalid,
    );
  }
  for (const Upgrade of ['', 'h2c', 'websocket, websocket']) {
    assert.deepEqual(
      (
        await call('/connect/host', {
          headers: {
            Authorization: `Bearer ${environment.HOST_CAPABILITY}`,
            Upgrade,
          },
        })
      ).decision,
      invalid,
    );
  }
});

test('browser routes require exact Origin and nonconflicting metadata; overrides never authorize', async () => {
  for (const path of ['/pair', '/connect/client']) {
    const headers = {
      Origin: environment.PUBLIC_ORIGIN,
      Cookie: cookie,
      Upgrade: 'WebSocket',
      'Content-Type': 'application/json',
    };
    for (const Origin of [
      '',
      'null',
      'https://evil.example',
      'https://relay.example/',
      `${environment.PUBLIC_ORIGIN}, ${environment.PUBLIC_ORIGIN}`,
    ]) {
      assert.deepEqual((await call(path, { headers: { ...headers, Origin } })).decision, invalid);
    }
    const { Origin: _origin, ...withoutOrigin } = headers;
    assert.deepEqual((await call(path, { headers: withoutOrigin })).decision, invalid);
    for (const extra of [
      { Authorization: '' },
      { 'Sec-WebSocket-Protocol': '' },
      { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-origin, same-origin' },
      { 'Sec-Fetch-Dest': 'document' },
      { 'Sec-Fetch-Mode': path === '/pair' ? 'websocket' : 'cors' },
    ]) {
      assert.deepEqual((await call(path, { headers: { ...headers, ...extra } })).decision, invalid);
    }
    assert.equal(
      (
        await call(path, {
          headers: {
            ...headers,
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': path === '/pair' ? 'cors' : 'websocket',
          },
        })
      ).decision.ok,
      true,
    );
  }
});

test('cookie duplicates and malformed values reject before any session authority exists', async () => {
  const headers = {
    Origin: environment.PUBLIC_ORIGIN,
    Upgrade: 'websocket',
    'Content-Type': 'application/json',
  };
  for (const path of ['/pair', '/connect/client']) {
    for (const Cookie of [
      `${cookie}; ${cookie}`,
      `__Host-cairn_relay=bad; ${cookie}`,
      `${cookie}; __Host-cairn_relay=bad`,
      `${cookie}; __Host-cairn_relay`,
      `__Host-cairn_relay="${token}"`,
      `__Host-cairn_relay=%61${token.slice(1)}`,
      `__Host-cairn_relay=A${token.slice(1)}`,
      '__Host-cairn_relay=',
    ])
      assert.deepEqual((await call(path, { headers: { ...headers, Cookie } })).decision, invalid);
  }
  assert.deepEqual((await call('/connect/client', { headers })).decision, denied);
  assert.equal((await call('/pair', { headers })).decision.entry.kind, 'pair');
  assert.equal(
    (
      await call('/connect/client', {
        headers: { ...headers, Cookie: `other=x; ${cookie}; unused=y` },
      })
    ).decision.entry.sessionToken,
    token,
  );
  assert.deepEqual(
    (
      await call('/connect/client', {
        headers: { ...headers, Cookie: `__Host-cairn_relay=${environment.HOST_CAPABILITY}` },
      })
    ).decision,
    { ok: true, entry: { kind: 'client', sessionToken: environment.HOST_CAPABILITY } },
  );
  assert.deepEqual(
    (await call('/connect/client', { headers: { ...headers, Cookie: cookie, Upgrade: 'h2c' } }))
      .decision,
    invalid,
  );
});

test('pairing uses strict existing schema and rejects malformed media, encoding and raw errors', async () => {
  for (const value of [
    {},
    { ...pair, owner: true },
    { ...pair, code: code.slice(1) },
    { ...pair, name: ' ' },
    { ...pair, name: 'x'.repeat(81) },
  ])
    assert.deepEqual((await call('/pair', { body: JSON.stringify(value) })).decision, invalid);
  for (const value of ['', '{', 'null'])
    assert.deepEqual((await call('/pair', { body: value })).decision, invalid);
  const headers = { Origin: environment.PUBLIC_ORIGIN, 'Content-Type': 'application/json' };
  for (const extra of [
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json, application/json' },
    { 'Content-Type': 'application/json; charset=utf-8, text/plain' },
    { 'Content-Type': 'application/json; charset=utf-8, application/json' },
    { 'Content-Type': 'application/json; charset=latin1' },
    { 'Content-Type': 'application/json; charset=utf-8; ignored=1' },
    { 'Content-Length': '-1' },
    { 'Content-Length': '1, 2' },
  ])
    assert.deepEqual(
      (await call('/pair', { headers: { ...headers, ...extra } })).decision,
      invalid,
    );
  for (const type of ['Application/JSON; charset=UTF-8', 'application/json; charset="utf-8"']) {
    assert.deepEqual(
      (await call('/pair', { headers: { ...headers, 'Content-Type': type } })).decision,
      { ok: true, entry: { kind: 'pair', ...pair } },
    );
  }
  assert.deepEqual((await call('/pair', { chunks: [[0xc3, 0x28]] })).decision, invalid);
  assert.deepEqual((await call('/pair', { chunks: [[]], readFailure: true })).decision, invalid);
  assert.deepEqual((await call('/pair', { locked: true })).decision, invalid);
});

test('actual UTF-8 streamed bytes enforce 1024/1025 independently of declared length and cancellation', async () => {
  const encoded = [...new TextEncoder().encode(JSON.stringify({ code, name: 'Phone ☎' }))];
  const exact = [...encoded, ...Array(1024 - encoded.length).fill(32)];
  const split = encoded.findIndex((byte) => byte >= 128) + 1;
  const result = await call('/pair', { chunks: [exact.slice(0, split), exact.slice(split)] });
  assert.deepEqual(result.decision, { ok: true, entry: { kind: 'pair', code, name: 'Phone ☎' } });
  for (const cancelFailure of [false, true]) {
    const over = await call('/pair', { chunks: [exact, [32], [32]], cancelFailure });
    assert.deepEqual(over.decision, large);
    assert.equal(over.cancelled, true);
  }
  assert.deepEqual(
    (
      await call('/pair', {
        chunks: [exact, [32]],
        headers: {
          Origin: environment.PUBLIC_ORIGIN,
          'Content-Type': 'application/json',
          'Content-Length': '1',
        },
      })
    ).decision,
    large,
  );
  const advertised = await call('/pair', {
    headers: {
      Origin: environment.PUBLIC_ORIGIN,
      'Content-Type': 'application/json',
      'Content-Length': '1025',
    },
  });
  assert.deepEqual(advertised.decision, large);
  assert.equal(advertised.bodyUsed, false);
});
