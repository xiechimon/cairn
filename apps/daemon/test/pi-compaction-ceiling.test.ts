import { describe, expect, test } from 'vitest';
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

describe('#1744 compaction at the context ceiling', () => {
  test('a summary whose provider counts 319873 input tokens on a 320000 window succeeds', async () => {
    const text = await summarizeCompactionTranscript(
      CEILING_TRANSCRIPT,
      async (_input, init) => {
        const raw = typeof init?.body === 'string' ? init.body : '';
        const body = JSON.parse(raw) as { max_tokens?: number; max_completion_tokens?: number };
        const requested = body.max_tokens ?? body.max_completion_tokens ?? 0;
        if (PROVIDER_INPUT_TOKENS + requested > CONTEXT_WINDOW) {
          return new Response(
            JSON.stringify({
              error: {
                message: `This model's maximum context length is ${CONTEXT_WINDOW} tokens. However, you requested ${requested} output tokens and your prompt contains at least ${PROVIDER_INPUT_TOKENS} input tokens`,
                type: 'invalid_request_error',
              },
            }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(SUMMARY_SSE, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
      { contextWindow: CONTEXT_WINDOW, maxTokens: DEFAULT_OUTPUT_TOKENS },
    );
    expect(text).toBe(SUMMARY_TEXT);
  });
});

describe('compaction.reserveTokens (#1808)', () => {
  test('the daemon keeps the upstream default, and that default fits the 128000 context with a 16384 output cap', () => {
    const reserveTokens = daemonSettingsManager().getCompactionSettings().reserveTokens;
    expect(reserveTokens).toBe(16_384);
    expect(DEFAULT_CONTEXT_WINDOW - reserveTokens).toBeGreaterThanOrEqual(DEFAULT_OUTPUT_TOKENS);
  });
});
