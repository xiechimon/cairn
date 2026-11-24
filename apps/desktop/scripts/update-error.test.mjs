import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNetworkUnavailableError, updateFailureState } from '../src/update-error.ts';

test('Chromium net::ERR_INTERNET_DISCONNECTED and related network errors report offline, not a failed update', () => {
  for (const message of [
    'net::ERR_INTERNET_DISCONNECTED',
    'net::ERR_NAME_NOT_RESOLVED',
    'net::ERR_NETWORK_CHANGED',
    'net::ERR_ADDRESS_UNREACHABLE',
    'net::ERR_CONNECTION_TIMED_OUT',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_CONNECTION_CLOSED',
    'net::ERR_TIMED_OUT',
  ]) {
    const error = new Error(message);
    assert.equal(isNetworkUnavailableError(error), true, message);
    assert.deepEqual(updateFailureState(error, null), { status: 'offline' });
  }
});

test('Node fetch transport failures report offline, including nested cause and AggregateError', () => {
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
  assert.deepEqual(updateFailureState(new TypeError('fetch failed', { cause: dns }), null), {
    status: 'offline',
  });

  const dualStack = new AggregateError(
    [
      Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }),
      Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' }),
    ],
    'connect failed',
  );
  assert.deepEqual(updateFailureState(new TypeError('fetch failed', { cause: dualStack }), null), {
    status: 'offline',
  });

  assert.deepEqual(updateFailureState(new TypeError('fetch failed'), null), { status: 'offline' });
});

test('an offline check preserves an already staged update instead of hiding it', () => {
  assert.deepEqual(updateFailureState(new Error('net::ERR_INTERNET_DISCONNECTED'), '0.1.710'), {
    status: 'ready',
    version: '0.1.710',
  });
});

test('non-network update errors still report status error with their message', () => {
  for (const error of [
    new Error('GitHub answered HTTP 500'),
    new Error('download failed with HTTP 404'),
    new Error('the download does not match its SHA-256 digest'),
    new Error('the staged update is not signed the way this copy of Cairn is'),
    new SyntaxError('Unexpected token < in JSON'),
  ]) {
    assert.equal(isNetworkUnavailableError(error), false, error.message);
    assert.deepEqual(updateFailureState(error, null), { status: 'error', message: error.message });
  }
});
