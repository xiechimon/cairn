import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer, request } from 'node:http';
import { connect, createServer } from 'node:net';
import { test } from 'node:test';
import { createRelay, relayDefaults } from './egress-relay.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function fixture(t, options = {}) {
  const targets = [];
  const upstream = createHttpServer();
  const sockets = new Set();
  upstream.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  upstream.on('connect', (req, socket, head) => {
    targets.push(req.url);
    if (options.upstreamHandler) {
      options.upstreamHandler(req, socket, head);
      return;
    }
    socket.on('end', () => socket.end());
    socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', (data) => {
      if (data.toString().startsWith('GET ')) {
        targets.push(data.toString());
        socket.end('HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\npublic');
      } else socket.write(data);
    });
  });
  const upstreamPort = await listen(upstream);
  const relay = createRelay({
    subnet: '127.0.0.0/8',
    upstreamPort,
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    ...options,
  });
  const port = await listen(relay);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    relay.close();
    upstream.close();
  });
  const exchange = (text) =>
    new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      let data = '';
      socket.setTimeout(2000, () => socket.destroy(new Error('test timeout')));
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        data += chunk;
        if (data.includes('ping') || /HTTP\/1.1 (?!200)/.test(data) || data.endsWith('public'))
          socket.end();
      });
      socket.on('close', () => resolve(data));
      socket.on('connect', () => socket.write(text));
    });
  return { targets, relay, port, exchange };
}

test('allowed public CONNECT tunnels bytes through a pinned upstream IP', async (t) => {
  const f = await fixture(t);
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: public.example\r\n\r\nping'),
    /200.*\r\n\r\nping/s,
  );
  assert.deepEqual(f.targets, ['93.184.216.34:443']);
});

test('absolute-URI HTTP uses a pinned CONNECT tunnel and preserves the origin host', async (t) => {
  const f = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: f.port,
        path: 'http://public.example/path?q=1',
        headers: { host: 'ignored', 'proxy-authorization': 'secret' },
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
  assert.deepEqual(result, { status: 200, body: 'public' });
  assert.equal(f.targets[0], '93.184.216.34:80');
  assert.match(f.targets[1], /GET \/path\?q=1 HTTP\/1.1/);
  assert.match(f.targets[1], /host: public.example/i);
  assert.doesNotMatch(f.targets[1], /secret|ignored/);
});

const refused = [
  '0.0.0.0',
  '0.1.2.3',
  '127.0.0.1',
  '127.255.255.255',
  '10.0.0.1',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.0.1',
  '169.254.1.1',
  '100.64.0.1',
  '100.127.255.255',
  '224.0.0.1',
  '239.255.255.255',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fdff::1',
  'fe80::1',
  'febf::1',
  'ff02::1',
];
for (const address of [
  ...refused,
  ...refused.filter((ip) => !ip.includes(':')).map((ip) => `::ffff:${ip}`),
  '::ffff:7f00:1',
  '::ffff:a00:1',
]) {
  test(`refused destination ${address} returns 403 without reaching upstream`, async (t) => {
    const f = await fixture(t, {
      resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
    });
    assert.match(
      await f.exchange('CONNECT denied.example:443 HTTP/1.1\r\nHost: denied.example\r\n\r\n'),
      /^HTTP\/1.1 403/,
    );
    assert.deepEqual(f.targets, []);
  });
}

test('every DNS answer is checked and literal private targets bypass no checks', async (t) => {
  const f = await fixture(t, {
    resolve: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ],
  });
  for (const target of [
    'mixed.example:443',
    '127.0.0.1:8787',
    '[::ffff:127.0.0.1]:8787',
    '10.203.0.1:8787',
  ]) {
    assert.match(
      await f.exchange(`CONNECT ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
      /^HTTP\/1.1 403/,
    );
  }
  assert.match(
    await f.exchange('GET http://127.0.0.1:8787/ HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 403/,
  );
  assert.deepEqual(f.targets, []);
});

test('DNS rebinding never performs a second resolution or connects to private services', async (t) => {
  let resolutions = 0;
  let privateConnections = 0;
  const privateServer = createServer((socket) => {
    privateConnections++;
    socket.destroy();
  });
  const privatePort = await listen(privateServer);
  t.after(() => privateServer.close());
  const f = await fixture(t, {
    resolve: async () => [
      { address: ++resolutions === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 },
    ],
  });
  assert.match(
    await f.exchange(`CONNECT rebind.example:${privatePort} HTTP/1.1\r\nHost: ignored\r\n\r\nping`),
    /^HTTP\/1.1 200/,
  );
  assert.match(
    await f.exchange(`CONNECT rebind.example:${privatePort} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
    /^HTTP\/1.1 403/,
  );
  assert.equal(resolutions, 2);
  assert.deepEqual(f.targets, [`93.184.216.34:${privatePort}`]);
  assert.equal(privateConnections, 0);
});

test('relay defaults bind only the bridge and accept only the container subnet', async (t) => {
  assert.equal(relayDefaults.host, '10.203.0.1');
  assert.equal(relayDefaults.subnet, '10.203.0.0/24');
  const f = await fixture(t, { subnet: relayDefaults.subnet });
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 403/,
  );
  assert.deepEqual(f.targets, []);
});

