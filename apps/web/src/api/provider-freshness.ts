import type { ProviderRecord } from '@cairn/shared';
import type { ProvidersEnvelope } from './hooks.js';

export function keepNewerProvider(
  previous: ProviderRecord | undefined,
  incoming: ProviderRecord,
): ProviderRecord {
  return previous !== undefined && previous.updatedAt > incoming.updatedAt ? previous : incoming;
}

export function keepNewerProviders(previous: unknown, value: unknown): ProvidersEnvelope {
  const incoming = value as ProvidersEnvelope;
  const cached = previous as ProvidersEnvelope | undefined;
  if (cached === undefined) return incoming;
  const byId = new Map(cached.providers.map((record) => [record.id, record]));
  return {
    ...incoming,
    providers: incoming.providers.map((record) => keepNewerProvider(byId.get(record.id), record)),
  };
}
