import {
  type ProviderApi,
  type ProviderTestError,
  type ProviderTestResult,
  redactSecrets,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { provider } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { openProviderKey, type ProviderDeps } from './providers.js';

export const PROVIDER_TEST_TIMEOUT_MS = 10_000;
export const PROVIDER_TEST_MAX_TOKENS = 8;
export const PROVIDER_TEST_LIMIT = 5;
export const PROVIDER_TEST_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 300;
const ANTHROPIC_VERSION = '2023-06-01';

export class ProviderTestLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number = PROVIDER_TEST_LIMIT,
    private readonly windowMs: number = PROVIDER_TEST_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  take(providerRowId: string): void {
    const now = this.now();
    const recent = (this.hits.get(providerRowId) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(providerRowId, recent);
      throw new HttpError(429, 'too many connection tests for this provider; try again shortly');
    }
    recent.push(now);
    this.hits.set(providerRowId, recent);
  }
}

export interface ProviderTestDeps extends ProviderDeps {
  fetch: FetchLike;
  timeoutMs?: number;
}

type ProviderRow = typeof provider.$inferSelect;

interface Endpoints {
  models: string;
  chat: string;
}

function endpointsFor(api: ProviderApi, baseUrl: string): Endpoints {
  const base = baseUrl.replace(/\/+$/, '');
  if (api === 'anthropic-messages') {
    return { models: `${base}/v1/models`, chat: `${base}/v1/messages` };
  }
  return {
    models: `${base}/models`,
    chat: api === 'openai-responses' ? `${base}/responses` : `${base}/chat/completions`,
  };
}

function headersFor(row: ProviderRow, apiKey: string): Record<string, string> {
  const anthropic = row.api === 'anthropic-messages';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (anthropic) headers['anthropic-version'] = ANTHROPIC_VERSION;
  if (row.authHeader) headers.authorization = `Bearer ${apiKey}`;
  else headers[anthropic ? 'x-api-key' : 'api-key'] = apiKey;
  return headers;
}

function chatBody(api: ProviderApi, model: string): Record<string, unknown> {
  if (api === 'openai-responses') {
    return { model, input: 'ping', max_output_tokens: PROVIDER_TEST_MAX_TOKENS };
  }
  return {
    model,
    max_tokens: PROVIDER_TEST_MAX_TOKENS,
    messages: [{ role: 'user', content: 'ping' }],
  };
}

function scrub(text: string, apiKey: string): string {
  const literal = apiKey === '' ? text : text.split(apiKey).join('[REDACTED]');
  const redacted = redactSecrets(literal).value as string;
  return redacted.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_LIMIT);
}

function errorTypeOf(status: number): ProviderTestError['type'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'other';
}

function messageFromBody(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const err = parsed.error;
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    return raw;
  }
  return raw;
}

function transportError(err: unknown, apiKey: string): ProviderTestError {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { type: 'timeout', message: 'the provider did not answer in time' };
  }
  const message = err instanceof Error ? err.message : 'request failed';
  return { type: 'network', message: scrub(message, apiKey) };
}

interface Outcome<T> {
  httpStatus: number | null;
  latencyMs: number;
  value: T | null;
  error: ProviderTestError | null;
}

async function call<T>(
  deps: ProviderTestDeps,
  apiKey: string,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  parse: (json: unknown) => T | null,
): Promise<Outcome<T>> {
  const started = Date.now();
  try {
    const res = await deps.fetch(url, {
      ...init,
      signal: AbortSignal.timeout(deps.timeoutMs ?? PROVIDER_TEST_TIMEOUT_MS),
    });
    const raw = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        httpStatus: res.status,
        latencyMs,
        value: null,
        error: { type: errorTypeOf(res.status), message: scrub(messageFromBody(raw), apiKey) },
      };
    }
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
    const value = parse(json);
    return {
      httpStatus: res.status,
      latencyMs,
      value,
      error:
        value === null
          ? { type: 'invalid_response', message: 'the provider answered with an unexpected body' }
          : null,
    };
  } catch (err) {
    return {
      httpStatus: null,
      latencyMs: Date.now() - started,
      value: null,
      error: transportError(err, apiKey),
    };
  }
}

function parseModelIds(json: unknown): string[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  return data.flatMap((item) => {
    const id = (item as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id !== '' ? [id] : [];
  });
}

function parseEchoedModel(json: unknown): { echoed: string | null } | null {
  if (typeof json !== 'object' || json === null) return null;
  const model = (json as { model?: unknown }).model;
  return { echoed: typeof model === 'string' ? model : null };
}

function cheapestConfiguredModel(row: ProviderRow): string | null {
  const price = (m: ProviderRow['models'][number]) => (m.cost?.input ?? 0) + (m.cost?.output ?? 0);
  const priced = row.models.filter((m) => m.cost !== undefined).sort((a, b) => price(a) - price(b));
  return priced[0]?.id ?? row.models[0]?.id ?? null;
}

const EMPTY_PROBE: ProviderTestResult['probe'] = {
  requestedModel: null,
  echoedModel: null,
  httpStatus: null,
  latencyMs: null,
  error: null,
};

const EMPTY_LISTING: ProviderTestResult['listing'] = {
  httpStatus: null,
  modelCount: null,
  latencyMs: null,
  error: null,
};

export async function testProviderConnection(
  deps: ProviderTestDeps,
  input: { teamId: string; id: string; model?: string },
): Promise<ProviderTestResult> {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.id, input.id), eq(provider.teamId, input.teamId)))
    .get();
  if (!row) throw notFound(`provider ${input.id}`);
  const apiKey = openProviderKey(deps, input.teamId, row.providerId)?.apiKey ?? null;
  if (apiKey === null) {
    return {
      status: 'failed',
      listing: EMPTY_LISTING,
      probe: { ...EMPTY_PROBE, error: { type: 'no_key', message: 'no API key is stored' } },
    };
  }

  const endpoints = endpointsFor(row.api, row.baseUrl);
  const headers = headersFor(row, apiKey);
  const listed = await call(
    deps,
    apiKey,
    endpoints.models,
    { method: 'GET', headers },
    parseModelIds,
  );
  const listing: ProviderTestResult['listing'] = {
    httpStatus: listed.httpStatus,
    modelCount: listed.value?.length ?? null,
    latencyMs: listed.latencyMs,
    error: listed.error,
  };

  const model = input.model ?? cheapestConfiguredModel(row) ?? listed.value?.[0] ?? null;
  if (model === null) {
    return {
      status: 'failed',
      listing,
      probe: { ...EMPTY_PROBE, error: { type: 'no_model', message: 'no model to test' } },
    };
  }

  const probed = await call(
    deps,
    apiKey,
    endpoints.chat,
    { method: 'POST', headers, body: JSON.stringify(chatBody(row.api, model)) },
    parseEchoedModel,
  );
  return {
    status: probed.error === null ? 'ok' : 'failed',
    listing,
    probe: {
      requestedModel: model,
      echoedModel: probed.value?.echoed ?? null,
      httpStatus: probed.httpStatus,
      latencyMs: probed.latencyMs,
      error: probed.error,
    },
  };
}
