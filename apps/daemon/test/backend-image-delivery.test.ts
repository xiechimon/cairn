import { describe, expect, test } from 'vitest';
import { buildUserMessage, toImageBlock } from '../src/backend/claude-code.js';
import { ensureImageInput, toPiImages } from '../src/backend/pi.js';

const IMG = { data: 'aW1n', mimeType: 'image/png' };

describe('claude-code user-frame image delivery (#730)', () => {
  test('failure mode 1: no images → content stays a string (zero regression)', () => {
    const msg = buildUserMessage('任务文本');
    expect(msg.type).toBe('user');
    expect(msg.message.role).toBe('user');
    expect(msg.message.content).toBe('任务文本');
    expect(msg.parent_tool_use_id).toBeNull();
  });

  test('failure mode 2: with images → block array [text, image...] (same mechanism as CC itself)', () => {
    const msg = buildUserMessage('看这张图', [IMG, { ...IMG, mimeType: 'image/jpeg' }]);
    expect(Array.isArray(msg.message.content)).toBe(true);
    const blocks = msg.message.content as unknown[];
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: '看这张图' });
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aW1n' },
    });
    expect(blocks[2]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'aW1n' },
    });
  });

  test('failure mode 2: empty image array → string form (no empty array)', () => {
    const msg = buildUserMessage('任务文本', []);
    expect(msg.message.content).toBe('任务文本');
  });

  test('toImageBlock: single-block shape pinned standalone (all three source fields required)', () => {
    expect(toImageBlock(IMG)).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aW1n' },
    });
  });
});

describe('pi image delivery (#730)', () => {
  test('failure mode 3: DeliveredImage → pi ImageContent mapping', () => {
    const out = toPiImages([IMG]);
    expect(out).toEqual([{ type: 'image', data: 'aW1n', mimeType: 'image/png' }]);
  });

  test('failure mode 3: empty array → empty array (caller checks length to decide whether to pass it)', () => {
    expect(toPiImages([])).toEqual([]);
  });

  test('failure mode 4: ensureImageInput flips input:["text"] to include "image"', () => {
    const model = { id: 'm', input: ['text'] as ('text' | 'image')[] };
    ensureImageInput(model);
    expect(model.input).toContain('image');
  });

  test('failure mode 4: already containing "image" is idempotent (no duplicate append)', () => {
    const model = { id: 'm', input: ['text', 'image'] as ('text' | 'image')[] };
    ensureImageInput(model);
    expect(model.input).toEqual(['text', 'image']);
  });
});
