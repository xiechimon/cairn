import { describe, expect, test } from 'vitest';
import { isLoopbackHost } from '../src/loopback.js';

describe('isLoopbackHost', () => {
  test.each([
    ['localhost', true],
    ['localhost.', true],
    ['127.0.0.1', true],
    ['127.0.0.2', true],
    ['127.255.255.254', true],
    ['::1', true],
    ['[::1]', true],
    ['::ffff:127.0.0.1', true],
    ['[::ffff:127.0.0.1]', true],
    ['::ffff:7f00:1', true],
    ['[::ffff:7f00:1]', true],
    ['0.0.0.0', false],
    ['::', false],
    ['192.168.1.10', false],
    ['::ffff:c000:1', false],
    ['::ffff:10.0.0.1', false],
    ['cairn.example.com', false],
    ['127.0.0.1.evil.example', false],
    ['foo.localhost', true],
    ['foo.localhost.', true],
    ['FOO.LOCALHOST', true],
    ['LocalHost', true],
  ])('isLoopbackHost(%s) = %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
