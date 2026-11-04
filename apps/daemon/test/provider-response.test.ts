import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  describeProviderResponse,
  enrichProviderError,
  isEventStreamContentType,
  type ProviderResponseShape,
  type ProviderResponseSink,
  RESPONSE_PREVIEW_CHARS,
  sanitizePreview,
  wrapProviderFetch,
} from '../src/backend/provider-response.js';

const HTML_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div></body></html>';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/v1/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    if (url.startsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }
    if (url.startsWith('/nocontenttype')) {
      res.writeHead(200);
      res.end('plain body');
      return;
    }
    if (url.startsWith('/big')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${'x'.repeat(900)}\n\t\u0000tail`);
      return;
    }
    if (url.startsWith('/empty')) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"model not found"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function record(path: string): Promise<{ sink: ProviderResponseSink; text: string }> {
  const sink: ProviderResponseSink = { current: null };
  const response = await wrapProviderFetch(globalThis.fetch, sink)(`${baseUrl}${path}`);
  const text = await response.text();
  return { sink, text };
}

const CTX = { machineName: 't6-mac', providerBaseUrl: 'http://api.example.com' };

describe('isEventStreamContentType (pure function)', () => {
  test('failure mode 5: mixed-case and charset parameter still recognized', () => {
    expect(isEventStreamContentType('text/event-stream')).toBe(true);
    expect(isEventStreamContentType('TEXT/Event-Stream; charset=utf-8')).toBe(true);
    expect(isEventStreamContentType('text/html')).toBe(false);
    expect(isEventStreamContentType('application/json')).toBe(false);
    expect(isEventStreamContentType(null)).toBe(false);
  });
});

describe('sanitizePreview (pure function)', () => {
  test('failure mode 6: control characters collapsed + truncation with ellipsis', () => {
    expect(sanitizePreview('a\n\tb\u0000c')).toBe('a b c');
    const long = sanitizePreview('x'.repeat(1000));
    expect(long.length).toBe(RESPONSE_PREVIEW_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('wrapProviderFetch (real HTTP, three shapes)', () => {
  test('failure mode 1: proper SSE → eventStream bit recorded, body not read, response body left consumable as-is', async () => {
    const { sink, text } = await record('/v1/chat/completions');
    expect(sink.current).toMatchObject({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      eventStream: true,
      preview: null,
    });
    expect(text).toContain('"finish_reason":"stop"');
  });

  test('failure mode 2: 200 text/html → records status / content-type / first bytes', async () => {
    const { sink, text } = await record('/chat/completions');
    expect(sink.current?.status).toBe(200);
    expect(sink.current?.contentType).toBe('text/html; charset=utf-8');
    expect(sink.current?.eventStream).toBe(false);
    expect(sink.current?.preview).toContain('<!doctype html>');
    expect(sink.current?.url).toBe(`${baseUrl}/chat/completions`);
    expect(text).toBe(HTML_PAGE);
  });

  test('failure mode 3: 404 application/json → status and type recorded truthfully', async () => {
    const { sink, text } = await record('/v1/unknown');
    expect(sink.current).toMatchObject({
      status: 404,
      contentType: 'application/json',
      eventStream: false,
    });
    expect(text).toBe('{"error":"model not found"}');
  });

  test('failure mode 4: missing content-type → judged non-SSE, summary still readable', async () => {
    const { sink } = await record('/nocontenttype');
    expect(sink.current?.contentType).toBeNull();
    expect(sink.current?.eventStream).toBe(false);
    expect(sink.current?.preview).toBe('plain body');
  });

  test('failure mode 7: 204 no body → summary degrades to null, no throw', async () => {
    const { sink } = await record('/empty');
    expect(sink.current).toMatchObject({ status: 204, eventStream: false, preview: null });
  });

  test('failure mode 9: request init passed through verbatim (diagnostic layer does not rewrite the request)', async () => {
    const sink: ProviderResponseSink = { current: null };
    const seen: string[] = [];
    const spy: typeof globalThis.fetch = async (input, init) => {
      seen.push(JSON.stringify(init));
      return globalThis.fetch(input as string, init);
    };
    const response = await wrapProviderFetch(spy, sink)(`${baseUrl}/v1/chat/completions`, {
      headers: { authorization: 'Bearer test' },
    });
    await response.text();
    expect(seen).toEqual([JSON.stringify({ headers: { authorization: 'Bearer test' } })]);
  });
});

describe('enrichProviderError (three shapes distinguishable by wording)', () => {
  test('failure mode 2: 200 HTML wording names all three culprits', async () => {
    const { sink } = await record('/chat/completions');
    const text = enrichProviderError('Stream ended without finish_reason', sink.current, CTX);
    expect(text).toContain('Stream ended without finish_reason');
    expect(text).toContain(`POST ${baseUrl}/chat/completions -> 200 text/html; charset=utf-8`);
    expect(text).toContain('(not an SSE stream)');
    expect(text).toContain('provider baseUrl "http://api.example.com"');
    expect(text).toContain('machine "t6-mac"');
    expect(text).toContain('first bytes: "<!doctype html>');
  });

  test('failure mode 3: 4xx wording differs from 200 HTML wording (status and type both named)', async () => {
    const html = await record('/chat/completions');
    const missing = await record('/v1/unknown');
    const htmlText = enrichProviderError(
      'Stream ended without finish_reason',
      html.sink.current,
      CTX,
    );
    const missingText = enrichProviderError(
      '404: {"error":"model not found"}',
      missing.sink.current,
      CTX,
    );
    expect(missingText).toContain('-> 404 application/json');
    expect(missingText).toContain('machine "t6-mac"');
    expect(missingText).not.toBe(htmlText);
  });

  test('failure modes 1/10: errors on SSE responses get no shape appended', async () => {
    const { sink } = await record('/v1/chat/completions');
    expect(enrichProviderError('Stream ended without finish_reason', sink.current, CTX)).toBe(
      'Stream ended without finish_reason',
    );
  });

  test('failure mode 11: no record recorded (adapter does not consume the injected bit) → returned as-is', () => {
    expect(enrichProviderError('500: upstream unavailable', null, CTX)).toBe(
      '500: upstream unavailable',
    );
  });

  test('failure mode 4: missing content-type shape still reported', async () => {
    const { sink } = await record('/nocontenttype');
    expect(enrichProviderError('boom', sink.current, CTX)).toContain('(no content-type)');
  });

  test('failure mode 8: no baseUrl / no machine name → those two clauses disappear', () => {
    const shape: ProviderResponseShape = {
      url: 'http://127.0.0.1:9/chat/completions',
      status: 200,
      statusText: 'OK',
      contentType: 'text/html',
      eventStream: false,
      retryAfterMs: null,
      preview: '<html>',
    };
    const text = describeProviderResponse(shape, {});
    expect(text).not.toContain('provider baseUrl');
    expect(text).not.toContain('machine');
    expect(text).toContain('POST http://127.0.0.1:9/chat/completions -> 200 text/html');
  });
});
