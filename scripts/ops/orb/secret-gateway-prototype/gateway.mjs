import { createServer } from 'node:http';
import { createServer as createTlsServer, request } from 'node:https';
import { createServer as createAdminServer } from 'node:net';

export function gateway({ tls, upstreamCa, upstreamPort, audit }) {
  const grants = new Map();
  const sockets = new Set();
  const servers = [];
  const record = (decision, reason) => audit.push({ decision, reason, header: 'authorization' });
  const track = (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  };
  const admin = createAdminServer((socket) => {
    track(socket);
    let frame = '';
    let registered;
    socket.on('data', (chunk) => {
      frame += chunk;
      if (frame.length > 8192 || registered) return socket.destroy();
      if (!frame.endsWith('\n')) return;
      try {
        const grant = JSON.parse(frame);
        frame = '';
        if (
          !['a', 'b'].includes(grant.guest) ||
          grants.has(grant.guest) ||
          grant.origin !== 'https://allowed.test' ||
          grant.header !== 'authorization' ||
          grant.template !== 'Bearer {secret}' ||
          !/^cairn-placeholder-[a-f0-9]{64}$/.test(grant.placeholder) ||
          !/^[a-f0-9]{64}$/.test(grant.value) ||
          [...grants.values()].some((entry) => entry.placeholder === grant.placeholder)
        )
          throw new Error('Invalid registration');
        registered = grant;
        grants.set(grant.guest, grant);
        record('accepted', 'registration');
        socket.write('{"accepted":true}\n');
      } catch {
        record('refused', 'registration');
        socket.end('{"accepted":false}\n');
      }
    });
    socket.on('close', () => {
      if (!registered) return;
      grants.delete(registered.guest);
      for (const active of sockets) {
        if (active.gatewayGuest === registered.guest) active.destroy();
      }
      record('revoked', 'admin-disconnect');
    });
  });
  servers.push(admin);

  const listener = (guest) => {
    const proxy = createServer();
    const intercepted = createTlsServer({ ...tls, ALPNProtocols: ['http/1.1'] });
    servers.push(proxy, intercepted);
    proxy.on('connection', track);
    proxy.on('request', (_req, res) => res.writeHead(403).end());
    proxy.on('connect', (req, socket, head) => {
      if (req.url !== 'allowed.test:443' || !grants.has(guest)) {
        record('refused', 'connect-authority-or-grant');
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      socket.gatewayGuest = guest;
      socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
      if (head.length) socket.unshift(head);
      intercepted.emit('connection', socket);
    });
    intercepted.on('tlsClientError', () => record('refused', 'downstream-tls'));
    intercepted.on('request', (req, res) => {
      const grant = grants.get(guest);
      const headers = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        headers.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]]);
      const bound = headers.filter(([name]) => name === 'authorization');
      if (
        !grant ||
        req.socket.servername !== 'allowed.test' ||
        headers.filter(([name]) => name === 'host').length !== 1 ||
        req.headers.host !== 'allowed.test' ||
        !/^\/(?!\/)/.test(req.url) ||
        ['TRACE', 'CONNECT'].includes(req.method) ||
        req.headers.upgrade ||
        bound.length !== 1 ||
        bound[0][1] !== `Bearer ${grant.placeholder}` ||
        req.url.includes(grant.placeholder) ||
        headers.some(
          ([name, value]) => name !== 'authorization' && value.includes(grant.placeholder),
        )
      ) {
        record('refused', 'request-policy');
        res.writeHead(403, { connection: 'close' }).end();
        return;
      }
      const outgoing = request(
        {
          hostname: '127.0.0.1',
          port: upstreamPort(),
          servername: 'allowed.test',
          ca: upstreamCa,
          method: req.method,
          path: req.url,
          headers: {
            host: 'allowed.test',
            authorization: `Bearer ${grant.value}`,
            connection: 'close',
          },
          agent: false,
        },
        (upstream) => {
          record('substituted', 'authorized');
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        },
      );
      outgoing.on('socket', (socket) => {
        socket.gatewayGuest = guest;
        track(socket);
      });
      outgoing.on('error', () => {
        record('refused', 'upstream-tls-or-transport');
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(outgoing);
    });
    for (const server of [proxy, intercepted]) {
      server.on('clientError', (_error, socket) => socket.destroy());
      server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
      server.headersTimeout = 3000;
      server.requestTimeout = 3000;
    }
    return proxy;
  };
  return {
    admin,
    listener,
    close: () => {
      for (const socket of sockets) socket.destroy();
      for (const server of servers) server.close();
    },
  };
}
