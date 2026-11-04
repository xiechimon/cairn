import { describe, expect, test } from 'vitest';
import { createSendKey } from '../src/api/use-send-key.js';

describe('send key', () => {
  test('a retry with the same content reuses the key', () => {
    const sendKey = createSendKey();
    const first = sendKey.keyFor('hello');
    expect(sendKey.keyFor('hello')).toBe(first);
  });

  test('different content mints a new key', () => {
    const sendKey = createSendKey();
    const first = sendKey.keyFor('hello');
    expect(sendKey.keyFor('hello again')).not.toBe(first);
  });

  test('editing back to the earlier text after another attempt mints a new key', () => {
    const sendKey = createSendKey();
    const first = sendKey.keyFor('hello');
    sendKey.keyFor('other');
    expect(sendKey.keyFor('hello')).not.toBe(first);
  });

  test('a settled send mints a new key even for identical content', () => {
    const sendKey = createSendKey();
    const first = sendKey.keyFor('hello');
    sendKey.settle();
    expect(sendKey.keyFor('hello')).not.toBe(first);
  });
});
