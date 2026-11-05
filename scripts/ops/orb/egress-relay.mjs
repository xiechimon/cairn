import { execFileSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { chmod, lstat, readFile, readlink, unlink } from 'node:fs/promises';
import { Agent, createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { BlockList, connect, isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const relayDefaults = {
  host: '10.203.0.1',
  port: 7890,
  subnet: '10.203.0.0/24',
  upstreamHost: '127.0.0.1',
  upstreamPort: 7890,
  allowedPorts: [80, 443, 22],
  maxHeaderSize: 16 * 1024,
  idleTimeout: 30_000,
  maxConnections: 128,
  maxConnectionsPerClient: 32,
};

const unixListeners = new WeakSet();
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

export function identityFromCgroup(text) {
  const id = /(?:^|\/)libpod-([0-9a-f]{12,64})(?:\.scope)?(?:\/|$)/m.exec(text)?.[1];
  return id ? `orb:${id}` : 'unknown';
}

const peerCred = loadPeerCred();

function loadPeerCred() {
  const binary = join(tmpdir(), `cairn-egress-peercred-${process.versions.modules}.node`);
  try {
    if (!existsSync(binary)) {
      const source = fileURLToPath(new URL('./egress-peercred.c', import.meta.url));
      const include = join(dirname(process.execPath), '../include/node');
      const temporary = `${binary}.${process.pid}`;
      execFileSync(
        'gcc',
        [
          '-shared',
          '-fPIC',
          `-I${include}`,
          '-Wl,--unresolved-symbols=ignore-all',
          source,
          '-o',
          temporary,
        ],
        { stdio: 'ignore' },
      );
      renameSync(temporary, binary);
    }
    return createRequire(import.meta.url)(binary).peerPid;
  } catch {
    return null;
  }
}

export function unixPeerPid(socket) {
  const fd = socket?._handle?.fd;
  if (!peerCred || !Number.isInteger(fd) || fd < 0) return undefined;
  const pid = peerCred(fd);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function unixClientIdentity(socket) {
  const pid = unixPeerPid(socket);
  if (!pid) return 'unknown';
  try {
    return identityFromCgroup(readFileSync(`/proc/${pid}/cgroup`, 'utf8'));
  } catch {
    return 'unknown';
  }
}

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
  if (
    !Array.isArray(config.allowedPorts) ||
    !config.allowedPorts.length ||
    config.allowedPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw new Error('Invalid destination port allowlist');
  if (!Number.isInteger(config.maxConnections) || config.maxConnections < 1)
    throw new Error('Invalid connection limit');
  if (
    Object.hasOwn(options, 'maxConnectionsPerClient') &&
    (!Number.isInteger(options.maxConnectionsPerClient) ||
      options.maxConnectionsPerClient < 1 ||
      options.maxConnectionsPerClient > config.maxConnections)
  )
    throw new Error('Invalid per-client connection limit');
  const maxPerClient = Math.min(
    config.maxConnections,
    config.maxConnectionsPerClient ?? config.maxConnections,
  );
  const allowedPorts = new Set(config.allowedPorts);
  const allowed = new BlockList();
  const [subnet, prefix] = config.subnet.split('/');
  allowed.addSubnet(subnet, Number(prefix), 'ipv4');
  const clients = new Set();
  const clientsByIdentity = new Map();
  const upstreams = new Set();
  const server = createServer({ maxHeaderSize: config.maxHeaderSize });
  server.maxRequestsPerSocket = 1;
  server.headersTimeout = config.idleTimeout;
  server.requestTimeout = config.idleTimeout;
  server.on('connection', (socket) => {
    socket.on('error', () => socket.destroy());
    const viaSocketFile = unixListeners.has(server);
    const refuse = (status) => {
      socket.end(`${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
        socket.destroy(),
      );
    };
    if (
      !viaSocketFile &&
      !allowed.check(socket.remoteAddress, isIP(socket.remoteAddress) === 4 ? 'ipv4' : 'ipv6')
    ) {
      refuse('HTTP/1.1 403 Forbidden');
      return;
    }
    const identity = viaSocketFile
      ? (config.clientIdentity?.(socket) ?? unixClientIdentity(socket))
      : '';
    const identityCount = identity ? (clientsByIdentity.get(identity) ?? 0) : 0;
    if (clients.size >= config.maxConnections || (identity && identityCount >= maxPerClient)) {
      refuse('HTTP/1.1 503 Service Unavailable');
      return;
    }
    clients.add(socket);
    if (identity) clientsByIdentity.set(identity, identityCount + 1);
    socket.setTimeout(config.idleTimeout, () => socket.destroy());
    socket.on('close', () => {
      clients.delete(socket);
      if (!identity) return;
      const remaining = (clientsByIdentity.get(identity) ?? 1) - 1;
      if (remaining > 0) clientsByIdentity.set(identity, remaining);
      else clientsByIdentity.delete(identity);
    });
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
    if (!allowedPorts.has(target.port)) {
      fail(403);
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

async function assertPrivateDirectory(directory) {
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0)
    throw new Error(`Insecure socket directory ${directory}`);
}

function socketAcceptsConnections(socketPath) {
  return new Promise((resolve, reject) => {
    const probe = connect(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', (error) =>
      error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? resolve(false) : reject(error),
    );
  });
}

async function removeStaleSocket(socketPath) {
  let stats;
  try {
    stats = await lstat(socketPath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stats.isSocket() || stats.uid !== process.getuid())
    throw new Error(`Refusing to replace ${socketPath}: not a socket owned by this user`);
  if (await socketAcceptsConnections(socketPath))
    throw new Error(`Socket ${socketPath} is already in use`);
  try {
    await unlink(socketPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function listenOnUnixSocket(server, socketPath) {
  if (!isAbsolute(socketPath)) throw new Error('Socket path must be absolute');
  await assertPrivateDirectory(dirname(socketPath));
  await removeStaleSocket(socketPath);
  unixListeners.add(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  try {
    await chmod(socketPath, 0o600);
    const stats = await lstat(socketPath);
    if (!stats.isSocket() || (stats.mode & 0o777) !== 0o600)
      throw new Error(`Socket ${socketPath} is not mode 0600`);
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function listenOnActivatedSocket(server, socketPath, env = process.env) {
  if (
    env.LISTEN_PID !== String(process.pid) ||
    env.LISTEN_FDS !== '1' ||
    env.LISTEN_FDNAMES !== 'cairn-orb-egress'
  )
    throw new Error('Socket activation requires exactly one named listener for this process');
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath))
    throw new Error('Socket activation requires an absolute socket path');
  await assertPrivateDirectory(dirname(socketPath));
  const socket = await lstat(socketPath);
  if (!socket.isSocket() || socket.uid !== process.getuid() || (socket.mode & 0o777) !== 0o600)
    throw new Error('Socket activation requires an owned physical 0600 socket');
  const descriptor = /^socket:\[(\d+)\]$/.exec(await readlink('/proc/self/fd/3'));
  const listeners = (await readFile('/proc/net/unix', 'utf8')).split('\n').flatMap((line) => {
    const match = /^\S+\s+\S+\s+\S+\s+([0-9a-f]+)\s+0001\s+01\s+(\d+)\s+(.+)$/i.exec(line);
    return match && match[3] === socketPath && (Number.parseInt(match[1], 16) & 0x10000) !== 0
      ? [match[2]]
      : [];
  });
  if (descriptor === null || listeners.length !== 1 || listeners[0] !== descriptor[1])
    throw new Error('Socket activation listener does not match the configured Unix socket');
  unixListeners.add(server);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen({ fd: 3 }, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const server = createRelay({
    allowedPorts: (process.env.CAIRN_ORB_ALLOWED_PORTS ?? relayDefaults.allowedPorts.join(','))
      .split(',')
      .map(Number),
  });
  const socketPath = process.env.CAIRN_ORB_EGRESS_SOCKET;
  const activation = process.env.CAIRN_ORB_SOCKET_ACTIVATION;
  if (activation !== undefined && activation !== '1') {
    console.error('Invalid socket activation mode');
    process.exit(1);
  }
  if (socketPath === undefined && activation === undefined) {
    server.listen(relayDefaults.port, relayDefaults.host);
    server.on('listening', () =>
      console.log(`Filtering relay listening on ${relayDefaults.host}:${relayDefaults.port}`),
    );
  } else {
    try {
      if (activation === '1') await listenOnActivatedSocket(server, socketPath);
      else await listenOnUnixSocket(server, socketPath);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
    console.log(`Filtering relay listening on unix socket ${socketPath}`);
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => server.close(() => process.exit(0)));
  }
}
