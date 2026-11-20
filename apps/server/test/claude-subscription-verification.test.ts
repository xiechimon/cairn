import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import {
  probeClaudeSubscriptionModel,
  verifyClaudeSubscription,
} from '../src/services/claude-subscription-verification.js';

const TOKEN = `sk-ant-oat01-verification-test-token-${'z'.repeat(60)}`;

const modelsPage = (ids: string[] = ['claude-opus-5-5']) =>
  new Response(
    JSON.stringify({
      data: ids.map((id) => ({ id, display_name: id })),
      has_more: false,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('verifyClaudeSubscription (oauth /v1/models probe, no model call)', () => {
  test('a 200 token list verifies the token', async () => {
    const stub = vi.fn<typeof globalThis.fetch>(async () => modelsPage());
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({ ok: true });
    const [url, init] = stub.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/models?limit=1000');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(String(url)).not.toContain(TOKEN);
  });

  test('verification never spawns the claude binary or sends a prompt', async () => {
    const source = readFileSync(
      new URL('../src/services/claude-subscription-verification.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('child_process');
    expect(source).not.toContain('execFile');
    const stub = vi.fn<typeof globalThis.fetch>(async () => modelsPage());
    await verifyClaudeSubscription(TOKEN, { fetch: stub });
    for (const [url, init] of stub.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(String(url)).not.toContain('messages');
    }
  });

  test.each([401, 403])('HTTP %d is classified as auth', async (status) => {
    const stub = vi.fn(async () => new Response('{"error":"invalid"}', { status }));
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'auth',
    });
  });

  test('HTTP 429 is classified as quota', async () => {
    const stub = vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 }));
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'quota',
    });
  });

  test.each([500, 502, 503])('HTTP %d is classified as unavailable', async (status) => {
    const stub = vi.fn(async () => new Response('oops', { status }));
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  test('a network error is classified as unavailable', async () => {
    const stub = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  test('an aborted request is classified as timeout', async () => {
    const stub = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub, timeoutMs: 50 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  test('an empty model list is classified as failed', async () => {
    const stub = vi.fn<typeof globalThis.fetch>(async () => modelsPage([]));
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  test('a malformed success body is classified as failed', async () => {
    const stub = vi.fn(async () => new Response('<html>ok</html>', { status: 200 }));
    expect(await verifyClaudeSubscription(TOKEN, { fetch: stub })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  test('the token never appears in the result or in logs-facing fields', async () => {
    const stub = vi.fn(async () => new Response(`unauthorized ${TOKEN}`, { status: 401 }));
    const result = await verifyClaudeSubscription(TOKEN, { fetch: stub });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain('sk-ant');
  });
});

describe('probeClaudeSubscriptionModel (per-model /v1/messages ping)', () => {
  test('posts a one-token message for the requested model', async () => {
    const stub = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{"type":"message"}', { status: 200 }),
    );
    expect(await probeClaudeSubscriptionModel(TOKEN, 'claude-opus-5-5', { fetch: stub })).toEqual({
      ok: true,
    });
    const [url, init] = stub.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1,
    });
  });

  test.each([
    [401, 'auth'],
    [429, 'quota'],
    [500, 'unavailable'],
  ])('HTTP %d maps to %s', async (status, reason) => {
    const stub = vi.fn(async () => new Response('oops', { status }));
    expect(await probeClaudeSubscriptionModel(TOKEN, 'claude-opus-5-5', { fetch: stub })).toEqual({
      ok: false,
      reason,
    });
  });

  test('an aborted request is classified as timeout', async () => {
    const stub = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    expect(
      await probeClaudeSubscriptionModel(TOKEN, 'claude-opus-5-5', { fetch: stub, timeoutMs: 50 }),
    ).toEqual({ ok: false, reason: 'timeout' });
  });
});
