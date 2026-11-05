import { describe, expect, test } from 'vitest';
import { createSendKey } from '../src/api/use-send-key.js';

describe('send key', () => {
  test('a retry with the same identity reuses the key', () => {
    const sendKey = createSendKey();
    const first = sendKey.attempt('hello', 'thread');
    expect(sendKey.attempt('hello', 'thread').key).toBe(first.key);
  });

  test('a different identity mints a new key', () => {
    const sendKey = createSendKey();
    const first = sendKey.attempt('hello', 'thread');
    expect(sendKey.attempt('hello again', 'thread').key).not.toBe(first.key);
  });

  test('editing back to the earlier identity after another attempt mints a new key', () => {
    const sendKey = createSendKey();
    const first = sendKey.attempt('hello', 'thread');
    sendKey.attempt('other', 'thread');
    expect(sendKey.attempt('hello', 'thread').key).not.toBe(first.key);
  });

  test('a settled send mints a new key even for an identical identity', () => {
    const sendKey = createSendKey();
    const first = sendKey.attempt('hello', 'thread');
    sendKey.settle();
    expect(sendKey.attempt('hello', 'thread').key).not.toBe(first.key);
  });

  test('an unsettled retry keeps the endpoint of the first attempt even when the preferred route changed', () => {
    const sendKey = createSendKey();
    const first = sendKey.attempt('hello', 'thread');
    const retry = sendKey.attempt('hello', 'queue');
    expect(retry).toEqual({ key: first.key, route: 'thread' });
  });

  test('a new identity takes the currently preferred route', () => {
    const sendKey = createSendKey();
    sendKey.attempt('hello', 'thread');
    expect(sendKey.attempt('other', 'queue').route).toBe('queue');
  });
});
