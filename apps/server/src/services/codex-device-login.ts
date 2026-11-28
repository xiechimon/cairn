import type { SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { CODEX_BASE_URL, CODEX_PROVIDER_ID } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import { provider } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId } from '../lib/ids.js';
import {
  createRefreshInflightMap,
  ownDeviceState,
  postDeviceForm,
  postDeviceJson,
  requiredDeviceString,
  sweepExpiredStates,
} from './device-login-helpers.js';
import { nextProviderVersion, replaceProviderCredential } from './provider-configuration.js';
import { createProvider } from './providers.js';

const AUTH_BASE_URL = 'https://auth.openai.com';
export const CODEX_DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
export const CODEX_DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
export const CODEX_DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
export const CODEX_TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
export const CODEX_DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
export const CODEX_PI_PUBLIC_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const CODEX_SUBSCRIPTION_MODELS = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol' },
];

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const DEFAULT_INTERVAL_SECONDS = 5;
const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;
const CODEX_OAUTH_KIND = 'codex-oauth';

export interface CodexOAuthSecret {
  kind: typeof CODEX_OAUTH_KIND;
  refresh: string;
  access: string;
  expires: number;
  accountId: string;
}

export interface CodexDeviceState {
  teamId: string;
  createdBy: string;
  deviceAuthId: string;
  userCode: string;
  baselineCipher: string | null;
  intervalSeconds: number;
  expiresAt: number;
  lastPollAt: number;
}

export interface CodexDeviceDeps {
  db: Db;
  box: SecretBox;
  fetch: FetchLike;
  states: Map<string, CodexDeviceState>;
}

const DEVICE_LABEL = 'Codex device login';
const refreshInflightOf = createRefreshInflightMap<string>();
const requiredString = (body: Record<string, unknown>, field: string) =>
  requiredDeviceString(body, field, DEVICE_LABEL);
const postJson = (fetchImpl: FetchLike, url: string, payload: Record<string, string>) =>
  postDeviceJson(fetchImpl, url, payload, { label: DEVICE_LABEL });
const postForm = (fetchImpl: FetchLike, url: string, fields: Record<string, string>) =>
  postDeviceForm(fetchImpl, url, fields, { label: DEVICE_LABEL });

export function accountIdOf(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  let accountId: unknown;
  if (payload !== undefined) {
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        { chatgpt_account_id?: unknown } | undefined
      >;
      accountId = claims[JWT_CLAIM_PATH]?.chatgpt_account_id;
    } catch {
      accountId = undefined;
    }
  }
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new HttpError(502, 'Codex device login returned a token without an account id');
  }
  return accountId;
}

function secretOf(raw: string): CodexOAuthSecret | null {
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CodexOAuthSecret>;
    if (
      parsed.kind !== CODEX_OAUTH_KIND ||
      typeof parsed.refresh !== 'string' ||
      parsed.refresh.length === 0 ||
      typeof parsed.access !== 'string' ||
      typeof parsed.expires !== 'number' ||
      typeof parsed.accountId !== 'string'
    ) {
      return null;
    }
    return {
      kind: CODEX_OAUTH_KIND,
      refresh: parsed.refresh,
      access: parsed.access,
      expires: parsed.expires,
      accountId: parsed.accountId,
    };
  } catch {
    return null;
  }
}

function sealedTokens(body: Record<string, unknown>, previousRefresh?: string) {
  const access = requiredString(body, 'access_token');
  const refresh =
    body.refresh_token === undefined && previousRefresh !== undefined
      ? previousRefresh
      : requiredString(body, 'refresh_token');
  const lifetime = body.expires_in;
  const expiresInSeconds =
    typeof lifetime === 'number' && Number.isFinite(lifetime) && lifetime > 0
      ? lifetime
      : DEFAULT_TOKEN_LIFETIME_SECONDS;
  const secret: CodexOAuthSecret = {
    kind: CODEX_OAUTH_KIND,
    refresh,
    access,
    expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
    accountId: accountIdOf(access),
  };
  return { secret, sealed: JSON.stringify(secret) };
}

const providerRow = (db: Db, teamId: string) =>
  db
    .select()
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, CODEX_PROVIDER_ID)))
    .get();

