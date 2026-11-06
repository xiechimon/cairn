import type { RemoteRoute } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { isLoopbackOrigin, pairingOrigin } from '../src/lib/pairing-origin.js';

const lan: RemoteRoute = { kind: 'lan', url: 'http://192.168.1.20:8787' };
const tailnet: RemoteRoute = { kind: 'tailnet', url: 'https://box.tail1234.ts.net' };

describe('pairing origin', () => {
  test.each([
    'http://localhost:5173',
    'http://127.0.0.1:8787',
    'http://127.9.9.9:8787',
    'http://[::1]:8787',
    'http://app.localhost:8787',
    'http://0.0.0.0:8787',
    'not a url',
  ])('loopback page %s with no routes disables pairing', (page) => {
    expect(isLoopbackOrigin(page)).toBe(true);
    expect(pairingOrigin([], page)).toBeNull();
  });

  test('a loopback page still pairs through a LAN route', () => {
    expect(pairingOrigin([lan], 'http://127.0.0.1:8787')).toBe(lan.url);
  });

  test('the tailnet route beats the LAN route', () => {
    expect(pairingOrigin([lan, tailnet], 'http://127.0.0.1:8787')).toBe(tailnet.url);
  });

  test('a reverse-proxy origin with no routes is kept', () => {
    expect(pairingOrigin([], 'https://cairn.example.com')).toBe('https://cairn.example.com');
  });

  test('a LAN page origin with no routes is kept', () => {
    expect(pairingOrigin([], 'http://192.168.1.20:8787')).toBe('http://192.168.1.20:8787');
  });
});
