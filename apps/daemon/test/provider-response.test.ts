// #882 非 SSE 响应诊断测试面。失败方式枚举先于实现固化（仓规测试规则 3）：
//   1. 正确 SSE（200 text/event-stream）→ 记 eventStream、不读体；文案零追加
//   2. 200 text/html（baseUrl 少 `/v1` 的现场）→ 文案点名 status / content-type
//      / 前若干字节 / 请求 URL / provider baseUrl / 机器名
//   3. 非 2xx（404 application/json）→ 文案与 1、2 都不同（含端点与机器）
//   4. content-type 缺失 → 判非 SSE，文案给 (no content-type)
//   5. content-type 大小写混写 + charset 参数 → 仍判 SSE
//   6. 超长 / 带控制字符的响应体 → 摘要折叠截断、不炸
//   7. 响应体不可读（204 无体）→ 摘要降级为缺省，主文案不受影响
//   8. 无 provider baseUrl / 无机器名 → 对应子句消失，其余照旧
//   9. 注入的 fetch 不改写请求与响应：状态、头、体逐字透传
//  10. SSE 响应上出的错（流中途断 / 模型报错）→ 不追加形态（与端点无关）
//  11. 无记录（适配器不吃注入位 / 请求没发出去）→ 原样返回（fail-open）

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
      // baseUrl 少了 `/v1`：请求被打到站点 SPA 路由，回一张 HTML 页面。
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

/** 走真 HTTP 拿一份记录（诊断模块唯一的输入就是响应本身）。 */
async function record(path: string): Promise<{ sink: ProviderResponseSink; text: string }> {
  const sink: ProviderResponseSink = { current: null };
  const response = await wrapProviderFetch(globalThis.fetch, sink)(`${baseUrl}${path}`);
  const text = await response.text(); // 消费真响应体：证明没被诊断层吃掉
  return { sink, text };
}

const CTX = { machineName: 't6-mac', providerBaseUrl: 'http://api.example.com' };

describe('isEventStreamContentType（纯函数）', () => {
  test('失败方式 5：大小写混写与 charset 参数照认', () => {
    expect(isEventStreamContentType('text/event-stream')).toBe(true);
    expect(isEventStreamContentType('TEXT/Event-Stream; charset=utf-8')).toBe(true);
    expect(isEventStreamContentType('text/html')).toBe(false);
    expect(isEventStreamContentType('application/json')).toBe(false);
    expect(isEventStreamContentType(null)).toBe(false);
  });
});

describe('sanitizePreview（纯函数）', () => {
  test('失败方式 6：控制字符折叠 + 截断带省略号', () => {
    expect(sanitizePreview('a\n\tb\u0000c')).toBe('a b c');
    const long = sanitizePreview('x'.repeat(1000));
    expect(long.length).toBe(RESPONSE_PREVIEW_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('wrapProviderFetch（真 HTTP 三形态）', () => {
  test('失败方式 1：正确 SSE → eventStream 位记上、不读体、响应体原样可消费', async () => {
    const { sink, text } = await record('/v1/chat/completions');
    expect(sink.current).toMatchObject({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      eventStream: true,
      preview: null,
    });
    expect(text).toContain('"finish_reason":"stop"');
  });

  test('失败方式 2：200 text/html → 记 status / content-type / 前若干字节', async () => {
    const { sink, text } = await record('/chat/completions');
    expect(sink.current?.status).toBe(200);
    expect(sink.current?.contentType).toBe('text/html; charset=utf-8');
    expect(sink.current?.eventStream).toBe(false);
    expect(sink.current?.preview).toContain('<!doctype html>');
    expect(sink.current?.url).toBe(`${baseUrl}/chat/completions`);
    // 注入层不改写响应：SDK 拿到的还是那张真页面。
    expect(text).toBe(HTML_PAGE);
  });

  test('失败方式 3：404 application/json → 状态与类型如实记录', async () => {
    const { sink, text } = await record('/v1/unknown');
    expect(sink.current).toMatchObject({
      status: 404,
      contentType: 'application/json',
      eventStream: false,
    });
    expect(text).toBe('{"error":"model not found"}');
  });

  test('失败方式 4：content-type 缺失 → 判非 SSE，摘要仍可读', async () => {
    const { sink } = await record('/nocontenttype');
    expect(sink.current?.contentType).toBeNull();
    expect(sink.current?.eventStream).toBe(false);
    expect(sink.current?.preview).toBe('plain body');
  });

  test('失败方式 7：204 无体 → 摘要降级 null，不抛', async () => {
    const { sink } = await record('/empty');
    expect(sink.current).toMatchObject({ status: 204, eventStream: false, preview: null });
  });

  test('失败方式 9：请求 init 原样透传（诊断层不改写请求）', async () => {
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

describe('enrichProviderError（三形态文案可区分）', () => {
  test('失败方式 2：200 HTML 的文案把真凶三件都点上', async () => {
    const { sink } = await record('/chat/completions');
    const text = enrichProviderError('Stream ended without finish_reason', sink.current, CTX);
    expect(text).toContain('Stream ended without finish_reason');
    expect(text).toContain(`POST ${baseUrl}/chat/completions -> 200 text/html; charset=utf-8`);
    expect(text).toContain('(not an SSE stream)');
    expect(text).toContain('provider baseUrl "http://api.example.com"');
    expect(text).toContain('machine "t6-mac"');
    expect(text).toContain('first bytes: "<!doctype html>');
  });

  test('失败方式 3：4xx 文案与 200 HTML 文案不同（状态与类型都点出来）', async () => {
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

  test('失败方式 1 / 10：SSE 响应上的错不追加形态', async () => {
    const { sink } = await record('/v1/chat/completions');
    expect(enrichProviderError('Stream ended without finish_reason', sink.current, CTX)).toBe(
      'Stream ended without finish_reason',
    );
  });

  test('失败方式 11：没有记录（适配器不吃注入位）→ 原样返回', () => {
    expect(enrichProviderError('500: upstream unavailable', null, CTX)).toBe(
      '500: upstream unavailable',
    );
  });

  test('失败方式 4：content-type 缺失的形态照报', async () => {
    const { sink } = await record('/nocontenttype');
    expect(enrichProviderError('boom', sink.current, CTX)).toContain('(no content-type)');
  });

  test('失败方式 8：无 baseUrl / 无机器名 → 那两个子句消失', () => {
    const shape: ProviderResponseShape = {
      url: 'http://127.0.0.1:9/chat/completions',
      status: 200,
      statusText: 'OK',
      contentType: 'text/html',
      eventStream: false,
      retryAfterMs: null, // #1261 字段位（无头恒 null）
      preview: '<html>',
    };
    const text = describeProviderResponse(shape, {});
    expect(text).not.toContain('provider baseUrl');
    expect(text).not.toContain('machine');
    expect(text).toContain('POST http://127.0.0.1:9/chat/completions -> 200 text/html');
  });
});
