import { describe, expect, test } from 'vitest';
import { antigravityProbedCatalog } from '../src/services/antigravity-entitlements.js';

const TOKEN = `AIzaSyA${'p'.repeat(28)}`;

describe('antigravityProbedCatalog', () => {
  test('labels a model with the group it was reported under', () => {
    expect(
      antigravityProbedCatalog(
        [{ id: 'claude-paid', name: 'Claude Paid', group: 'External' }],
        TOKEN,
      ),
    ).toEqual([{ id: 'claude-paid', name: 'Claude Paid · External' }]);
  });

  test('prefers the reported group over a guess from the model id', () => {
    expect(
      antigravityProbedCatalog(
        [{ id: 'gemini-paid', name: 'Gemini Paid', group: 'Claude and GPT models' }],
        TOKEN,
      ),
    ).toEqual([{ id: 'gemini-paid', name: 'Gemini Paid · Claude and GPT models' }]);
  });

  test('keeps an already labelled name and guesses from the id only without a group', () => {
    expect(
      antigravityProbedCatalog(
        [
          {
            id: 'gpt-labelled',
            name: 'GPT · Claude and GPT models',
            group: 'Claude and GPT models',
          },
          { id: 'gemini-paid', name: 'Gemini Paid' },
          { id: 'other-model', name: 'Other Model' },
        ],
        TOKEN,
      ),
    ).toEqual([
      { id: 'gpt-labelled', name: 'GPT · Claude and GPT models' },
      { id: 'gemini-paid', name: 'Gemini Paid · Gemini Models' },
      { id: 'other-model', name: 'Other Model' },
    ]);
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
      { id: 'gemini-paid', name: 'Gemini Paid · Gemini Models' },
      { id: 'gemini-paid-high', name: 'Gemini Paid High · Gemini Models' },
    ]);
  });

  test('never exposes the key through an id, a name or a group', () => {
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

  test('truncates a long display name so the group suffix fits', () => {
    expect(
      antigravityProbedCatalog([{ id: 'x', name: 'X'.repeat(256), group: 'External' }], TOKEN),
    ).toEqual([{ id: 'x', name: `${'X'.repeat(245)} · External` }]);
  });
});
