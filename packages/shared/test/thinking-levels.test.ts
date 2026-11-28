import { describe, expect, it } from 'vitest';
import {
  claudeCodeThinkingDefault,
  claudeCodeThinkingLevels,
  devinWireModel,
  devinWireModelAtEffort,
} from '../src/thinking-levels.js';

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

describe('devinWireModel', () => {
  it.each([
    ['swe-2', 'high', 'swe-2-high'],
    ['swe-2', 'off', 'swe-2-none'],
    ['swe-2-flash', 'low', 'swe-2-flash-low'],
    ['swe-2-1', null, 'swe-2-1-medium'],
    ['swe-2-high', null, 'swe-2-high'],
    ['swe-2-flash-low', undefined, 'swe-2-flash-low'],
  ] as const)('encodes %s with effort %s as %s', (id, effort, expected) => {
    expect(devinWireModel('devin', id, effort)).toBe(expected);
  });

  it('keeps a saved variant as the exact model it names', () => {
    expect(devinWireModel('devin', 'swe-2-high', 'off')).toBe('swe-2-high');
  });

  it('leaves other providers and unknown families alone', () => {
    expect(devinWireModel('claude', 'swe-2', 'high')).toBe('swe-2');
    expect(devinWireModel('devin', 'glm-5-high', 'low')).toBe('glm-5-high');
  });
});

describe('devinWireModelAtEffort', () => {
  it('encodes a family at the chosen effort', () => {
    expect(devinWireModelAtEffort('devin', 'swe-2-1', 'xhigh')).toBe('swe-2-1-xhigh');
    expect(devinWireModelAtEffort('devin', 'swe-2', 'off')).toBe('swe-2-none');
  });

  it('replaces an existing suffix when a different effort is chosen', () => {
    expect(devinWireModelAtEffort('devin', 'swe-2-high', 'low')).toBe('swe-2-low');
    expect(devinWireModelAtEffort('devin', 'swe-2-flash-medium', 'max')).toBe('swe-2-flash-max');
  });

  it('keeps an existing suffix when no effort is chosen', () => {
    expect(devinWireModelAtEffort('devin', 'swe-2-low', null)).toBe('swe-2-low');
    expect(devinWireModelAtEffort('devin', 'swe-2-flash', null)).toBe('swe-2-flash-medium');
  });

  it('leaves other providers and unknown families alone', () => {
    expect(devinWireModelAtEffort('claude', 'swe-2-high', 'low')).toBe('swe-2-high');
    expect(devinWireModelAtEffort('devin', 'glm-5-high', 'low')).toBe('glm-5-high');
  });
});
