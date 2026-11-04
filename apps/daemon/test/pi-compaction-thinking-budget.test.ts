import { expect, test } from 'vitest';
import { compactionCeilingFetch } from '../src/backend/compaction-ceiling.js';

test.each(['reported-input', 'generic'])(
  'summary recovery preserves enabled thinking with %s ceiling errors',
  async (style) => {
    const seen: {
      max_tokens: number;
      thinking: { type: string; budget_tokens: number };
      messages: { content: string }[];
    }[] = [];
    const wrapped = compactionCeilingFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as (typeof seen)[number];
      seen.push(body);
      if (body.max_tokens <= body.thinking.budget_tokens) {
        return new Response('thinking.budget_tokens must be less than max_tokens', { status: 400 });
      }
      const inputTokens = Math.ceil((body.messages[0]?.content.length ?? 0) / 2);
      if (inputTokens + body.max_tokens > 8_000) {
        const message =
          style === 'reported-input'
            ? `This model's maximum context length is 8000 tokens. However, you requested ${body.max_tokens} output tokens and your prompt contains at least ${inputTokens} input tokens`
            : 'prompt is too long: input exceeds the context window';
        return new Response(message, { status: 400 });
      }
      return new Response('summary', { status: 200 });
    });
    const response = await wrapped('https://example.invalid/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        system: 'You are a context summarization assistant.',
        max_tokens: 8_192,
        thinking: { type: 'enabled', budget_tokens: 4_096 },
        messages: [{ role: 'user', content: 'x'.repeat(15_800) }],
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('summary');
    expect(seen.length).toBeGreaterThan(1);
    for (const body of seen) {
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4_096 });
      expect(body.max_tokens).toBeGreaterThan(4_096);
    }
    expect(seen.at(-1)?.messages[0]?.content.length).toBeLessThan(15_800);
  },
);

test('disabled thinking still permits a small output-only retry without truncating input', async () => {
  const seen: {
    max_tokens: number;
    thinking: { type: string };
    messages: { content: string }[];
  }[] = [];
  const wrapped = compactionCeilingFetch(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as (typeof seen)[number];
    seen.push(body);
    return body.max_tokens + 7_900 > 8_000
      ? new Response(
          `maximum context length is 8000; requested ${body.max_tokens} output tokens; at least 7900 input tokens`,
          { status: 400 },
        )
      : new Response('summary', { status: 200 });
  });
  const response = await wrapped('https://example.invalid/v1/messages', {
    method: 'POST',
    body: JSON.stringify({
      system: 'You are a context summarization assistant.',
      max_tokens: 1_024,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: 'keep this text' }],
    }),
  });
  expect(response.status).toBe(200);
  expect(seen).toHaveLength(2);
  expect(seen[1]).toMatchObject({
    max_tokens: 99,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'keep this text' }],
  });
});
