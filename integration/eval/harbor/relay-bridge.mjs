import http from 'node:http';
import process from 'node:process';

const socketPath = process.argv[2];
if (!socketPath) throw new Error('Unix socket path required');
const maxBytes = 2 * 1024 * 1024;
const server = http.createServer((request, response) => {
  const route = new URL(request.url || '/', 'http://localhost');
  if (
    request.method !== 'POST' ||
    route.pathname !== '/v1/messages' ||
    !['', '?beta=true'].includes(route.search)
  ) {
    response.writeHead(403).end('Only pinned Messages requests are allowed');
    return;
  }
  const chunks = [];
  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBytes) request.destroy();
    else chunks.push(chunk);
  });
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const upstream = http.request(
      {
        socketPath,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': body.length },
      },
      (result) => {
        response.writeHead(result.statusCode, {
          'content-type': result.headers['content-type'] || 'application/json',
          'cache-control': 'no-store',
        });
        result.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('Parent relay unavailable');
    });
    upstream.end(body);
  });
});
server.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ baseUrl: `http://127.0.0.1:${address.port}` })}\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
