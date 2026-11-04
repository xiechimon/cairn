import { describe, expect, it } from 'vitest';
import {
  conversationStreamEventSchema,
  conversationTextDeltaEventSchema,
} from '../src/protocol/sse.js';

describe('conversation stream thinking_delta', () => {
  it('accepts { type: thinking_delta, text } the same way as text_delta', () => {
    const text = conversationTextDeltaEventSchema.parse({
      type: 'text_delta',
      text: 'visible answer',
    });
    expect(text).toEqual({ type: 'text_delta', text: 'visible answer' });

    const parsed = conversationStreamEventSchema.safeParse({
      type: 'thinking_delta',
      text: 'REASONING-MARKER-1308',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ type: 'thinking_delta', text: 'REASONING-MARKER-1308' });
    }
  });
});
