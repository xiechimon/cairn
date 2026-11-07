import { describe, expect, test } from 'vitest';
import { keyedBinding, serverDraftBinding } from '../src/chief/composer-binding.js';

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: (key: string) => values.get(key) ?? '',
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('composer binding contract', () => {
  test('a read-only binding carries the draft and no setter', () => {
    const binding = serverDraftBinding('static text', undefined);
    expect(binding.draft).toBe('static text');
    expect(binding.setDraft).toBeUndefined();
  });

  test('an editable binding passes writes straight to its setter', () => {
    const written: string[] = [];
    const binding = serverDraftBinding('', (value) => written.push(value));
    binding.setDraft?.('hello');
    expect(written).toEqual(['hello']);
  });

  test('a keyed binding reads and writes only its own key, however the store changes later', () => {
    const store = memoryStore();
    store.set('request-a#0', 'answer for A');
    store.set('request-b#0', 'answer for B');
    const forA = keyedBinding(store, 'request-a#0');
    expect(forA.draft).toBe('answer for A');
    store.set('request-b#0', 'B typed more');
    forA.setDraft('A finished');
    expect(store.get('request-a#0')).toBe('A finished');
    expect(store.get('request-b#0')).toBe('B typed more');
    expect(forA.readDraft()).toBe('A finished');
  });

  test('two keyed bindings never see each other', () => {
    const store = memoryStore();
    const first = keyedBinding(store, 'one');
    const second = keyedBinding(store, 'two');
    first.setDraft('x');
    second.setDraft('y');
    expect(first.readDraft()).toBe('x');
    expect(second.readDraft()).toBe('y');
  });
});
