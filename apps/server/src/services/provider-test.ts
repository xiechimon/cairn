import {
  type ProviderFailure,
  type ProviderTestResult,
  providerTestResultSchema,
  redactSecrets,
  type UpstreamModelsResult,
  upstreamModelsResultSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { probeProvider } from '../coordinator/runtime/provider-probe.js';
import { provider } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { providerAccessToken } from './provider-access-token.js';
import { openProviderKey, type ProviderDeps } from './providers.js';
import { failureForStatus, fetchUpstreamModels } from './upstream-models.js';

const MODEL_TEST_WINDOW_MS = 10_000;
const DETAIL_MAX = 160;

function upstreamMessage(text: string): string {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body === 'object' && body !== null) {
      const { error, message, detail } = body as Record<string, unknown>;
      const nested =
        typeof error === 'object' && error !== null
          ? (error as Record<string, unknown>).message
          : error;
      const picked = [nested, message, detail].find((v) => typeof v === 'string' && v !== '');
      if (typeof picked === 'string') return picked;
    }
  } catch {}
  return text.replace(/<[^>]*>/g, ' ');
}

function errorDetail(text: string, secrets: readonly string[]): string | null {
  const scrubbed = redactSecrets(upstreamMessage(text), secrets).value as string;
  const line = scrubbed
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(line);
  if (chars.length === 0) return null;
  return chars.length > DETAIL_MAX ? `${chars.slice(0, DETAIL_MAX - 1).join('')}…` : line;
}

export class ProviderTestLimiter {
  private readonly hits = new Map<string, number>();

  take(key: string): void {
    const now = Date.now();
    for (const [other, at] of this.hits) {
      if (now - at >= MODEL_TEST_WINDOW_MS) this.hits.delete(other);
    }
    if (this.hits.has(key)) {
      throw new HttpError(
        429,
        redactSecrets('This model was just tested. Try again shortly.').value as string,
      );
    }
    this.hits.set(key, now);
  }
}

type TestDeps = ProviderDeps & {
  limiter?: ProviderTestLimiter;
  fetch: typeof globalThis.fetch;
  tokenFetch?: FetchLike;
  timeoutMs?: number;
};

function providerRow(deps: ProviderDeps, teamId: string, id: string) {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.id, id), eq(provider.teamId, teamId)))
    .get();
  if (row === undefined) throw notFound(redactSecrets('provider').value as string);
  return row;
}

async function accessKey(
  deps: TestDeps,
  teamId: string,
  providerId: string,
): Promise<string | null> {
  return openProviderKey(deps, teamId, providerId)?.apiKey == null
    ? null
    : await providerAccessToken(
        { db: deps.db, box: deps.box, fetch: deps.tokenFetch ?? globalThis.fetch },
        teamId,
        providerId,
      );
}

export function testedModel(
  models: readonly { id: string; cost?: { input: number; output: number } }[],
  requested: string | undefined,
): string | undefined {
  if (requested !== undefined) return requested;
  return [...models].sort(
    (a, b) =>
      (a.cost?.input ?? 0) + (a.cost?.output ?? 0) - ((b.cost?.input ?? 0) + (b.cost?.output ?? 0)),
  )[0]?.id;
}

export async function testProviderConnection(
  deps: TestDeps,
  input: { teamId: string; id: string; model?: string },
): Promise<ProviderTestResult> {
  const row = providerRow(deps, input.teamId, input.id);
  const model = testedModel(row.models, input.model);
  deps.limiter?.take(`${row.id}\u0000${model ?? ''}`);
  let apiKey: string | null = null;
  let reason: string | null = null;
  let failure: ProviderFailure | null = null;
  let httpStatus: number | null = null;
  let errorBody: string | null = null;
  let latencyMs: number | null = null;
  try {
    apiKey = await accessKey(deps, input.teamId, row.providerId);
    if (model === undefined) {
      failure = 'no-model';
      reason = 'No model is configured. Add a model and try again.';
    } else {
      const recording: typeof globalThis.fetch = async (url, init) => {
        const response = await deps.fetch(url, init);
        httpStatus = response.status;
        errorBody =
          response.status >= 400
            ? await response
                .clone()
                .text()
                .catch(() => null)
            : null;
        return response;
      };
      const started = performance.now();
      const probe = await probeProvider({
        config: {
          kind: 'http',
          providerId: row.providerId,
          label: row.label,
          baseUrl: row.baseUrl,
          api: row.api,
          authHeader: row.authHeader,
          compat: row.compat,
          models: row.models,
        },
        apiKey,
        model,
        fetch: recording,
        timeoutMs: deps.timeoutMs ?? 10_000,
      });
      latencyMs = Math.round(performance.now() - started);
      if (probe !== null) {
        reason = probe.reason;
        failure =
          probe.failure === 'upstream' && httpStatus !== null && httpStatus >= 400
            ? failureForStatus(httpStatus)
            : httpStatus === null && probe.failure === 'upstream'
              ? 'network'
              : probe.failure;
      }
    }
  } catch {
    failure = 'network';
    reason = 'The connection test could not finish. Check the connection settings and try again.';
  }
  const secrets = apiKey === null ? [] : [apiKey];
  const scrubbedReason = redactSecrets(reason, secrets).value;
  return providerTestResultSchema.parse({
    status: redactSecrets(reason === null ? 'ok' : 'failed').value,
    reason:
      typeof scrubbedReason === 'string'
        ? scrubbedReason.replace(/\s+/g, ' ').trim().slice(0, 300)
        : null,
    failure,
    httpStatus: failure === null ? null : httpStatus,
    detail: failure === null || errorBody === null ? null : errorDetail(errorBody, secrets),
    latencyMs: failure === null ? latencyMs : null,
  });
}

export async function listUpstreamModels(
  deps: TestDeps,
  input: { teamId: string; id: string },
): Promise<UpstreamModelsResult> {
  const row = providerRow(deps, input.teamId, input.id);
  let apiKey: string | null;
  try {
    apiKey = await accessKey(deps, input.teamId, row.providerId);
  } catch {
    return { status: 'failed', failure: 'auth', httpStatus: null };
  }
  const listed = await fetchUpstreamModels({
    baseUrl: row.baseUrl,
    api: row.api,
    authHeader: row.authHeader,
    apiKey,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs ?? 10_000,
  });
  return upstreamModelsResultSchema.parse(
    listed.ok
      ? { status: 'ok', models: listed.models }
      : { status: 'failed', failure: listed.failure, httpStatus: listed.httpStatus },
  );
}
