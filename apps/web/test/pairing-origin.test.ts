import type { RemoteRoute } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { isLoopbackOrigin, pairingCandidates } from '../src/lib/pairing-origin.js';

const lan: RemoteRoute = { kind: 'lan', url: 'http://192.168.1.20:8787' };
const docker: RemoteRoute = { kind: 'lan', url: 'http://172.17.0.2:8787' };
const tailnet: RemoteRoute = { kind: 'tailnet', url: 'https://box.tail1234.ts.net' };
const origins = (routes: RemoteRoute[], page: string) =>
  pairingCandidates(routes, page).map((candidate) => candidate.origin);

describe('pairing candidates', () => {
  test.each([
    'http://localhost:5173',
    'http://127.0.0.1:8787',
    'http://127.9.9.9:8787',
    'http://[::1]:8787',
    'http://app.localhost:8787',
    'http://0.0.0.0:8787',
    'not a url',
  ])('loopback page %s with no routes offers nothing', (page) => {
    expect(isLoopbackOrigin(page)).toBe(true);
    expect(origins([], page)).toEqual([]);
  });

  test('a loopback page pairs through the tailnet first, then the LAN', () => {
    expect(origins([lan, tailnet], 'http://127.0.0.1:8787')).toEqual([tailnet.url, lan.url]);
  });

  test('Docker: the published-port page origin beats the container-private bridge address', () => {
    expect(origins([docker], 'http://192.168.1.20:3000')).toEqual([
      'http://192.168.1.20:3000',
      docker.url,
    ]);
    expect(pairingCandidates([docker], 'http://192.168.1.20:3000')[0]?.source).toBe('page');
  });

  test('Docker with a loopback page ranks the bridge address after real LAN addresses', () => {
    expect(origins([docker, lan], 'http://localhost:3000')).toEqual([lan.url, docker.url]);
  });

  test('reverse proxy: the proxied page origin is first and the only one when no routes exist', () => {
    expect(origins([], 'https://cairn.example.com')).toEqual(['https://cairn.example.com']);
  });

  test('LAN page: its own origin first, then the tailnet', () => {
    expect(origins([tailnet], 'http://192.168.1.20:8787')).toEqual([
      'http://192.168.1.20:8787',
      tailnet.url,
    ]);
  });

  test('tailnet page: no duplicate of the same origin', () => {
    expect(origins([tailnet], tailnet.url)).toEqual([tailnet.url]);
  });
});
