import { describe, expect, test } from 'vitest';
import { serverDraftBinding } from '../src/chief/composer-binding.js';

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
});
