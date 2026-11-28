import { describe, expect, test } from 'vitest';
import { chiefDraftKeys } from '../src/chief/draft-keys.js';

describe('a Coordinator draft belongs to one conversation', () => {
  test('the main conversation and a project conversation never share a key', () => {
    expect(chiefDraftKeys(null)).toEqual({ scope: 'chief', localKey: 'cairn.chief-draft' });
    expect(chiefDraftKeys('p1')).toEqual({ scope: 'chief:p1', localKey: 'cairn.chief-draft.p1' });
    expect(chiefDraftKeys('p2').scope).not.toBe(chiefDraftKeys('p1').scope);
  });
});
