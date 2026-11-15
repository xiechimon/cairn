import { createServer, type Server } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, expect, test } from 'vitest';
import { installEnvProxy } from '../src/lib/env-proxy.js';
import { createPublicOAuthFetch } from '../src/services/mcp-servers.js';

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function startProxy(tunnelTo?: number) {
  const seen: string[] = [];
  const proxy = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.end('from-target');
  });
  proxy.on('connect', (request, socket) => {
    seen.push(request.url ?? '');
    if (tunnelTo === undefined) {
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = connect(tunnelTo, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  });
  return { seen, port: await listen(proxy) };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve).closeAllConnections())),
  );
});

test('the server sends built-in fetch through HTTP_PROXY and keeps loopback direct', async () => {
  const target = await listen(createServer((_, response) => response.end('from-target')));
  const proxy = await startProxy(target);
  const original = getGlobalDispatcher();
  try {
    expect(installEnvProxy({})).toBeNull();
    expect(getGlobalDispatcher()).toBe(original);
    expect(installEnvProxy({ HTTP_PROXY: `http://user:secret@127.0.0.1:${proxy.port}` })).toBe(
      `http://127.0.0.1:${proxy.port}`,
    );
    const viaProxy = await globalThis.fetch(`http://127.0.0.2:${target}/`);
    expect(await viaProxy.text()).toBe('from-target');
    expect(proxy.seen).toHaveLength(1);
    expect(proxy.seen[0]).toContain(`127.0.0.2:${target}`);
    const loopback = await globalThis.fetch(`http://127.0.0.1:${target}/`);
    expect(await loopback.text()).toBe('from-target');
    expect(proxy.seen).toHaveLength(1);
  } finally {
    setGlobalDispatcher(original);
  }
});

test('the OAuth fetch goes through HTTPS_PROXY and still refuses a non-public host', async () => {
  const proxy = await startProxy();
  const oauthFetch = createPublicOAuthFetch({ HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` });
  const refused = await oauthFetch('https://10.1.2.3/x').catch((err: unknown) => err);
  expect(String(refused)).toContain('non-public address');
  expect(proxy.seen).toEqual([]);
  await oauthFetch('https://93.184.215.14/x', { signal: AbortSignal.timeout(5000) }).catch(
    () => undefined,
  );
  expect(proxy.seen).toEqual(['93.184.215.14:443']);
});
