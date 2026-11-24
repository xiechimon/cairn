import { createHash, randomUUID } from 'node:crypto';
import type { ProviderCompat, ProviderRecord } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { provider } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

type ProviderRow = typeof provider.$inferSelect;
type StoredCompat = ProviderCompat & { credentialId?: string };

export function nextProviderVersion() {
  return sql<number>`max(${provider.updatedAt} + 1, ${nowMs()})`;
}

export function providerCredentialId(
  row: Pick<ProviderRow, 'apiKeyCipher' | 'compat' | 'id'>,
): string | null {
  if (row.apiKeyCipher === null) return null;
  return (row.compat as StoredCompat).credentialId ?? row.id;
}

export function publicProviderCompat(stored: StoredCompat): ProviderCompat {
  const { credentialId: _, ...compat } = stored;
  return compat;
}

export function withProviderCredentialId(
  compat: ProviderCompat,
  credentialId: string | null,
): StoredCompat {
  const fields = publicProviderCompat(compat);
  return credentialId === null ? fields : { ...fields, credentialId };
}

export function replaceProviderCredential(compat: ProviderCompat, apiKeyCipher: string | null) {
  return {
    apiKeyCipher,
    compat: withProviderCredentialId(compat, apiKeyCipher === null ? null : randomUUID()),
  };
}

export function providerConfigurationInput(
  row: Pick<ProviderRecord, 'providerId' | 'baseUrl' | 'api' | 'authHeader' | 'compat'>,
  credentialId: string | null,
) {
  return JSON.stringify({
    providerId: row.providerId,
    baseUrl: row.baseUrl,
    api: row.api,
    authHeader: row.authHeader,
    credentialId,
    compat: {
      supportsDeveloperRole: row.compat.supportsDeveloperRole,
      maxTokensField: row.compat.maxTokensField,
      supportsStore: row.compat.supportsStore,
    },
  });
}

export function providerConfigurationFingerprint(
  row: ProviderRow,
  credentialId = providerCredentialId(row),
): string {
  return createHash('sha256')
    .update(providerConfigurationInput(row, credentialId))
    .digest('hex')
    .slice(0, 32);
}
