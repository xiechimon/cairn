import { describe, expect, test } from 'vitest';
import { detectProxyEnv, loopbackNoProxy } from '../src/proxy.js';

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
