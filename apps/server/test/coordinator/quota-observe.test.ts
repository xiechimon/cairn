import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { routeOf } from '../../src/coordinator/credentials.js';
import { providerBinding } from '../../src/coordinator/provider-binding.js';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { claudeSubscription } from '../../src/db/schema.js';
import { createProvider } from '../../src/services/providers.js';
import { bootServer, insertClaudeSubscription, req, type TestServer } from '../helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const QUOTA_HEADERS = {
  'content-type': 'text/event-stream',
  'anthropic-ratelimit-unified-status': 'allowed',
  'anthropic-ratelimit-unified-representative-claim': 'five_hour',
  'anthropic-ratelimit-unified-5h-utilization': '0.18',
  'anthropic-ratelimit-unified-5h-reset': '1800000000',
  'anthropic-ratelimit-unified-7d-utilization': '0.44',
  'anthropic-ratelimit-unified-7d-reset': '1800500000',
};

const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-haiku-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

function quotaWindows(s: TestServer, subscriptionId: string) {
  return s.db
    .select({ quotaWindows: claudeSubscription.quotaWindows })
    .from(claudeSubscription)
    .where(eq(claudeSubscription.id, subscriptionId))
    .get()?.quotaWindows;
}

function addAnthropicProvider(s: TestServer, apiKey: string, modelId = 'claude-haiku-5-5'): string {
  return createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId: 'anthropic',
        label: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        models: [{ id: modelId, name: modelId }],
        apiKey,
      },
      createdBy: 'quota-observe-test',
    },
  ).id;
}

async function runCoordinatorTurn(s: TestServer, fetchImpl: typeof globalThis.fetch) {
  const route = routeOf(
    { db: s.db, box: s.secretBox },
    s.team.id,
    'anthropic',
    'claude-haiku-5-5',
    null,
  );
  if (route === null) throw new Error('anthropic route missing');
  const binding = providerBinding({ db: s.db, box: s.secretBox }, s.team.id, route);
  const models = createCoordinatorModels();
  models.useProvider(binding.config, binding.resolveKey, binding.observe);
  const model = models.models.getModel('anthropic', 'claude-haiku-5-5');
  if (model === undefined) throw new Error('model missing');
  const reply = await models.models
    .streamSimple(
      model,
      { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
      {
        fetch: fetchImpl,
      },
    )
    .result();
  if (reply.stopReason === 'error') throw new Error(`turn failed: ${reply.errorMessage ?? ''}`);
}

describe('quota observations from real Claude calls', () => {
  test('a coordinator turn on the subscription token feeds the tray quota with no probe', async () => {
    const s = bootServer();
    const subscriptionId = insertClaudeSubscription(s);
    const token = s.db
      .select({ tokenCipher: claudeSubscription.tokenCipher })
      .from(claudeSubscription)
      .where(eq(claudeSubscription.id, subscriptionId))
      .get();
    const plaintext = s.secretBox.open(token!.tokenCipher);
    addAnthropicProvider(s, plaintext);
    const anthropicCalls: string[] = [];
    const upstream = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      const target = String(url);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { max_tokens?: number };
        anthropicCalls.push(`${target} max_tokens=${body.max_tokens ?? '?'}`);
      } else {
        anthropicCalls.push(target);
      }
      return new Response(SSE, { status: 200, headers: QUOTA_HEADERS });
    });
    await runCoordinatorTurn(s, upstream);
    expect(quotaWindows(s, subscriptionId)).toEqual([
      expect.objectContaining({
        subscription: 'five_hour',
        status: 'allowed',
        utilization: 0.18,
        resetsAt: 1_800_000_000_000,
      }),
      expect.objectContaining({
        subscription: 'seven_day',
        status: 'allowed',
        utilization: 0.44,
        resetsAt: 1_800_500_000_000,
      }),
    ]);
    const probes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async (url) => {
        probes.push(String(url));
        return new Response('{}', { status: 403 });
      }),
    );
    const refreshed = (await (
      await req(s.app, 'POST', `/api/teams/${s.team.id}/claude-subscriptions/quota`)
    ).json()) as { windows: { name: string; utilization: number }[] }[];
    expect(refreshed[0]?.windows).toEqual([
      expect.objectContaining({ name: 'five_hour', utilization: 0.18 }),
      expect.objectContaining({ name: 'seven_day', utilization: 0.44 }),
    ]);
    expect(probes.filter((url) => url.includes('/v1/messages'))).toEqual([]);
    s.dispose();
  });

  test('headers on a provider whose key is not a subscription token write nothing', async () => {
    const s = bootServer();
    const subscriptionId = insertClaudeSubscription(s);
    addAnthropicProvider(s, 'sk-ant-not-the-subscription-token');
    const upstream = vi.fn<typeof globalThis.fetch>(
      async () => new Response(SSE, { status: 200, headers: QUOTA_HEADERS }),
    );
    await runCoordinatorTurn(s, upstream);
    expect(quotaWindows(s, subscriptionId) ?? null).toBeNull();
    s.dispose();
  });
});
