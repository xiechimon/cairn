import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeAccessIdentity } from '../src/api/auth.js';

function onPage(hostname: string) {
  vi.stubGlobal('window', { location: { hostname, hash: '' } });
}

function stubFetch(status: number) {
  const fetchMock = vi.fn(async () => new Response('{}', { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exchangeAccessIdentity', () => {
  it('a page behind Cloudflare Access asks the server to turn its Access identity into a session', async () => {
    onPage('app.example.com');
    const fetchMock = stubFetch(200);
    expect(await exchangeAccessIdentity()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/access', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it('a refused or failed exchange leaves the page signed out', async () => {
    onPage('app.example.com');
    for (const status of [401, 403, 404, 503]) {
      stubFetch(status);
      expect(await exchangeAccessIdentity()).toBe(false);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    expect(await exchangeAccessIdentity()).toBe(false);
  });

  it('a loopback page never tries the exchange', async () => {
    onPage('127.0.0.1');
    const fetchMock = stubFetch(200);
    expect(await exchangeAccessIdentity()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
