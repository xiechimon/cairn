import { lookup } from 'node:dns/promises';
import { Agent, createServer, request } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { resolve } from 'node:path';

export const relayDefaults = {
  host: '10.203.0.1',
  port: 7890,
  subnet: '10.203.0.0/24',
  upstreamHost: '127.0.0.1',
  upstreamPort: 7890,
  maxHeaderSize: 16 * 1024,
  idleTimeout: 30_000,
  maxConnections: 128,
};

const refused = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['224.0.0.0', 3],
])
  refused.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
])
  refused.addSubnet(address, prefix, 'ipv6');

function publicAddress(address) {
  const family = isIP(address);
  return family !== 0 && !refused.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function headersWithoutHopFields(headers) {
  const excluded = new Set([
    'connection',
    'proxy-connection',
    'proxy-authorization',
    'proxy-authenticate',
    'keep-alive',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    ...(headers.connection || '')
      .toLowerCase()
      .split(',')
      .map((name) => name.trim()),
  ]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
}

function destination(value, tunnel) {
  const url = new URL(tunnel ? `http://${value}` : value);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    url.hash ||
    (tunnel && (!/^(\[[^\]]+\]|[^:/?#]+):\d+$/.test(value) || url.pathname !== '/'))
  ) {
    throw new Error('Invalid proxy target');
  }
  return { url, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) };
}

export function createRelay(options = {}) {
  const config = {
    ...relayDefaults,
    resolve: (host) => lookup(host, { all: true, verbatim: true }),
    ...options,
  };
  const allowed = new BlockList();
  const [subnet, prefix] = config.subnet.split('/');
  allowed.addSubnet(subnet, Number(prefix), 'ipv4');
  const clients = new Set();
  const upstreams = new Set();
  const server = createServer({ maxHeaderSize: config.maxHeaderSize });
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = config.idleTimeout;
  server.requestTimeout = config.idleTimeout;
  server.on('connection', (socket) => {
    socket.on('error', () => socket.destroy());
    if (!allowed.check(socket.remoteAddress, isIP(socket.remoteAddress) === 4 ? 'ipv4' : 'ipv6')) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (clients.size >= config.maxConnections) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    clients.add(socket);
    socket.setTimeout(config.idleTimeout, () => socket.destroy());
    socket.on('close', () => clients.delete(socket));
  });
  server.on('clientError', (error, socket) => {
    socket.end(
      `HTTP/1.1 ${error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });
  const openTunnel = (address, port, client) =>
    new Promise((resolve, reject) => {
      const authority = `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;
      const upstream = request({
        host: config.upstreamHost,
        port: config.upstreamPort,
        method: 'CONNECT',
        path: authority,
        headers: { host: authority },
        agent: false,
        maxHeaderSize: config.maxHeaderSize,
      });
      const cancel = () => upstream.destroy();
      client.once('close', cancel);
      upstream.setTimeout(config.idleTimeout, () =>
        upstream.destroy(new Error('Upstream timeout')),
      );
      upstream.once('error', reject);
      upstream.once('response', (res) => {
        res.destroy();
        reject(new Error('Upstream refused tunnel'));
      });
      upstream.once('connect', (res, socket, head) => {
        client.off('close', cancel);
        if (res.statusCode !== 200 || client.destroyed) {
          socket.destroy();
          reject(new Error('Upstream refused tunnel'));
          return;
        }
        upstreams.add(socket);
        socket.on('close', () => upstreams.delete(socket));
        socket.setTimeout(config.idleTimeout, () => socket.destroy());
        socket.on('error', () => client.destroy());
        client.once('close', () => socket.destroy());
        socket.once('close', () => {
          if (!socket.readableEnded) client.destroy();
        });
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      upstream.end();
    });
  const handle = async (req, res, head) => {
    const client = req.socket;
    if (!clients.has(client)) return;
    const tunnel = res === null;
    const fail = (status) => {
      if (client.destroyed) return;
      if (tunnel)
        client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      else {
        res.writeHead(status, { connection: 'close' });
        res.end();
      }
    };
    let target;
    try {
      target = destination(req.url, tunnel);
    } catch {
      fail(400);
      return;
    }
    let addresses;
    try {
      addresses = isIP(target.hostname)
        ? [{ address: target.hostname }]
        : await config.resolve(target.hostname);
    } catch {
      fail(502);
      return;
    }
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
      fail(403);
      return;
    }
    if (client.destroyed) return;
    let socket;
    try {
      socket = await openTunnel(addresses[0].address, target.port, client);
    } catch {
      fail(502);
      return;
    }
    if (tunnel) {
      client.write('HTTP/1.1 200 Connection established\r\n\r\n');
      if (head.length) socket.write(head);
      client.pipe(socket).pipe(client);
      return;
    }
    const agent = new Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    const outgoing = request(
      {
        hostname: addresses[0].address,
        port: target.port,
        method: req.method,
        path: target.url.pathname + target.url.search,
        headers: {
          ...headersWithoutHopFields(req.headers),
          host: target.url.host,
          connection: 'close',
        },
        agent,
        maxHeaderSize: config.maxHeaderSize,
      },
      (response) => {
        res.writeHead(response.statusCode, {
          ...headersWithoutHopFields(response.headers),
          connection: 'close',
        });
        response.pipe(res);
        response.on('error', () => client.destroy());
      },
    );
    outgoing.on('error', () => {
      if (res.headersSent) client.destroy();
      else fail(502);
    });
    res.on('close', () => {
      outgoing.destroy();
      agent.destroy();
    });
    req.pipe(outgoing);
  };
  server.on('request', (req, res) => {
    void handle(req, res, Buffer.alloc(0));
  });
  server.on('connect', (req, _socket, head) => {
    void handle(req, null, head);
  });
  const close = server.close.bind(server);
  server.close = (callback) => {
    for (const socket of [...clients, ...upstreams]) socket.destroy();
    return close(callback);
  };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const server = createRelay();
  server.listen(relayDefaults.port, relayDefaults.host);
  server.on('listening', () =>
    console.log(`Filtering relay listening on ${relayDefaults.host}:${relayDefaults.port}`),
  );
}
