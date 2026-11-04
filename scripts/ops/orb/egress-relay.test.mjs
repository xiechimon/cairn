import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer, request } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createRelay,
  identityFromCgroup,
  listenOnUnixSocket,
  relayDefaults,
  unixClientIdentity,
  unixPeerPid,
} from './egress-relay.mjs';

const relayScript = new URL('./egress-relay.mjs', import.meta.url).pathname;

function privateDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'egress-relay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function fixture(t, options = {}, { unix = false } = {}) {
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
  let port;
  let socketPath;
  if (unix) {
    socketPath = join(privateDirectory(t), 'egress.sock');
    await listenOnUnixSocket(relay, socketPath);
  } else port = await listen(relay);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    relay.close();
    upstream.close();
  });
  const exchange = (text) =>
    new Promise((resolve, reject) => {
      const socket = unix ? connect(socketPath) : connect(port, '127.0.0.1');
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
  return { targets, relay, port, socketPath, exchange };
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
    allowedPorts: [80, 443, 22, 8787],
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
    allowedPorts: [privatePort],
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
  assert.equal(relayDefaults.maxConnections, 128);
  assert.equal(relayDefaults.maxConnectionsPerClient, 32);
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
  const f = await fixture(t, { allowedPorts: [8787] });
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

for (const port of [80, 443, 22]) {
  for (const method of ['CONNECT', 'GET']) {
    test(`default destination port ${port} allows ${method}`, async (t) => {
      const f = await fixture(t);
      const target =
        method === 'CONNECT' ? `public.example:${port}` : `http://public.example:${port}/`;
      assert.match(
        await f.exchange(
          `${method} ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n${method === 'CONNECT' ? 'ping' : ''}`,
        ),
        /^HTTP\/1.1 200/,
      );
      assert.equal(f.targets[0], `93.184.216.34:${port}`);
    });
  }
}

for (const method of ['CONNECT', 'GET']) {
  test(`unlisted destination ports refuse ${method} before DNS or upstream contact`, async (t) => {
    let resolutions = 0;
    const f = await fixture(t, {
      resolve: async () => {
        resolutions++;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });
    for (const port of [1, 25, 5231, 7890, 8080, 65535]) {
      for (const host of ['public.example', '93.184.216.34']) {
        const target = method === 'CONNECT' ? `${host}:${port}` : `http://${host}:${port}/`;
        assert.match(
          await f.exchange(`${method} ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
          /^HTTP\/1.1 403/,
        );
      }
    }
    assert.equal(resolutions, 0);
    assert.deepEqual(f.targets, []);
  });

  test(`configured destination ports replace defaults for ${method}`, async (t) => {
    const f = await fixture(t, { allowedPorts: [8080] });
    for (const port of [80, 443, 22, 8080]) {
      const target =
        method === 'CONNECT' ? `public.example:${port}` : `http://public.example:${port}/`;
      assert.match(
        await f.exchange(
          `${method} ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n${method === 'CONNECT' && port === 8080 ? 'ping' : ''}`,
        ),
        port === 8080 ? /^HTTP\/1.1 200/ : /^HTTP\/1.1 403/,
      );
    }
    assert.equal(f.targets[0], '93.184.216.34:8080');
    assert.equal(f.targets.length, method === 'CONNECT' ? 1 : 2);
  });
}

test('invalid destination port allowlists fail closed', () => {
  for (const allowedPorts of [[], [0], [-1], [65536], [1.5], [NaN], ['443']]) {
    assert.throws(() => createRelay({ allowedPorts }), /destination port/i);
  }
});

test('unit environment configures destination ports and invalid values fail before listening', () => {
  const unit = readFileSync(new URL('./egress-relay.service', import.meta.url), 'utf8');
  assert.match(unit, /Environment=CAIRN_ORB_ALLOWED_PORTS=80,443,22/);
  for (const value of ['', '443,', '0', '65536', '443,nope']) {
    const result = spawnSync(process.execPath, ['scripts/ops/orb/egress-relay.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_ORB_ALLOWED_PORTS: value },
      timeout: 15000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid destination port allowlist/);
  }
});

const unixRefusedTargets = [
  '10.0.0.1:443',
  '127.0.0.1:443',
  '169.254.169.254:80',
  '100.64.0.5:443',
  '192.168.1.1:22',
  '172.16.0.1:443',
  '[::1]:443',
  '[fe80::1]:443',
  '[fd00::1]:443',
  '[::ffff:127.0.0.1]:443',
];
for (const target of unixRefusedTargets) {
  test(`unix client CONNECT to ${target} gets the same 403 as a TCP client`, async (t) => {
    const unix = await fixture(t, {}, { unix: true });
    const tcp = await fixture(t);
    const request = `CONNECT ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n`;
    const unixAnswer = await unix.exchange(request);
    assert.match(unixAnswer, /^HTTP\/1.1 403/);
    assert.equal(unixAnswer, await tcp.exchange(request));
    assert.deepEqual(unix.targets, []);
  });
}

test('unix client forward requests to metadata and private hosts are refused', async (t) => {
  const f = await fixture(t, {}, { unix: true });
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/']) {
    assert.match(
      await f.exchange(`GET ${url} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
      /^HTTP\/1.1 403/,
    );
  }
  assert.deepEqual(f.targets, []);
});

test('unix client hostnames resolving to private or mixed answers are refused after DNS', async (t) => {
  for (const answers of [
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '169.254.169.254', family: 4 }],
    [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ],
  ]) {
    const f = await fixture(t, { resolve: async () => answers }, { unix: true });
    assert.match(
      await f.exchange('CONNECT rebind.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
      /^HTTP\/1.1 403/,
    );
    assert.deepEqual(f.targets, []);
  }
});

test('unix client destination ports outside the allowlist are refused before DNS', async (t) => {
  let resolutions = 0;
  const f = await fixture(
    t,
    {
      resolve: async () => {
        resolutions++;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    },
    { unix: true },
  );
  for (const target of ['github.com:25', 'github.com:8080', '93.184.216.34:7890']) {
    assert.match(
      await f.exchange(`CONNECT ${target} HTTP/1.1\r\nHost: ignored\r\n\r\n`),
      /^HTTP\/1.1 403/,
    );
  }
  assert.equal(resolutions, 0);
  assert.deepEqual(f.targets, []);
});

test('unix client allowed public CONNECT and forward requests reach the pinned upstream', async (t) => {
  const f = await fixture(t, {}, { unix: true });
  assert.match(
    await f.exchange('CONNECT github.com:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping'),
    /^HTTP\/1.1 200.*\r\n\r\nping/s,
  );
  assert.match(
    await f.exchange('GET http://github.com/ HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 200/,
  );
  assert.equal(f.targets[0], '93.184.216.34:443');
  assert.equal(f.targets[1], '93.184.216.34:80');
});

test('unix client malformed requests still get 400 and the relay keeps serving', async (t) => {
  const f = await fixture(t, {}, { unix: true });
  for (const line of ['CONNECT user:password@public.example:443', 'GET /relative']) {
    assert.match(await f.exchange(`${line} HTTP/1.1\r\nHost: ignored\r\n\r\n`), /^HTTP\/1.1 400/);
  }
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping'),
    /^HTTP\/1.1 200/,
  );
});

test('unix mode skips the client subnet check that TCP mode still enforces', async (t) => {
  const config = { subnet: relayDefaults.subnet };
  const tcp = await fixture(t, config);
  const unix = await fixture(t, config, { unix: true });
  const request = 'CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping';
  assert.match(await tcp.exchange(request), /^HTTP\/1.1 403/);
  assert.match(await unix.exchange(request), /^HTTP\/1.1 200/);
  assert.deepEqual(tcp.targets, []);
});

test('container cgroup text becomes an orb quota identity', () => {
  const id = 'a'.repeat(64);
  assert.equal(identityFromCgroup(`0::/user.slice/libpod-${id}.scope/container\n`), `orb:${id}`);
  assert.equal(identityFromCgroup('0::/user.slice/user-1000.slice\n'), 'unknown');
});

test('one unix client cannot spend another client connection quota', async (t) => {
  let identity = 'orb:aaaaaaaaaaaa';
  const f = await fixture(
    t,
    {
      idleTimeout: 1000,
      maxConnections: 4,
      maxConnectionsPerClient: 1,
      clientIdentity: () => identity,
    },
    { unix: true },
  );
  const held = connect(f.socketPath);
  await once(held, 'connect');
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 503/,
  );
  identity = 'orb:bbbbbbbbbbbb';
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping'),
    /^HTTP\/1.1 200/,
  );
  const closed = once(held, 'close');
  held.destroy();
  await closed;
  identity = 'orb:aaaaaaaaaaaa';
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\nping'),
    /^HTTP\/1.1 200/,
  );
});

test('a unix peer pid is the other process holding the socket', async (t) => {
  const seen = [];
  const f = await fixture(
    t,
    {
      idleTimeout: 1000,
      clientIdentity: (socket) => {
        seen.push(unixPeerPid(socket));
        return 'orb:peer';
      },
    },
    { unix: true },
  );
  const child = spawn(process.execPath, [
    '-e',
    `const {connect}=require('node:net'); const socket=connect(${JSON.stringify(f.socketPath)}); socket.on('connect', () => socket.pause());`,
  ]);
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('peer pid missing')), 3000);
    const poll = () => {
      if (seen.length) {
        clearTimeout(timer);
        resolve();
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
  assert.equal(seen[0], child.pid);
});

test('unix peers outside a container share one unknown quota', async (t) => {
  const seen = [];
  const f = await fixture(
    t,
    {
      idleTimeout: 1000,
      maxConnections: 4,
      maxConnectionsPerClient: 1,
      clientIdentity: (socket) => {
        const id = unixClientIdentity(socket);
        seen.push(id);
        return id;
      },
    },
    { unix: true },
  );
  const held = connect(f.socketPath);
  await once(held, 'connect');
  assert.deepEqual(seen, ['unknown']);
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 503/,
  );
  const closed = once(held, 'close');
  held.destroy();
  await closed;
});

test('unix connection limit and header cap apply to socket clients', async (t) => {
  const f = await fixture(
    t,
    { maxHeaderSize: 128, idleTimeout: 100, maxConnections: 1 },
    { unix: true },
  );
  assert.match(
    await f.exchange(`CONNECT public.example:443 HTTP/1.1\r\nX-Large: ${'a'.repeat(256)}\r\n\r\n`),
    /^HTTP\/1.1 431/,
  );
  const idle = connect(f.socketPath);
  await once(idle, 'connect');
  assert.match(
    await f.exchange('CONNECT public.example:443 HTTP/1.1\r\nHost: ignored\r\n\r\n'),
    /^HTTP\/1.1 503/,
  );
  await once(idle, 'close');
});

test('socket file is mode 0600 after listen and removed on close', async (t) => {
  const f = await fixture(t, {}, { unix: true });
  const stats = lstatSync(f.socketPath);
  assert.equal(stats.isSocket(), true);
  assert.equal(stats.mode & 0o777, 0o600);
  await new Promise((resolve) => f.relay.close(resolve));
  assert.equal(existsSync(f.socketPath), false);
});

async function leaveStaleSocket(socketPath) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('node:net').createServer().listen(process.argv[1], () => console.log('ready'))",
      socketPath,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await once(child.stdout, 'data');
  child.kill('SIGKILL');
  await once(child, 'exit');
  assert.equal(lstatSync(socketPath).isSocket(), true);
}

test('a stale socket left by a dead process is replaced', async (t) => {
  const socketPath = join(privateDirectory(t), 'egress.sock');
  await leaveStaleSocket(socketPath);
  const relay = createRelay({});
  t.after(() => relay.close());
  await listenOnUnixSocket(relay, socketPath);
  assert.equal(lstatSync(socketPath).mode & 0o777, 0o600);
});

test('a socket that another process is still serving is not replaced', async (t) => {
  const socketPath = join(privateDirectory(t), 'egress.sock');
  const live = createServer((socket) => {
    socket.on('error', () => socket.destroy());
    socket.end('live');
  });
  live.listen(socketPath);
  await once(live, 'listening');
  t.after(() => live.close());
  const relay = createRelay({});
  await assert.rejects(listenOnUnixSocket(relay, socketPath), /already in use/);
  const probe = connect(socketPath);
  let answer = '';
  probe.on('data', (chunk) => {
    answer += chunk;
  });
  await once(probe, 'close');
  assert.equal(answer, 'live');
});

test('a regular file, directory or symlink at the socket path is never removed', async (t) => {
  const directory = privateDirectory(t);
  const file = join(directory, 'file');
  writeFileSync(file, 'precious');
  const folder = join(directory, 'folder');
  mkdirSync(folder);
  const link = join(directory, 'link');
  symlinkSync(file, link);
  for (const path of [file, folder, link]) {
    const relay = createRelay({});
    await assert.rejects(listenOnUnixSocket(relay, path), /not a socket/);
    assert.equal(relay.listening, false);
  }
  assert.equal(readFileSync(file, 'utf8'), 'precious');
  assert.equal(lstatSync(folder).isDirectory(), true);
  assert.equal(lstatSync(link).isSymbolicLink(), true);
});

test('socket directories reachable by group or others, symlinked, missing or relative are refused', async (t) => {
  const base = privateDirectory(t);
  for (const mode of [0o770, 0o707, 0o777, 0o720, 0o755, 0o750, 0o711, 0o701]) {
    const directory = join(base, `mode-${mode.toString(8)}`);
    mkdirSync(directory);
    chmodSync(directory, mode);
    await assert.rejects(
      listenOnUnixSocket(createRelay({}), join(directory, 'egress.sock')),
      /Insecure socket directory/,
    );
    assert.equal(existsSync(join(directory, 'egress.sock')), false);
  }
  const real = join(base, 'real');
  mkdirSync(real, { mode: 0o700 });
  const link = join(base, 'link');
  symlinkSync(real, link);
  await assert.rejects(listenOnUnixSocket(createRelay({}), join(link, 'egress.sock')), /Insecure/);
  await assert.rejects(
    listenOnUnixSocket(createRelay({}), join(base, 'missing', 'egress.sock')),
    /ENOENT/,
  );
  await assert.rejects(listenOnUnixSocket(createRelay({}), 'egress.sock'), /must be absolute/);
});

test('a private 0700 socket directory is accepted', async (t) => {
  const directory = join(privateDirectory(t), 'run');
  mkdirSync(directory, { mode: 0o700 });
  const relay = createRelay({});
  t.after(() => relay.close());
  await listenOnUnixSocket(relay, join(directory, 'egress.sock'));
  assert.equal(relay.listening, true);
});

async function startUnixRelayProcess(t, socketPath, extraEnv = {}) {
  const child = spawn(process.execPath, [relayScript], {
    env: { ...process.env, CAIRN_ORB_EGRESS_SOCKET: socketPath, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  return child;
}

async function exchangeOverSocket(socketPath, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let data = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('test timeout')));
    socket.on('error', reject);
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('close', () => resolve(data));
    socket.on('connect', () => socket.write(text));
  });
}

test('the relay process survives unix connections and removes its socket on SIGTERM', async (t) => {
  const socketPath = join(privateDirectory(t), 'egress.sock');
  const child = await startUnixRelayProcess(t, socketPath);
  const [banner] = await once(child.stdout, 'data');
  assert.match(String(banner), /listening on unix socket/);
  assert.equal(lstatSync(socketPath).mode & 0o777, 0o600);
  for (const target of ['10.0.0.1:443', '169.254.169.254:80', 'github.com:25', '127.0.0.1:443']) {
    assert.match(
      await exchangeOverSocket(socketPath, `CONNECT ${target} HTTP/1.1\r\nHost: x\r\n\r\n`),
      /^HTTP\/1.1 403/,
    );
  }
  assert.equal(child.exitCode, null);
  child.kill('SIGTERM');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(existsSync(socketPath), false);
});

test('the relay process refuses an insecure directory or a non-socket path before serving', async (t) => {
  const base = privateDirectory(t);
  const open = join(base, 'open');
  mkdirSync(open);
  chmodSync(open, 0o777);
  const file = join(base, 'file');
  writeFileSync(file, 'precious');
  for (const [socketPath, pattern] of [
    [join(open, 'egress.sock'), /Insecure socket directory/],
    [file, /not a socket/],
    ['relative.sock', /must be absolute/],
    ['', /must be absolute/],
  ]) {
    const result = spawnSync(process.execPath, [relayScript], {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_ORB_EGRESS_SOCKET: socketPath },
      timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
  }
  assert.equal(readFileSync(file, 'utf8'), 'precious');
});

test('unix mode still rejects invalid destination port allowlists before listening', async (t) => {
  const socketPath = join(privateDirectory(t), 'egress.sock');
  const result = spawnSync(process.execPath, [relayScript], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_ORB_EGRESS_SOCKET: socketPath, CAIRN_ORB_ALLOWED_PORTS: '0' },
    timeout: 15000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid destination port allowlist/);
  assert.equal(existsSync(socketPath), false);
});

for (const [name, activation] of [
  ['missing descriptor metadata', {}],
  [
    'foreign listener pid',
    { LISTEN_PID: '1', LISTEN_FDS: '1', LISTEN_FDNAMES: 'cairn-orb-egress' },
  ],
  [
    'extra listener descriptors',
    { LISTEN_PID: 'self', LISTEN_FDS: '2', LISTEN_FDNAMES: 'cairn-orb-egress:extra' },
  ],
  ['wrong named descriptor', { LISTEN_PID: 'self', LISTEN_FDS: '1', LISTEN_FDNAMES: 'foreign' }],
]) {
  test(`socket activation refuses ${name} before creating a listener`, (t) => {
    const socketPath = join(privateDirectory(t), 'egress.sock');
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { pathToFileURL } from 'node:url';
      if (process.env.LISTEN_PID === 'self') process.env.LISTEN_PID = String(process.pid);
      process.argv[1] = ${JSON.stringify(relayScript)};
      await import(pathToFileURL(process.argv[1]));
    `,
      ],
      {
        env: {
          ...process.env,
          LISTEN_PID: '',
          LISTEN_FDS: '',
          LISTEN_FDNAMES: '',
          ...activation,
          CAIRN_ORB_SOCKET_ACTIVATION: '1',
          CAIRN_ORB_EGRESS_SOCKET: socketPath,
        },
        encoding: 'utf8',
        timeout: 1500,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /activation/i);
    assert.equal(existsSync(socketPath), false);
  });
}