test('header cap, idle timeout and concurrent connection limit bound relay resources', async (t) => {
  const f = await fixture(t, { maxHeaderSize: 128, idleTimeout: 100, maxConnections: 1 });
  assert.match(
    await f.exchange(`CONNECT public.example:443 HTTP/1.1\r\nX-Large: ${'a'.repeat(256)}\r\n\r\n`),
    /^HTTP\/1.1 431/,
  );
  const idle = connect(f.port, '127.0.0.1');
  await once(idle, 'connect');
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 503/,
  );
  await once(idle, 'close');
  assert.deepEqual(f.targets, []);
});

test('large HTTP responses and request bodies survive the pinned tunnel', async (t) => {
  const body = 'x'.repeat(2 * 1024 * 1024);
  let received = '';
  const origin = createHttpServer((req, res) => {
    req.on('data', (chunk) => {
      received += chunk;
    });
    req.on('end', () => {
      res.end(body);
    });
  });
  const originPort = await listen(origin);
  t.after(() => origin.close());
  const f = await fixture(t, {
    upstreamHandler: (_req, socket, head) => {
      const originSocket = connect(originPort, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        if (head.length) originSocket.write(head);
        socket.pipe(originSocket).pipe(socket);
      });
      socket.on('close', () => originSocket.destroy());
      originSocket.on('error', () => socket.destroy());
    },
  });
  const result = await new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: f.port, method: 'POST', path: 'http://public.example/upload' },
      (res) => {
        let result = '';
        res.on('data', (chunk) => {
          result += chunk;
        });
        res.on('end', () => resolve(result));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end('upload payload');
  });
  assert.equal(result, body);
  assert.equal(received, 'upload payload');
  assert.deepEqual(f.targets, ['93.184.216.34:80']);
});

test('public IPv6 tunnels use bracketed IP authorities without resolving literals', async (t) => {
  const f = await fixture(t, {
    resolve: async () => {
      throw new Error('must not resolve');
    },
  });
  assert.match(
    await f.exchange('CONNECT [2606:4700:4700::1111]:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping'),
    /^HTTP\/1.1 200/,
  );
  assert.deepEqual(f.targets, ['[2606:4700:4700::1111]:443']);
});

test('alternate numeric loopback spellings and invalid targets cannot bypass filtering', async (t) => {
  const f = await fixture(t);
  for (const target of ['2130706433:8787', '0x7f000001:8787', '127.1:8787']) {
    assert.match(
      await f.exchange(`CONNECT ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
      /^HTTP\/1.1 403/,
    );
  }
  for (const line of [
    'CONNECT user:password@public.example:443',
    'CONNECT public.example:443/path',
    'GET /relative',
    'GET https://public.example/',
  ]) {
    assert.match(await f.exchange(`${line} HTTP/1.1\r\nHost: ignored\r\n\r\n`), /^HTTP\/1.1 400/);
  }
  assert.deepEqual(f.targets, []);
});

test('DNS failures and empty answers fail closed without upstream traffic', async (t) => {
  for (const resolve of [
    async () => {
      throw new Error('DNS failed');
    },
    async () => [],
  ]) {
    const f = await fixture(t, { resolve });
    assert.match(
      await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
      /^HTTP\/1.1 (403|502)/,
    );
    assert.deepEqual(f.targets, []);
  }
});

test('upstream refusal and oversized headers fail closed', async (t) => {
  for (const response of [
    'HTTP/1.1 403 Forbidden\r\n\r\n',
    `HTTP/1.1 200 OK\r\nX-Large: ${'a'.repeat(2048)}\r\n\r\n`,
  ]) {
    const f = await fixture(t, {
      maxHeaderSize: 1024,
      upstreamHandler: (_req, socket) => socket.end(response),
    });
    assert.match(
      await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
      /^HTTP\/1.1 502/,
    );
  }
});

test('a late DNS result cannot open upstream after client idle expiry', async (t) => {
  let finish;
  const f = await fixture(t, {
    idleTimeout: 50,
    resolve: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  assert.equal(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    '',
  );
  finish([{ address: '93.184.216.34', family: 4 }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.targets, []);
});
