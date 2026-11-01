import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ProviderConfig, SessionOpts } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  type AgentSessionEventLike,
  createPiBackend,
  mapPiSessionEvent,
  newMapState,
  sessionCompactionSettings,
} from '../src/backend/pi.js';

const SUMMARY = '## Goal\nKeep the billing migration on build-07.';
const LONG_REPLY = `Done. ${'The Kestrel migration status line. '.repeat(120)}`;

function sse(text: string, promptTokens: number): string {
  const chunk = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
  return [
    chunk({
      id: 'x',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    }),
    chunk({
      id: 'x',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: 40,
        total_tokens: promptTokens + 40,
      },
    }),
    'data: [DONE]\n\n',
  ].join('');
}

interface Gateway {
  url: string;
  summaryRequests: number;
  holdSummary: boolean;
}

let server: Server;
let gateway: Gateway;
let home: string;

beforeEach(async () => {
  home = makeTestTempDir('pi-compact-');
  gateway = { url: '', summaryRequests: 0, holdSummary: false };
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => {
      body += c.toString();
    });
    req.on('end', () => {
      const summary = body.includes('summar');
      if (summary) gateway.summaryRequests += 1;
      if (summary && gateway.holdSummary) return;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse(summary ? SUMMARY : LONG_REPLY, 900));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  gateway.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  releaseTestTempDir(home);
});

function provider(): ProviderConfig {
  return {
    kind: 'api_key',
    providerId: 'fakegw',
    baseUrl: gateway.url,
    api: 'openai-completions',
    apiKey: 'test-key',
    compat: { maxTokensField: 'max_tokens', supportsStore: false },
    models: [{ id: 'm', name: 'm', contextWindow: 128_000, maxTokens: 4096 }],
  };
}

function world() {
  const files = new Map<string, string>();
  const backend = createPiBackend({
    agentDir: join(home, 'agent'),
    sessionDir: join(home, 'sessions'),
    resolveSessionFile: (id) => files.get(id) ?? null,
    onSession: (id, file) => {
      if (file !== undefined) files.set(id, file);
    },
  });
  const opts = (over: Partial<SessionOpts> = {}): SessionOpts => ({
    provider: provider(),
    modelId: 'm',
    cwd: home,
    compaction: { thresholdTokens: 64_000, keepRecentTokens: 200 },
    ...over,
  });
  return { backend, files, opts };
}

async function turn(
  w: ReturnType<typeof world>,
  prompt: string,
  sessionId: string | null,
): Promise<string> {
  const handle =
    sessionId === null
      ? await w.backend.createSession(w.opts({ prompt }))
      : await w.backend.continueSession(sessionId, w.opts({ prompt }));
  for await (const ev of handle.events) {
    if (ev.type === 'error') throw new Error(ev.error.message);
  }
  return handle.sessionId;
}

function compactionEntries(file: string): number {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.includes('"type":"compaction"')).length;
}

describe('pi compacts a resumed Coordinator session on request', () => {
  test('a compaction appends one summary entry and reports its usage', async () => {
    const w = world();
    const id = await turn(w, 'first question', null);
    await turn(w, 'second question', id);
    await turn(w, 'third question', id);
    const result = await w.backend.compactSession?.(id, w.opts(), new AbortController().signal);
    expect(gateway.summaryRequests).toBeGreaterThan(0);
    expect(result).toMatchObject({
      compacted: true,
      usage: [
        {
          model: 'fakegw/m',
          input: 900 * gateway.summaryRequests,
          output: 40 * gateway.summaryRequests,
        },
      ],
    });
    expect(result?.summaryTokens).toBeGreaterThanOrEqual(Math.ceil(SUMMARY.length / 4));
    expect(result?.tokensBefore).toBeGreaterThan(0);
    expect(compactionEntries(w.files.get(id) ?? '')).toBe(1);
  }, 20_000);

  test('a session pi already compacted at its tip counts as compacted without a new summary', async () => {
    const w = world();
    const id = await turn(w, 'first question', null);
    await turn(w, 'second question', id);
    await turn(w, 'third question', id);
    await w.backend.compactSession?.(id, w.opts(), new AbortController().signal);
    const requests = gateway.summaryRequests;
    const again = await w.backend.compactSession?.(id, w.opts(), new AbortController().signal);
    expect(again).toEqual({
      compacted: true,
      tokensBefore: null,
      tokensAfter: null,
      summaryTokens: null,
      usage: [],
    });
    expect(gateway.summaryRequests).toBe(requests);
    expect(compactionEntries(w.files.get(id) ?? '')).toBe(1);
  }, 20_000);

  test('an abort mid-summary leaves the session file without a compaction', async () => {
    const w = world();
    const id = await turn(w, 'first question', null);
    await turn(w, 'second question', id);
    await turn(w, 'third question', id);
    gateway.holdSummary = true;
    const abort = new AbortController();
    const running = w.backend.compactSession?.(id, w.opts(), abort.signal);
    await expect.poll(() => gateway.summaryRequests).toBeGreaterThan(0);
    abort.abort();
    await expect(running).rejects.toThrow(/abort|cancel/i);
    expect(compactionEntries(w.files.get(id) ?? '')).toBe(0);
  }, 20_000);

  test('a session too small to compact reports nothing compacted and pays nothing', async () => {
    const w = world();
    const id = await turn(w, 'hi', null);
    const result = await w.backend.compactSession?.(
      id,
      w.opts({ compaction: { thresholdTokens: 64_000, keepRecentTokens: 100_000 } }),
      new AbortController().signal,
    );
    expect(result).toEqual({
      compacted: false,
      tokensBefore: null,
      tokensAfter: null,
      summaryTokens: null,
      usage: [],
    });
    expect(gateway.summaryRequests).toBe(0);
  }, 20_000);
});

describe('turn usage carries the context size the next turn starts from', () => {
  const end = (input: number, cacheRead: number, stopReason = 'stop'): AgentSessionEventLike => ({
    type: 'message_end',
    message: {
      role: 'assistant',
      provider: 'gw',
      model: 'm',
      stopReason,
      usage: { input, output: 10, cacheRead, cacheWrite: 0 },
    },
  });

  test('it is the last request of the turn, not the sum over requests', () => {
    const state = newMapState();
    mapPiSessionEvent(end(1000, 40_000), state);
    mapPiSessionEvent(end(500, 41_200), state);
    mapPiSessionEvent(end(9, 0, 'error'), state);
    const [done] = mapPiSessionEvent({ type: 'agent_settled' }, state);
    expect(done).toMatchObject({
      usage: [{ input: 1509, cacheRead: 81_200, contextTokens: 500 + 10 + 41_200 }],
    });
  });
});

describe('server-tuned compaction maps onto pi reserve tokens', () => {
  test('the threshold becomes window minus threshold', () => {
    expect(
      sessionCompactionSettings({ thresholdTokens: 64_000, keepRecentTokens: 16_384 }, 1_000_000),
    ).toEqual({ enabled: true, reserveTokens: 936_000, keepRecentTokens: 16_384 });
  });

  test('a window smaller than the threshold keeps pi default reserve', () => {
    expect(
      sessionCompactionSettings({ thresholdTokens: 64_000, keepRecentTokens: 16_384 }, 32_000),
    ).toEqual({ enabled: true, reserveTokens: 16_384, keepRecentTokens: 16_384 });
  });

  test('without tuning the session keeps pi defaults', () => {
    expect(sessionCompactionSettings(undefined, 128_000)).toEqual({
      enabled: true,
      reserveTokens: 16_384,
      keepRecentTokens: 20_000,
    });
  });
});
