import { describe, expect, test } from 'vitest';
import { compactionCeilingFetch } from '../src/backend/compaction-ceiling.js';

const marker = 'You are a context summarization assistant.';
const conversation = `<conversation>\n${'old context '.repeat(4_000)}\n\n[User]: finish the task\n</conversation>\nKeep the goal.`;

interface ResponsesBody {
  instructions?: string;
  input: { role: string; content: string | { type: string; text: string }[] }[];
  max_output_tokens?: number;
}

function overflow(input: number, output: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'context_length_exceeded',
        message: `This model's maximum context length is 8000 tokens. However, you requested ${output} output tokens and your prompt contains at least ${input} input tokens`,
      },
    }),
    { status: 400 },
  );
}

describe('Responses compaction ceiling recovery', () => {
  test.each(['instructions', 'system', 'developer'])(
    '%s summaries truncate and recover',
    async (role) => {
      const seen: ResponsesBody[] = [];
      const logs: string[] = [];
      const wrapped = compactionCeilingFetch(
        async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as ResponsesBody;
          seen.push(body);
          const input = Math.ceil(JSON.stringify(body.input).length / 2);
          const output = body.max_output_tokens ?? 1_024;
          return input + output > 8_000 ? overflow(input, output) : new Response('summary');
        },
        (line) => logs.push(line),
      );
      const body: ResponsesBody = {
        ...(role === 'instructions' ? { instructions: marker } : {}),
        input: [
          ...(role === 'instructions'
            ? []
            : [{ role, content: [{ type: 'input_text', text: marker }] }]),
          { role: 'user', content: [{ type: 'input_text', text: conversation }] },
        ],
        max_output_tokens: 1_024,
      };
      const response = await wrapped('https://example.invalid/v1/responses', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(seen.length).toBeGreaterThan(1);
      expect(JSON.stringify(seen.at(-1))).toContain('finish the task');
      expect(JSON.stringify(seen.at(-1))).toContain('Keep the goal.');
      expect(logs.join('\n')).toContain('dropped older conversation text');
      for (const request of seen) {
        expect(request).not.toHaveProperty('max_tokens');
        expect(request).not.toHaveProperty('max_completion_tokens');
        expect(request.max_output_tokens).toBeGreaterThanOrEqual(16);
      }
    },
  );

  test('Responses output-only recovery uses max_output_tokens and retains the input', async () => {
    const seen: ResponsesBody[] = [];
    const wrapped = compactionCeilingFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as ResponsesBody;
      seen.push(body);
      return (body.max_output_tokens ?? 0) + 7_900 > 8_000
        ? overflow(7_900, body.max_output_tokens ?? 0)
        : new Response('summary');
    });
    const input = [{ role: 'user', content: conversation }];
    const response = await wrapped('https://example.invalid/v1/responses', {
      body: JSON.stringify({ instructions: marker, input, max_output_tokens: 1_024 }),
    });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ instructions: marker, input, max_output_tokens: 99 });
  });

  test('fewer than 16 tokens of room truncates input instead of sending an invalid output cap', async () => {
    const seen: ResponsesBody[] = [];
    const wrapped = compactionCeilingFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as ResponsesBody;
      seen.push(body);
      if ((body.max_output_tokens ?? 0) < 16)
        return new Response('invalid output cap', { status: 400 });
      return JSON.stringify(body.input).includes('old context '.repeat(3_000))
        ? overflow(7_990, body.max_output_tokens ?? 0)
        : new Response('summary');
    });
    const response = await wrapped('https://example.invalid/v1/responses', {
      body: JSON.stringify({
        instructions: marker,
        input: [{ role: 'user', content: conversation }],
        max_output_tokens: 1_024,
      }),
    });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.max_output_tokens).toBeGreaterThanOrEqual(16);
  });

  test.each([20_000, 7_900])(
    'uncapped Responses requests at %i input tokens recover without adding an unsupported output field',
    async (inputTokens) => {
      const seen: ResponsesBody[] = [];
      const wrapped = compactionCeilingFetch(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as ResponsesBody;
        seen.push(body);
        return JSON.stringify(body.input).length > 16_000
          ? overflow(inputTokens, 1_024)
          : new Response('summary');
      });
      const response = await wrapped('https://example.invalid/v1/responses', {
        body: JSON.stringify({
          instructions: marker,
          input: [{ role: 'user', content: conversation }],
        }),
      });
      expect(response.status).toBe(200);
      expect(seen.length).toBeGreaterThan(1);
      for (const body of seen) {
        expect(body).not.toHaveProperty('max_output_tokens');
        expect(body).not.toHaveProperty('max_tokens');
      }
    },
  );

  test.each([400, 413])(
    'persistent Responses overflow %i stops at four attempts and logs the reason',
    async (status) => {
      let calls = 0;
      const logs: string[] = [];
      const wrapped = compactionCeilingFetch(
        async () => {
          calls++;
          return new Response('{"error":{"code":"context_length_exceeded"}}', { status });
        },
        (line) => logs.push(line),
      );
      const response = await wrapped('https://example.invalid/v1/responses', {
        body: JSON.stringify({
          instructions: marker,
          input: [{ role: 'user', content: 'x'.repeat(40_000) }],
          max_output_tokens: 1_024,
        }),
      });
      expect(response.status).toBe(status);
      expect(await response.text()).toContain('context_length_exceeded');
      expect(calls).toBe(4);
      expect(logs.at(-1)).toContain('hit the context ceiling after 4 attempts');
    },
  );

  test('non-ceiling Responses errors return the provider reason without retrying', async () => {
    let calls = 0;
    const logs: string[] = [];
    const wrapped = compactionCeilingFetch(
      async () => {
        calls++;
        return new Response('invalid model', { status: 400 });
      },
      (line) => logs.push(line),
    );
    const response = await wrapped('https://example.invalid/v1/responses', {
      body: JSON.stringify({
        instructions: marker,
        input: [{ role: 'user', content: conversation }],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('invalid model');
    expect(calls).toBe(1);
    expect(logs).toEqual([]);
  });

  test('ordinary Responses requests quoting the marker are never truncated', async () => {
    let calls = 0;
    const logs: string[] = [];
    const body = JSON.stringify({
      instructions: 'You are a coding assistant.',
      input: [{ role: 'user', content: marker + conversation }],
      max_output_tokens: 1_024,
    });
    const wrapped = compactionCeilingFetch(
      async (_input, init) => {
        calls++;
        expect(init?.body).toBe(body);
        return overflow(20_000, 1_024);
      },
      (line) => logs.push(line),
    );
    expect((await wrapped('https://example.invalid/v1/responses', { body })).status).toBe(400);
    expect(calls).toBe(1);
    expect(logs).toEqual([]);
  });
});
