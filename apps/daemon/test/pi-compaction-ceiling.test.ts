import { describe, expect, test } from 'vitest';
import { compactionCeilingFetch } from '../src/backend/compaction-ceiling.js';
import { daemonSettingsManager, summarizeCompactionTranscript } from '../src/backend/pi.js';

const CONTEXT_WINDOW = 320_000;
const PROVIDER_INPUT_TOKENS = 319_873;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_OUTPUT_TOKENS = 16_384;
const CEILING_TRANSCRIPT = `T${'x'.repeat(1_261_868)}`;
const SUMMARY_TEXT = '## Goal\nKept the gate.';
const SUMMARY_SSE = [
  `data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"## Goal\\nKept the gate."},"finish_reason":null}]}`,
  '',
  'data: {"id":"x","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":319874,"completion_tokens":8,"total_tokens":319882}}',
  '',
  'data: [DONE]',
  '',
].join('\n');

function ceilingError(window: number, requested: number, input: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `This model's maximum context length is ${window} tokens. However, you requested ${requested} output tokens and your prompt contains at least ${input} input tokens`,
        type: 'invalid_request_error',
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );
}

function summaryOk(): Response {
  return new Response(SUMMARY_SSE, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function requestedOutput(raw: string): number {
  const body = JSON.parse(raw) as { max_tokens?: number; max_completion_tokens?: number };
  return body.max_tokens ?? body.max_completion_tokens ?? 0;
}

describe('#1744 compaction at the context ceiling', () => {
  test('a summary whose provider counts 319873 input tokens on a 320000 window succeeds', async () => {
    const text = await summarizeCompactionTranscript(
      CEILING_TRANSCRIPT,
      async (_input, init) => {
        const raw = typeof init?.body === 'string' ? init.body : '';
        const requested = requestedOutput(raw);
        if (PROVIDER_INPUT_TOKENS + requested > CONTEXT_WINDOW) {
          return ceilingError(CONTEXT_WINDOW, requested, PROVIDER_INPUT_TOKENS);
        }
        return summaryOk();
      },
      { contextWindow: CONTEXT_WINDOW, maxTokens: DEFAULT_OUTPUT_TOKENS },
    );
    expect(text).toBe(SUMMARY_TEXT);
  });

  test('a short summary the provider still counts at 319873 tokens retries with output room and the step summary succeeds', async () => {
    const logs: string[] = [];
    let calls = 0;
    const text = await summarizeCompactionTranscript(
      'hello',
      async (_input, init) => {
        calls += 1;
        const raw = typeof init?.body === 'string' ? init.body : '';
        const requested = requestedOutput(raw);
        if (PROVIDER_INPUT_TOKENS + requested > CONTEXT_WINDOW) {
          return ceilingError(CONTEXT_WINDOW, requested, PROVIDER_INPUT_TOKENS);
        }
        return summaryOk();
      },
      { contextWindow: CONTEXT_WINDOW, maxTokens: DEFAULT_OUTPUT_TOKENS },
      (line) => logs.push(line),
    );
    expect(text).toBe(SUMMARY_TEXT);
    expect(calls).toBeGreaterThan(1);
    expect(logs.join('\n')).toContain('retrying with max_tokens');
  });

  test('when the provider counts the summary prompt over the window, the oldest conversation text is dropped and the retry fits', async () => {
    const window = 8_000;
    const logs: string[] = [];
    let calls = 0;
    let smallestBody = Number.POSITIVE_INFINITY;
    const text = await summarizeCompactionTranscript(
      `T${'x'.repeat(40_000)}`,
      async (_input, init) => {
        calls += 1;
        const raw = typeof init?.body === 'string' ? init.body : '';
        smallestBody = Math.min(smallestBody, raw.length);
        const requested = requestedOutput(raw);
        const input = Math.ceil(raw.length / 2);
        if (input + requested > window) return ceilingError(window, requested, input);
        return summaryOk();
      },
      { contextWindow: window, maxTokens: 1_024 },
      (line) => logs.push(line),
    );
    expect(text).toBe(SUMMARY_TEXT);
    expect(calls).toBeGreaterThan(1);
    expect(smallestBody).toBeLessThan(20_000);
    expect(logs.join('\n')).toContain('dropped older conversation text');
  });

  test('a summary that stays over the window after truncation logs the context ceiling and fails with the provider reason', async () => {
    const logs: string[] = [];
    const attempt = summarizeCompactionTranscript(
      'hello',
      async (_input, init) => {
        const raw = typeof init?.body === 'string' ? init.body : '';
        const requested = requestedOutput(raw);
        return ceilingError(CONTEXT_WINDOW, requested, 900_000);
      },
      { contextWindow: CONTEXT_WINDOW, maxTokens: DEFAULT_OUTPUT_TOKENS },
      (line) => logs.push(line),
    );
    await expect(attempt).rejects.toThrow(/maximum context length/);
    expect(logs.join('\n')).toContain('compaction summary hit the context ceiling');
  });

  test('a summarization 400 that is not the context ceiling is returned once and is not logged as the ceiling', async () => {
    const logs: string[] = [];
    let calls = 0;
    const body = JSON.stringify({
      max_tokens: 128,
      messages: [
        { role: 'system', content: 'You are a context summarization assistant.' },
        { role: 'user', content: '<conversation>\nhello\n</conversation>' },
      ],
    });
    const wrapped = compactionCeilingFetch(
      async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      },
      (line) => logs.push(line),
    );
    const response = await wrapped('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('invalid api key');
    expect(calls).toBe(1);
    expect(logs).toEqual([]);
  });

  test('a non-summarization 400 is returned unchanged', async () => {
    const logs: string[] = [];
    let calls = 0;
    const wrapped = compactionCeilingFetch(
      async () => {
        calls += 1;
        return new Response('model overloaded', {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        });
      },
      (line) => logs.push(line),
    );
    const response = await wrapped('https://example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], max_tokens: 16 }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('model overloaded');
    expect(calls).toBe(1);
    expect(logs).toEqual([]);
  });
});

describe('compaction.reserveTokens (#1808)', () => {
  test('the daemon keeps the upstream default, and that default fits the 128000 context with a 16384 output cap', () => {
    const reserveTokens = daemonSettingsManager().getCompactionSettings().reserveTokens;
    expect(reserveTokens).toBe(16_384);
    expect(DEFAULT_CONTEXT_WINDOW - reserveTokens).toBeGreaterThanOrEqual(DEFAULT_OUTPUT_TOKENS);
  });
});
