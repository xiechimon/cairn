import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { describe, expect, test } from 'vitest';
import { createDaemonLogger } from '../src/log.js';
import { detectProxyEnv, loopbackNoProxy, setupProxy } from '../src/proxy.js';

describe('loopbackNoProxy', () => {
  test('127.0.0.1 server merged into existing NO_PROXY without swallowing entries', () => {
    expect(loopbackNoProxy({ NO_PROXY: 'example.com' }, 'http://127.0.0.1:8791')).toBe(
      'example.com,127.0.0.1',
    );
  });

  test('returns the loopback host alone when NO_PROXY is absent', () => {
    expect(loopbackNoProxy({}, 'http://localhost:8787')).toBe('localhost');
  });

  test('IPv6 literal (bracketed form) unwrapped and merged', () => {
    expect(loopbackNoProxy({}, 'http://[::1]:8787')).toBe('::1');
  });

  test('host already in the NO_PROXY list stays as-is', () => {
    expect(loopbackNoProxy({ NO_PROXY: '127.0.0.1,other' }, 'http://127.0.0.1:8791')).toBe(
      '127.0.0.1,other',
    );
  });

  test('lowercase no_proxy variant read the same way', () => {
    expect(loopbackNoProxy({ no_proxy: 'a.com' }, 'http://127.0.0.1:1')).toBe('a.com,127.0.0.1');
  });

  test('non-loopback server is not injected', () => {
    expect(loopbackNoProxy({}, 'https://cairn.example.com')).toBeUndefined();
  });

  test('missing serverUrl or bad URL is not injected', () => {
    expect(loopbackNoProxy({}, undefined)).toBeUndefined();
    expect(loopbackNoProxy({}, 'not-a-url')).toBeUndefined();
  });
});

describe('detectProxyEnv', () => {
  test('HTTP_PROXY/HTTPS_PROXY case-variant detection', () => {
    expect(detectProxyEnv({ HTTP_PROXY: 'http://p:1' })).toBe('http://p:1');
    expect(detectProxyEnv({ https_proxy: 'http://p:2' })).toBe('http://p:2');
    expect(detectProxyEnv({})).toBeNull();
  });
});

test('per-step proxy configuration routes real HTTP traffic without changing process env', async () => {
  const original = getGlobalDispatcher();
  const destinations: string[] = [];
  const proxy = createServer((request, response) => {
    destinations.push(request.url ?? '');
    response.end('proxied');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address() as AddressInfo;
  const before = process.env.HTTP_PROXY;
  setupProxy(createDaemonLogger({}), {
    HTTP_PROXY: `http://127.0.0.1:${address.port}`,
    NO_PROXY: '',
  });
  const configured = getGlobalDispatcher();
  try {
    const response = await fetch('http://orb-proxy.test/status', {
      signal: AbortSignal.timeout(2000),
    });
    expect(await response.text()).toBe('proxied');
    expect(destinations).toEqual(['http://orb-proxy.test/status']);
    expect(process.env.HTTP_PROXY).toBe(before);
  } finally {
    setGlobalDispatcher(original);
    await configured.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
