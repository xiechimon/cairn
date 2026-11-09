import { mkdirSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname } from 'node:path';

const mode = process.argv[2];
const socketPath = process.env.EGRESS_SOCKET ?? '/run/egress/proxy.sock';
const allowed = new Set(
  (process.env.EGRESS_ALLOW ?? 'api.anthropic.com:443')
    .split(',')
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean),
);
const maxHeadBytes = 8192;

function pipeBoth(a, b) {
  a.on('error', () => b.destroy());
  b.on('error', () => a.destroy());
  a.pipe(b);
  b.pipe(a);
}

function serveHostSide() {
  const [host, port] = (process.env.EGRESS_UPSTREAM ?? '127.0.0.1:7890').split(':');
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });
  createServer((client) => pipeBoth(client, createConnection(Number(port), host))).listen(
    socketPath,
    () => console.log(`egress relay host side: ${socketPath} -> ${host}:${port}`),
  );
}

function connectTarget(head) {
  const line = head.slice(0, head.indexOf('\r\n'));
  const match = /^CONNECT (\S+) HTTP\/1\.[01]$/.exec(line);
  return match ? match[1].toLowerCase() : null;
}

function serveBridgeSide() {
  const port = Number(process.env.EGRESS_PORT ?? 3128);
  createServer((client) => {
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const text = head.toString('latin1');
      if (!text.includes('\r\n\r\n')) {
        if (head.length > maxHeadBytes) client.destroy();
        return;
      }
      client.off('data', onData);
      client.pause();
      const target = connectTarget(text);
      if (target === null || !allowed.has(target)) {
        console.log(`egress relay refused: ${target ?? 'non-CONNECT request'}`);
        client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const upstream = createConnection(socketPath);
      upstream.write(head);
      pipeBoth(client, upstream);
      client.resume();
    };
    client.on('data', onData);
    client.on('error', () => client.destroy());
  }).listen(port, '0.0.0.0', () =>
    console.log(
      `egress relay bridge side: :${port} -> ${socketPath} for ${[...allowed].join(', ')}`,
    ),
  );
}

if (mode === 'host') serveHostSide();
else if (mode === 'bridge') serveBridgeSide();
else {
  console.error('usage: node egress-relay.mjs host|bridge');
  process.exit(2);
}
