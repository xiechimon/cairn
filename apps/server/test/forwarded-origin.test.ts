import { describe, expect, test } from 'vitest';
import { forwardedOrigin } from '../src/lib/forwarded-origin.js';

const direct = 'http://127.0.0.1:8787/api/machine/upload-urls/s1';
const viaServe = 'http://box.example.ts.net/api/machine/upload-urls/s1';

describe('forwardedOrigin', () => {
  test('a loopback proxy that terminated TLS yields the https origin it was reached at', () => {
    expect(
      forwardedOrigin({
        url: viaServe,
        loopbackPeer: true,
        proto: 'https',
        host: 'box.example.ts.net',
      }),
    ).toBe('https://box.example.ts.net');
  });

  test('without a forwarded host the request host is kept', () => {
    expect(forwardedOrigin({ url: viaServe, loopbackPeer: true, proto: 'https' })).toBe(
      'https://box.example.ts.net',
    );
  });

  test('a forwarded host with a port keeps the port', () => {
    expect(
      forwardedOrigin({
        url: viaServe,
        loopbackPeer: true,
        proto: 'https',
        host: 'box.example:8443',
      }),
    ).toBe('https://box.example:8443');
  });

  test('headers from a non-loopback peer are ignored', () => {
    expect(
      forwardedOrigin({ url: direct, loopbackPeer: false, proto: 'https', host: 'evil.example' }),
    ).toBe('http://127.0.0.1:8787');
  });

  test('without a forwarded proto the request origin is kept', () => {
    expect(forwardedOrigin({ url: viaServe, loopbackPeer: true, host: 'evil.example' })).toBe(
      'http://box.example.ts.net',
    );
  });

  test.each(['javascript', 'ftp', 'HTTPS ', ''])(
    'an unknown proto %j keeps the request origin',
    (proto) => {
      expect(forwardedOrigin({ url: direct, loopbackPeer: true, proto })).toBe(
        'http://127.0.0.1:8787',
      );
    },
  );

  test('the first value of a comma-separated forwarded list is used', () => {
    expect(
      forwardedOrigin({
        url: direct,
        loopbackPeer: true,
        proto: 'https, http',
        host: 'box.example, other.example',
      }),
    ).toBe('https://box.example');
  });

  test.each([
    'evil.example/path',
    'user@evil.example',
    'evil.example?x=1',
    'evil.example#x',
    'evil example',
    'evil.example:99999',
    'evil.example\\x',
  ])('a malformed forwarded host %j keeps the request origin', (host) => {
    expect(forwardedOrigin({ url: direct, loopbackPeer: true, proto: 'https', host })).toBe(
      'http://127.0.0.1:8787',
    );
  });

  test('a bracketed IPv6 forwarded host is accepted', () => {
    expect(
      forwardedOrigin({ url: direct, loopbackPeer: true, proto: 'https', host: '[fd7a::1]:8443' }),
    ).toBe('https://[fd7a::1]:8443');
  });
});
