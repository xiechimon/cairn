import { type ProviderTestResult, providerTestResultSchema, redactSecrets } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { probeProvider } from '../coordinator/runtime/provider-probe.js';
import { provider } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { openProviderKey, type ProviderDeps } from './providers.js';

export class ProviderTestLimiter {
  private readonly hits = new Map<string, number[]>();

  take(id: string): void {
    const now = Date.now();
    for (const [key, times] of this.hits) {
      if (times.every((time) => now - time >= 60_000)) this.hits.delete(key);
    }
    const recent = (this.hits.get(id) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= 5) {
      throw new HttpError(
        429,
        redactSecrets('Too many connection tests. Try again shortly.').value as string,
      );
    }
    this.hits.set(id, [...recent, now]);
  }
}

export async function testProviderConnection(
  deps: ProviderDeps & { fetch: typeof globalThis.fetch; timeoutMs?: number },
  input: { teamId: string; id: string; model?: string },
): Promise<ProviderTestResult> {
  const row = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.id, input.id), eq(provider.teamId, input.teamId)))
    .get();
  if (row === undefined) throw notFound(redactSecrets('provider').value as string);
  let apiKey: string | null = null;
  let reason: string | null;
  try {
    apiKey = openProviderKey(deps, input.teamId, row.providerId)?.apiKey ?? null;
    const sorted = [...row.models].sort(
      (a, b) =>
        (a.cost?.input ?? 0) +
        (a.cost?.output ?? 0) -
        ((b.cost?.input ?? 0) + (b.cost?.output ?? 0)),
    );
    const model = input.model ?? sorted[0]?.id;
    reason =
      model === undefined
        ? 'No model is configured. Add a model and try again.'
        : await probeProvider({
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
            fetch: deps.fetch,
            timeoutMs: deps.timeoutMs ?? 10_000,
          });
  } catch {
    reason = 'The connection test could not finish. Check the connection settings and try again.';
  }
  const result = { status: reason === null ? 'ok' : 'failed', reason };
  const scrubbed = providerTestResultSchema.parse(
    redactSecrets(result, apiKey === null ? [] : [apiKey]).value,
  );
  if (scrubbed.reason !== null)
    scrubbed.reason = scrubbed.reason.replace(/\s+/g, ' ').trim().slice(0, 300);
  return scrubbed;
}