export async function startCodexDeviceLogin(
  deps: CodexDeviceDeps,
  input: { teamId: string; createdBy: string },
): Promise<{
  state: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}> {
  sweepExpiredStates(deps.states);
  const response = await postJson(deps.fetch, CODEX_DEVICE_USER_CODE_URL, {
    client_id: CODEX_PI_PUBLIC_CLIENT_ID,
  });
  if (!response.ok) throw new HttpError(502, 'Codex device login failed');
  const rawInterval = response.body.interval;
  const parsedInterval = typeof rawInterval === 'string' ? Number(rawInterval.trim()) : rawInterval;
  const intervalSeconds =
    typeof parsedInterval === 'number' && Number.isFinite(parsedInterval) && parsedInterval > 0
      ? parsedInterval
      : DEFAULT_INTERVAL_SECONDS;
  const userCode = requiredString(response.body, 'user_code');
  const state = newRecordId(32);
  deps.states.set(state, {
    teamId: input.teamId,
    createdBy: input.createdBy,
    deviceAuthId: requiredString(response.body, 'device_auth_id'),
    userCode,
    baselineCipher: providerRow(deps.db, input.teamId)?.apiKeyCipher ?? null,
    intervalSeconds,
    expiresAt: Date.now() + DEVICE_CODE_LIFETIME_SECONDS * 1000,
    lastPollAt: Date.now(),
  });
  return {
    state,
    userCode,
    verificationUri: CODEX_DEVICE_VERIFICATION_URI,
    intervalSeconds,
    expiresInSeconds: DEVICE_CODE_LIFETIME_SECONDS,
  };
}

function saveSubscription(
  deps: CodexDeviceDeps,
  input: { teamId: string; createdBy: string; sealed: string; baselineCipher: string | null },
): boolean {
  const existing = providerRow(deps.db, input.teamId);
  if (input.baselineCipher === null) {
    if (existing) return false;
    createProvider(
      { db: deps.db, box: deps.box },
      {
        teamId: input.teamId,
        createdBy: input.createdBy,
        body: {
          providerId: CODEX_PROVIDER_ID,
          label: 'ChatGPT',
          baseUrl: CODEX_BASE_URL,
          api: 'openai-responses',
          authHeader: false,
          models: CODEX_SUBSCRIPTION_MODELS,
          apiKey: input.sealed,
        },
      },
    );
    return true;
  }
  if (!existing || existing.apiKeyCipher !== input.baselineCipher) return false;
  const written = deps.db
    .update(provider)
    .set({
      label: 'ChatGPT',
      baseUrl: CODEX_BASE_URL,
      api: 'openai-responses',
      authHeader: false,
      ...replaceProviderCredential(existing.compat, deps.box.seal(input.sealed)),
      ...(existing.models.length === 0 ? { models: CODEX_SUBSCRIPTION_MODELS } : {}),
      updatedAt: nextProviderVersion(),
    })
    .where(and(eq(provider.id, existing.id), eq(provider.apiKeyCipher, input.baselineCipher)))
    .run();
  return written.changes === 1;
}

async function completeLogin(
  deps: CodexDeviceDeps,
  entry: CodexDeviceState,
  grant: Record<string, unknown>,
): Promise<boolean> {
  const exchange = await postForm(deps.fetch, CODEX_TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: CODEX_PI_PUBLIC_CLIENT_ID,
    code: requiredString(grant, 'authorization_code'),
    code_verifier: requiredString(grant, 'code_verifier'),
    redirect_uri: CODEX_DEVICE_REDIRECT_URI,
  });
  if (!exchange.ok) throw new HttpError(502, 'Codex device login failed');
  return saveSubscription(deps, {
    teamId: entry.teamId,
    createdBy: entry.createdBy,
    sealed: sealedTokens(exchange.body).sealed,
    baselineCipher: entry.baselineCipher,
  });
}

export async function pollCodexDeviceLogin(
  deps: CodexDeviceDeps,
  input: { teamId: string; state: string },
): Promise<
  | { status: 'pending'; intervalSeconds: number }
  | { status: 'complete'; created: boolean }
  | { status: 'superseded' }
  | { status: 'denied' }
  | { status: 'expired' }
