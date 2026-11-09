import { createServer, get, type ServerResponse } from 'node:http';
import { type AddressInfo, createConnection } from 'node:net';
import { expect, test } from 'vitest';
import { createHttpDrain } from '../src/shutdown-http.js';

test('drains an active request before the final tracing shutdown', async () => {
  let terminalSpan = false;
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const requestEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = createServer(async (_req, res) => {
    entered?.();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    terminalSpan = true;
    res.end('done');
  });
  const drain = createHttpDrain(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = new Promise<void>((resolve, reject) => {
    get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
  await requestEntered;
  let tracingClosed = false;
  const shutdown = drain(async () => {
    expect(terminalSpan).toBe(true);
    tracingClosed = true;
  });
  const observed = shutdown.then(
    () => null,
    (error: unknown) => error,
  );
  try {
    expect(tracingClosed).toBe(false);
    release?.();
    await response;
    expect(await observed).toBeNull();
    expect(tracingClosed).toBe(true);
  } finally {
    release?.();
    await response;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('ends open event streams so they cannot hold tracing shutdown open', async () => {
  let stream: ServerResponse | undefined;
  const server = createServer((_req, res) => {
    stream = res;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.write('data: ready\n\n');
  });
  const drain = createHttpDrain(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = new Promise<void>((resolve, reject) => {
    get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, (res) => {
      res.once('data', () => resolve());
      res.resume();
    }).on('error', reject);
  });
  await response;
  try {
    const shutdown = drain(async () => {});
    expect(stream?.writableEnded).toBe(true);
    await shutdown;
  } finally {
    stream?.end();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('bounds shutdown when a client never finishes uploading a request body', async () => {
  let entered: (() => void) | undefined;
  const requestEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const server = createServer((req, res) => {
    entered?.();
    req.resume();
    req.on('end', () => res.end('done'));
  });
  const drain = createHttpDrain(server, 30);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = createConnection({
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
  });
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  client.on('error', () => {});
  client.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx');
  await requestEntered;
  let tracingClosed = false;
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      drain(async () => {
        tracingClosed = true;
      }),
      new Promise<never>((_resolve, reject) => {
        guard = setTimeout(
          () => reject(new Error('HTTP drain did not reach tracing shutdown')),
          2000,
        );
      }),
    ]);
    await closed;
    expect(tracingClosed).toBe(true);
    expect(client.destroyed).toBe(true);
  } finally {
    clearTimeout(guard);
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
