// #1308：会话流要能携带 thinking_delta，载荷与 text_delta 同形
// { type:'thinking_delta', text }。修前 discriminated union 没有这一支，
// safeParse 失败，思考正文进不了会话流。

import { describe, expect, it } from 'vitest';
import { conversationStreamEventSchema, conversationTextDeltaEventSchema } from '../src/protocol/sse.js';

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
