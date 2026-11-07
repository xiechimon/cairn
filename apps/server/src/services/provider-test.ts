import { type ProviderConfig, type ProviderTestResult, redactSecrets } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { type ProbeFetch, probeProvider } from '../coordinator/runtime/provider-probe.js';
import { provider } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { openProviderKey, type ProviderDeps } from './providers.js';

export const PROVIDER_TEST_TIMEOUT_MS = 10_000;
export const PROVIDER_TEST_MAX_TOKENS = 8;
export const PROVIDER_TEST_LIMIT = 5;
export const PROVIDER_TEST_WINDOW_MS = 60_000;
const MESSAGE_LIMIT = 300;

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
  fetch: ProbeFetch;
  timeoutMs?: number;
}

type ProviderRow = typeof provider.$inferSelect;

function scrub(text: string, apiKey: string): string {
  const literal = apiKey === '' ? text : text.split(apiKey).join('[REDACTED]');
  const redacted = redactSecrets(literal).value as string;
  return redacted.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_LIMIT);
}

function cheapestConfiguredModel(row: ProviderRow): string | null {
  const price = (m: ProviderRow['models'][number]) => (m.cost?.input ?? 0) + (m.cost?.output ?? 0);
  const priced = row.models.filter((m) => m.cost !== undefined).sort((a, b) => price(a) - price(b));
  return priced[0]?.id ?? row.models[0]?.id ?? null;
}

function configOf(row: ProviderRow): ProviderConfig {
  return {
    kind: 'http',
    providerId: row.providerId,
    label: row.label,
    baseUrl: row.baseUrl,
    api: row.api,
    authHeader: row.authHeader,
    compat: row.compat,
    models: row.models,
  };
}

const EMPTY_PROBE: ProviderTestResult['probe'] = {
  requestedModel: null,
  echoedModel: null,
  httpStatus: null,
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
      probe: { ...EMPTY_PROBE, error: { type: 'no_key', message: 'no API key is stored' } },
    };
  }
  const model = input.model ?? cheapestConfiguredModel(row);
  if (model === null) {
    return {
      status: 'failed',
      probe: { ...EMPTY_PROBE, error: { type: 'no_model', message: 'no model to test' } },
    };
  }
  const outcome = await probeProvider({
    config: configOf(row),
    apiKey,
    model,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs ?? PROVIDER_TEST_TIMEOUT_MS,
    maxTokens: PROVIDER_TEST_MAX_TOKENS,
  });
  return {
    status: outcome.error === null ? 'ok' : 'failed',
    probe: {
      requestedModel: scrub(model, apiKey),
      echoedModel: outcome.responseModel === null ? null : scrub(outcome.responseModel, apiKey),
      httpStatus: outcome.httpStatus,
      latencyMs: outcome.latencyMs,
      error:
        outcome.error === null
          ? null
          : { type: outcome.error.type, message: scrub(outcome.error.raw, apiKey) },
    },
  };
}
