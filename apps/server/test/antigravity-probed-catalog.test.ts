import { describe, expect, test } from 'vitest';
import { antigravityProbedCatalog } from '../src/services/antigravity-entitlements.js';

const TOKEN = `AIzaSyA${'p'.repeat(28)}`;

describe('antigravityProbedCatalog', () => {
  test('preserves clean human display names without appending pool suffixes', () => {
    expect(
      antigravityProbedCatalog(
        [
          { id: 'claude-paid', name: 'Claude Paid', group: 'External' },
          { id: 'gemini-paid', name: 'Gemini Paid', group: 'Claude and GPT models' },
          { id: 'other-model', name: 'Other Model' },
        ],
        TOKEN,
      ),
    ).toEqual([
      { id: 'claude-paid', name: 'Claude Paid' },
      { id: 'gemini-paid', name: 'Gemini Paid' },
      { id: 'other-model', name: 'Other Model' },
    ]);
  });

  test('filters internal and non-chat ids at source', () => {
    expect(
      antigravityProbedCatalog(
        [
          { id: 'chat_20706', name: 'chat_20706' },
          { id: 'chat_23310', name: 'chat_23310' },
          { id: 'tab_jump_flash_lite_preview', name: 'Tab Jump' },
          { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
          { id: 'gemini-3.8-flash-tiered', name: 'Gemini 3.8 Flash Tiered' },
          { id: 'gemini-4-neon', name: 'Gemini 4 Neon' },
        ],
        TOKEN,
      ),
    ).toEqual([{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }]);
  });

  test('keeps distinct ids that only differ by a level suffix and drops only exact repeats', () => {
    expect(
      antigravityProbedCatalog(
        [
          { id: 'gemini-paid', name: 'Gemini Paid' },
          { id: 'gemini-paid-high', name: 'Gemini Paid High' },
          { id: 'gemini-paid', name: 'Repeat', group: 'Other' },
        ],
        TOKEN,
      ),
    ).toEqual([
      { id: 'gemini-paid', name: 'Gemini Paid' },
      { id: 'gemini-paid-high', name: 'Gemini Paid High' },
    ]);
  });

  test('never exposes the key through an id or a name', () => {
    expect(
      antigravityProbedCatalog(
        [
          { id: `echo-${TOKEN}`, name: 'Echo' },
          { id: 'named-echo', name: TOKEN },
          { id: 'other-model', name: 'Other Model', group: `Pool ${TOKEN}` },
        ],
        TOKEN,
      ),
    ).toEqual([{ id: 'other-model', name: 'Other Model' }]);
  });
});
