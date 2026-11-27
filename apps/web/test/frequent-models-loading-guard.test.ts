import { describe, expect, test } from 'vitest';
import { canSaveFrequentModels } from '../src/resources/routing-settings-page.js';

describe('frequent models loading guard', () => {
  test('blocks saving while live frequent models query is pending or errored', () => {
    expect(canSaveFrequentModels(true, { isPending: true, isError: false })).toBe(false);
    expect(canSaveFrequentModels(true, { isPending: false, isError: true })).toBe(false);
    expect(canSaveFrequentModels(true, { isPending: false, isError: false })).toBe(true);
    expect(canSaveFrequentModels(false, { isPending: true, isError: true })).toBe(true);
  });
});