> {
  const entry = ownDeviceState(deps.states, input.teamId, input.state, DEVICE_LABEL);
  if (entry.expiresAt <= Date.now()) {
    deps.states.delete(input.state);
    return { status: 'expired' };
  }
  if (Date.now() - entry.lastPollAt < entry.intervalSeconds * 1000) {
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  entry.lastPollAt = Date.now();
  const response = await postJson(deps.fetch, CODEX_DEVICE_TOKEN_URL, {
    device_auth_id: entry.deviceAuthId,
    user_code: entry.userCode,
  });
  if (response.ok) {
    deps.states.delete(input.state);
    const saved = await completeLogin(deps, entry, response.body);
    return saved
      ? { status: 'complete', created: entry.baselineCipher === null }
      : { status: 'superseded' };
  }
  if (response.status === 403 || response.status === 404) {
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  const error = response.body.error;
  const code =
    error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : error;
  if (code === 'deviceauth_authorization_pending') {
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  if (code === 'slow_down') {
    entry.intervalSeconds += 5;
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  deps.states.delete(input.state);
  if (code === 'access_denied' || code === 'deviceauth_authorization_denied') {
    return { status: 'denied' };
  }
  if (code === 'expired_token' || code === 'deviceauth_expired') return { status: 'expired' };
  throw new HttpError(502, 'Codex device login failed');
}

function storedSecret(deps: CodexDeviceDeps, id: string) {
  const latest = deps.db
    .select({ apiKeyCipher: provider.apiKeyCipher })
    .from(provider)
    .where(eq(provider.id, id))
    .get();
  const raw = latest?.apiKeyCipher == null ? null : deps.box.open(latest.apiKeyCipher);
  return { raw, secret: raw == null ? null : secretOf(raw) };
}

async function refreshAccess(
  deps: CodexDeviceDeps,
  teamId: string,
  secret: CodexOAuthSecret,
): Promise<string> {
  if (Date.now() < secret.expires) return secret.access;
  const row = providerRow(deps.db, teamId);
  if (!row?.apiKeyCipher) throw new HttpError(502, 'Codex subscription token refresh failed');
  const response = await postForm(deps.fetch, CODEX_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: CODEX_PI_PUBLIC_CLIENT_ID,
    refresh_token: secret.refresh,
  });
  if (!response.ok) throw new HttpError(502, 'Codex subscription token refresh failed');
  const refreshed = sealedTokens(response.body, secret.refresh);
  const latest = storedSecret(deps, row.id);
  if (latest.secret?.refresh !== secret.refresh) {
    if (latest.raw == null) throw new HttpError(502, 'Codex subscription token refresh failed');
    if (latest.secret == null) return latest.raw;
    return refreshAccess(deps, teamId, latest.secret);
  }
  const written = deps.db
    .update(provider)
    .set({ apiKeyCipher: deps.box.seal(refreshed.sealed), updatedAt: nextProviderVersion() })
    .where(and(eq(provider.id, row.id), eq(provider.apiKeyCipher, row.apiKeyCipher)))
    .run();
  if (written.changes === 0) {
    const again = storedSecret(deps, row.id);
    if (again.raw == null) throw new HttpError(502, 'Codex subscription token refresh failed');
    if (again.secret == null) return again.raw;
    if (again.secret.refresh === secret.refresh) {
      throw new HttpError(502, 'Codex subscription token refresh failed');
    }
    return refreshAccess(deps, teamId, again.secret);
  }
  return refreshed.secret.access;
}

export async function materializeCodexAccessToken(
  deps: CodexDeviceDeps,
  teamId: string,
): Promise<string> {
  const stored = providerRow(deps.db, teamId);
  if (stored?.apiKeyCipher == null) {
    throw new HttpError(409, 'provider credential is no longer stored');
  }
  const raw = deps.box.open(stored.apiKeyCipher);
  const secret = secretOf(raw);
  if (!secret) return raw;
  const inflights = refreshInflightOf(deps.db);
  const inflight = inflights.get(teamId);
  if (inflight) return inflight;
  const pending = refreshAccess(deps, teamId, secret).finally(() => {
    inflights.delete(teamId);
  });
  inflights.set(teamId, pending);
  return pending;
}
