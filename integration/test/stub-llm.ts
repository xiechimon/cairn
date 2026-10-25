import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubResponse {
  content?: string;
  delayMs?: number;
  usage?: { prompt: number; completion: number; cached?: number };
  toolCall?: { id?: string; name: string; arguments: Record<string, unknown> };
  status?: number;
}

export interface StubRequest {
  messages: { role: string; content?: unknown }[];
  model?: string;
  stream?: boolean;
}

export interface StubLlm {
  url: string;
  requests: StubRequest[];
  requestTimes: number[];
  close(): Promise<void>;
}

const DEFAULT_USAGE = { prompt: 12, completion: 980, cached: 100 };

function chunk(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function startStubLlm(
  responses: StubResponse[],
  opts: { onConsumed?: () => void } = {},
): Promise<StubLlm> {
  const requests: StubRequest[] = [];
  const requestTimes: number[] = [];
  let next = 0;
  const server: Server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (d) => {
      body += d;
    });
    req.on('end', () => {
      requestTimes.push(Date.now());
      requests.push(JSON.parse(body) as StubRequest);
      const rsp = responses[Math.min(next, responses.length - 1)] ?? { content: 'ok' };
      next += 1;
      const usage = rsp.usage ?? DEFAULT_USAGE;
      const send = () => {
        // pi-ai session-level auto_retry matches errorMessage against
        // RETRYABLE_PROVIDER_ERROR_PATTERN (retry.js, includes `server.?error`):
        // 5xx must be typed server_error (retriable, absorbed at stream level);
        // 4xx must be invalid_request_error (not retriable, step-level failure).
        if (rsp.status !== undefined && rsp.status >= 400) {
          const errType = rsp.status >= 500 ? 'server_error' : 'invalid_request_error';
          res.writeHead(rsp.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'stub provider error', type: errType } }));
          opts.onConsumed?.();
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        });
        const base = {
          id: 'chatcmpl-stub',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'stub-model',
        };
        res.write(
          chunk({
            ...base,
            choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
          }),
        );
        if (rsp.toolCall) {
          const callId = rsp.toolCall.id ?? `call-stub-${requests.length}`;
          res.write(
            chunk({
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: callId,
                        type: 'function',
                        function: { name: rsp.toolCall.name, arguments: '' },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }),
          );
          res.write(
            chunk({
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: { arguments: JSON.stringify(rsp.toolCall?.arguments ?? {}) },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            }),
          );
          res.write(
            chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
          );
        } else {
          for (const word of (rsp.content ?? 'ok').split(/(?<=。|\.|\s)/u)) {
            if (word === '') continue;
            res.write(chunk({ ...base, choices: [{ index: 0, delta: { content: word } }] }));
          }
          res.write(chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
        }
        res.write(
          chunk({
            ...base,
            choices: [],
            usage: {
              prompt_tokens: usage.prompt,
              completion_tokens: usage.completion,
              total_tokens: usage.prompt + usage.completion,
              prompt_tokens_details: { cached_tokens: usage.cached ?? 0 },
            },
          }),
        );
        res.write('data: [DONE]\n\n');
        res.end();
        opts.onConsumed?.();
      };
      if (rsp.delayMs) setTimeout(send, rsp.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    requestTimes,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
