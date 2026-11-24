import {
  type AntigravityLoginOutcome,
  type AntigravityLoginPhase,
  DEVIN_TOKEN_LIFETIME_MS,
  type DesktopProviderImportResult,
  type DesktopSubscriptionInput,
  type DesktopSubscriptionMetadata,
  OWNER_CHANNEL_HEADER,
} from '@cairn/shared';
import { antigravityLogin, readLocalAntigravityCredential } from './antigravity-auth.js';
import { devinImport, devinLogin } from './devin-auth.js';
import { readLocalProviders } from './local-providers.js';

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function subscriptionInput(input: unknown): DesktopSubscriptionInput | null {
  if (typeof input !== 'object' || input === null || !('teamId' in input) || !('label' in input)) {
    return null;
  }
  const { teamId, label } = input;
  if (!isId(teamId) || typeof label !== 'string' || label.length > 100 || label.trim() === '') {
    return null;
  }
  return { teamId, label: label.trim() };
}

export function desktopCredentialActions(
  origin: string,
  owner: string,
  ownerChannel: string,
  appData: string,
  workerPath?: string,
) {
  const post = async (
    teamId: string,
    path: string,
    body: object,
    signal?: AbortSignal,
  ): Promise<DesktopSubscriptionMetadata> => {
    const limit = AbortSignal.timeout(15_000);
    const response = await fetch(`${origin}/api/teams/${teamId}/${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: signal === undefined ? limit : AbortSignal.any([limit, signal]),
      headers: {
        authorization: `Bearer ${owner}`,
        [OWNER_CHANNEL_HEADER]: ownerChannel,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Local credential could not be saved');
    const saved: unknown = await response.json();
    if (
      typeof saved !== 'object' ||
      saved === null ||
      !('id' in saved) ||
      !isId(saved.id) ||
      !('label' in saved) ||
      typeof saved.label !== 'string'
    )
      throw new Error('Local credential save did not return metadata');
    return { id: saved.id, label: saved.label };
  };

  const saveDevin =
    ({ teamId, label }: DesktopSubscriptionInput) =>
    (token: string) =>
      post(teamId, 'devin-subscriptions', {
        label,
        token,
        expiresAt: Date.now() + DEVIN_TOKEN_LIFETIME_MS,
      });

  return {
    async importAntigravity(input: unknown): Promise<AntigravityLoginOutcome> {
      const target = subscriptionInput(input);
      if (target === null) return { ok: false, reason: 'save' };
      const credential = readLocalAntigravityCredential();
      if (credential === null) return { ok: false, reason: 'no-key' };
      try {
        const subscription = await post(target.teamId, 'antigravity-subscriptions', {
          label: target.label,
          ...credential,
        });
        return { ok: true, subscription };
      } catch {
        return { ok: false, reason: 'save' };
      }
    },
    async loginAntigravity(
      input: unknown,
      onPhase: (phase: AntigravityLoginPhase) => void,
      signal: AbortSignal,
      subscriptionId?: unknown,
    ): Promise<AntigravityLoginOutcome> {
      const target = subscriptionInput(input);
      if (target === null || (subscriptionId !== undefined && !isId(subscriptionId))) {
        return { ok: false, reason: 'save' };
      }
      return antigravityLogin(
        ({ token, expiresAt, refreshToken, authMethod }, loginSignal) =>
          subscriptionId === undefined
            ? post(
                target.teamId,
                'antigravity-subscriptions',
                {
                  label: target.label,
                  ...(token !== undefined ? { token } : {}),
                  ...(expiresAt !== undefined ? { expiresAt } : {}),
                  ...(refreshToken !== undefined ? { refreshToken } : {}),
                  ...(authMethod !== undefined ? { authMethod } : {}),
                },
                loginSignal,
              )
            : post(
                target.teamId,
                `antigravity-subscriptions/${subscriptionId}/attach-oauth`,
                {
                  kind: 'oauth-personal',
                  ...(token !== undefined ? { token } : {}),
                  ...(expiresAt !== undefined ? { expiresAt } : {}),
                  ...(refreshToken !== undefined ? { refreshToken } : {}),
                  ...(authMethod !== undefined ? { authMethod } : {}),
                },
                loginSignal,
              ),
        appData,
        onPhase,
        signal,
        workerPath,
      );
    },
    importDevin(input: unknown) {
      const target = subscriptionInput(input);
      return target === null
        ? ({ ok: false, reason: 'save' } as const)
        : devinImport(saveDevin(target));
    },
    loginDevin(input: unknown) {
      const target = subscriptionInput(input);
      return target === null
        ? ({ ok: false, reason: 'save' } as const)
        : devinLogin(saveDevin(target), appData, workerPath);
    },
    async importProviders(input: unknown): Promise<DesktopProviderImportResult[]> {
      if (
        typeof input !== 'object' ||
        input === null ||
        !('teamId' in input) ||
        !('providerIds' in input)
      )
        return [];
      const { teamId, providerIds } = input;
      if (
        !isId(teamId) ||
        !Array.isArray(providerIds) ||
        providerIds.length > 100 ||
        !providerIds.every((id) => typeof id === 'string')
      )
        return [];
      const providers = new Map(
        readLocalProviders(providerIds).map((row) => [row.providerId, row]),
      );
      const results: DesktopProviderImportResult[] = [];
      for (const providerId of new Set<string>(providerIds)) {
        const row = providers.get(providerId);
        if (row === undefined || row.api === null) {
          results.push({ providerId, status: 'missing' });
          continue;
        }
        try {
          const { id } = await post(teamId, 'providers', {
            providerId,
            label: row.label,
            baseUrl: row.baseUrl,
            api: row.api,
            authHeader: row.authHeader,
            models: row.models,
            apiKey: row.apiKey,
          });
          results.push({ providerId, status: 'saved', id });
        } catch {
          results.push({ providerId, status: 'failed' });
        }
      }
      return results;
    },
  };
}
