import { describe, expect, it } from 'vitest';
import { claudeCodeThinkingDefault, claudeCodeThinkingLevels } from '../src/thinking-levels.js';

const FULL = ['low', 'medium', 'high', 'xhigh', 'max'];

describe('claudeCodeThinkingLevels', () => {
  it.each([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-2',
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-mythos-5',
    'claude-opus-6',
    'claude-opus-5-5[1m]',
  ])('offers every level on %s', (modelId) => {
    expect(claudeCodeThinkingLevels(modelId)).toEqual(FULL);
  });

  it.each(['claude-opus-4-6', 'claude-sonnet-4-6'])(
    'drops only xhigh on %s (the CLI denies xhigh there)',
    (modelId) => {
      expect(claudeCodeThinkingLevels(modelId)).toEqual(['low', 'medium', 'high', 'max']);
    },
  );

  it.each(['claude-opus-4-5', 'claude-opus-4-5-20251101'])(
    'drops xhigh and max on %s',
    (modelId) => {
      expect(claudeCodeThinkingLevels(modelId)).toEqual(['low', 'medium', 'high']);
    },
  );

  it.each([
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-0',
    'claude-opus-4-0',
    'claude-opus-4-1',
    'claude-opus-4-1-20250805',
    'claude-3-7-sonnet',
    'claude-3-5-haiku',
    'kimi-k3',
    'deepseek-v4-pro',
    'my-finetuned-model',
    'sonnet',
  ])('offers nothing on %s', (modelId) => {
    expect(claudeCodeThinkingLevels(modelId)).toEqual([]);
  });

  it('offers nothing on a custom backend, whatever the model', () => {
    expect(claudeCodeThinkingLevels('claude-opus-4-8', { customBackend: true })).toEqual([]);
  });
});

describe('claudeCodeThinkingDefault', () => {
  it.each([
    ['claude-opus-5-5', 'medium'],
    ['claude-sonnet-5-5', 'medium'],
    ['claude-haiku-5-5', 'medium'],
    ['claude-fable-5-2', 'medium'],
    ['claude-opus-4-7', 'xhigh'],
    ['claude-opus-4-8', 'high'],
    ['claude-opus-4-6', 'high'],
    ['claude-sonnet-4-6', 'high'],
    ['claude-opus-4-5', 'high'],
    ['claude-sonnet-5', 'high'],
    ['claude-opus-5-5[1m]', 'medium'],
  ] as const)('resolves %s to %s', (modelId, expected) => {
    expect(claudeCodeThinkingDefault(modelId)).toBe(expected);
  });

  it.each(['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-7-sonnet', 'kimi-k3'])(
    'has no default where effort is not supported: %s',
    (modelId) => {
      expect(claudeCodeThinkingDefault(modelId)).toBeUndefined();
    },
  );

  it('has no default on a custom backend', () => {
    expect(claudeCodeThinkingDefault('claude-opus-4-7', { customBackend: true })).toBeUndefined();
  });
});
