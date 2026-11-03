import { describe, expect, test } from 'vitest';
import { pickedModels } from '../src/resources/provider-model-list.js';

describe('pickedModels', () => {
  const catalog = [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', contextWindow: 1_000_000 },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1_000_000 },
  ];

  test('catalog picks keep their metadata, in the order they were picked', () => {
    expect(pickedModels(catalog, ['claude-opus-5-5', 'claude-haiku-5-5'])).toEqual([
      catalog[1],
      catalog[0],
    ]);
  });

  test('a typed id outside the catalog saves as a bare model', () => {
    expect(pickedModels(catalog, ['claude-relay-preview'])).toEqual([
      { id: 'claude-relay-preview', name: 'claude-relay-preview' },
    ]);
  });

  test('nothing picked saves no models', () => {
    expect(pickedModels(catalog, [])).toEqual([]);
  });
});
