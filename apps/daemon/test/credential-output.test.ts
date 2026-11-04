import type { StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { credentialRedactor, credentialSafeEvents } from '../src/credential-output.js';

async function collect(events: StepEvent[], token?: string): Promise<StepEvent[]> {
  const output: StepEvent[] = [];
  async function* source() {
    yield* events;
  }
  for await (const event of credentialSafeEvents(source(), token)) output.push(event);
  return output;
}

describe('subscription output redaction', () => {
  const token = 'private-step-subscription-token';
  test('every streaming split masks the entire token without changing surrounding text', async () => {
    const original = `prefix ${token} middle ${token} suffix`;
    for (let split = 1; split < original.length; split++) {
      const events = await collect(
        [
          { type: 'text_delta', text: original.slice(0, split) },
          { type: 'text_delta', text: original.slice(split) },
          { type: 'done', usage: [] },
        ],
        token,
      );
      const text = events
        .flatMap((event) => (event.type === 'text_delta' ? [event.text] : []))
        .join('');
      expect(text).toBe('prefix [REDACTED] middle [REDACTED] suffix');
    }
  });
  test('thinking, tool arguments, nested results and errors cannot disclose the token', async () => {
    const output = await collect(
      [
        { type: 'thinking_delta', text: token.slice(0, 8) },
        { type: 'thinking_delta', text: token.slice(8) },
        {
          type: 'toolcall_end',
          call: {
            id: 'tool',
            name: 'bash',
            arguments: { command: token },
            result: { nested: [token] },
          },
        },
        { type: 'error', error: { message: token, retryable: false } },
      ],
      token,
    );
    expect(JSON.stringify(output)).not.toContain(token);
    expect(JSON.stringify(output)).toContain('[REDACTED]');
  });
  test('uncredentialed events and non-secret values stay unchanged', async () => {
    const events: StepEvent[] = [
      { type: 'text_delta', text: 'normal output' },
      { type: 'done', usage: [] },
    ];
    expect(await collect(events)).toEqual(events);
    expect(credentialRedactor(token)({ count: 1, value: null, list: [true] })).toEqual({
      count: 1,
      value: null,
      list: [true],
    });
  });
});
