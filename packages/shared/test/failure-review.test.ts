import { expect, test } from 'vitest';
import { blankFailureReviewRecord, modelVendor } from '../src/failure-review.js';

test('modelVendor maps known model families and falls back to unknown', () => {
  expect(modelVendor('anthropic/claude-sonnet-4')).toBe('anthropic');
  expect(modelVendor('Claude-Opus')).toBe('anthropic');
  expect(modelVendor('z-ai/glm-4.6')).toBe('z.ai');
  expect(modelVendor('openai/gpt-5')).toBe('openai');
  expect(modelVendor('openai/codex-mini')).toBe('openai');
  expect(modelVendor('xai/grok-4')).toBe('xai');
  expect(modelVendor('google/gemini-2.5-pro')).toBe('unknown');
  expect(modelVendor('')).toBe('unknown');
});

test('blankFailureReviewRecord keeps label fields null with unknown reader vendor', () => {
  const record = blankFailureReviewRecord({
    itemId: 'pack:build-1',
    source: 'pack',
    flow: null,
    buildId: 'build-1',
  });
  expect(record.where).toBeNull();
  expect(record.why).toBeNull();
  expect(record.verdictClass).toBeNull();
  expect(record.note).toBe('');
  expect(record.reader).toEqual({ model: '', vendor: 'unknown' });
});
