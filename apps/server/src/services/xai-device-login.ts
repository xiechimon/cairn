import type { SecretBox } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { provider } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { createProvider } from './providers.js';

export const XAI_DEVICE_CODE_URL = 'https://auth.x.ai/oauth2/device/code';
export const XAI_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
export const XAI_PI_PUBLIC_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_PI_REFERRER = 'pi';
export const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access';
export const XAI_PROVIDER_BASE_URL = 'https://api.x.ai/v1';

const XAI_SUBSCRIPTION_MODELS = [
  { id: 'grok-4.7', name: 'Grok 4.7' },
  { id: 'grok-4.6', name: 'Grok 4.6' },
  { id: 'grok-4.5', name: 'Grok 4.5' },
  { id: 'grok-4.3', name: 'Grok 4.3' },
];

const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const DEFAULT_INTERVAL_SECONDS = 5;
const XAI_OAUTH_KIND = 'xai-oauth';

export interface XaiOAuthSecret {
  kind: typeof XAI_OAUTH_KIND;
  refresh: string;
  access: string;
  expires: number;
}

export interface XaiDeviceState {
  teamId: string;
  createdBy: string;
  deviceCode: string;
  baselineCipher: string | null;
  intervalSeconds: number;
  expiresAt: number;
  lastPollAt: number;
}

export interface XaiDeviceDeps {
  db: Db;
  box: SecretBox;
  fetch: FetchLike;
  states: Map<string, XaiDeviceState>;
}

interface TokenResponse {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

const refreshInflight = new Map<string, Promise<string>>();

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(502, `xAI device login returned an invalid ${field}`);
  }
  return value;
}

function positiveNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(502, `xAI device login returned an invalid ${field}`);
  }
  return value;
}

function httpsUri(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(502, 'xAI device login returned an untrusted verification URI');
  }
  if (url.protocol !== 'https:') {
    throw new HttpError(502, 'xAI device login returned an untrusted verification URI');
  }
  return url.href;
}

async function postForm(
  fetchImpl: FetchLike,
  url: string,
  fields: Record<string, string>,
): Promise<TokenResponse> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new HttpError(502, 'xAI device login request failed');
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    throw new HttpError(502, `xAI device login returned invalid JSON (HTTP ${response.status})`);
  }
  return { ok: response.ok, status: response.status, body };
}

function secretOf(raw: string): XaiOAuthSecret | null {
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<XaiOAuthSecret>;
    if (
      parsed.kind !== XAI_OAUTH_KIND ||
      typeof parsed.refresh !== 'string' ||
      parsed.refresh.length === 0 ||
      typeof parsed.access !== 'string' ||
      typeof parsed.expires !== 'number'
    ) {
      return null;
    }
    return {
      kind: XAI_OAUTH_KIND,
      refresh: parsed.refresh,
      access: parsed.access,
      expires: parsed.expires,
    };
  } catch {
    return null;
  }
}

function sealSecret(token: { refresh: string; access: string; expiresInSeconds?: number }): string {
  const expiresInSeconds = token.expiresInSeconds ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
  const secret: XaiOAuthSecret = {
    kind: XAI_OAUTH_KIND,
    refresh: token.refresh,
    access: token.access,
    expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
  };
  return JSON.stringify(secret);
}

function tokensFromBody(
  body: Record<string, unknown>,
  previousRefresh?: string,
): { refresh: string; access: string; expiresInSeconds: number } {
  const access = requiredString(body, 'access_token');
  const refresh =
    body.refresh_token === undefined && previousRefresh !== undefined
      ? previousRefresh
      : requiredString(body, 'refresh_token');
  const expiresInSeconds =
    body.expires_in === undefined
      ? DEFAULT_TOKEN_LIFETIME_SECONDS
      : positiveNumber(body, 'expires_in');
  return { refresh, access, expiresInSeconds };
}

function sweep(states: Map<string, XaiDeviceState>): void {
  const now = Date.now();
  for (const [state, entry] of states) {
    if (entry.expiresAt <= now) states.delete(state);
  }
}

export async function startXaiDeviceLogin(
  deps: XaiDeviceDeps,
  input: { teamId: string; createdBy: string },
): Promise<{
  state: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}> {
  sweep(deps.states);
  const response = await postForm(deps.fetch, XAI_DEVICE_CODE_URL, {
    client_id: XAI_PI_PUBLIC_CLIENT_ID,
    scope: XAI_SCOPE,
    referrer: XAI_PI_REFERRER,
  });
  if (!response.ok) throw new HttpError(502, 'xAI device login failed');
  const interval = response.body.interval;
  const intervalSeconds =
    typeof interval === 'number' && Number.isFinite(interval) && interval > 0
      ? interval
      : DEFAULT_INTERVAL_SECONDS;
  const complete =
    typeof response.body.verification_uri_complete === 'string' &&
    response.body.verification_uri_complete.length > 0
      ? response.body.verification_uri_complete
      : requiredString(response.body, 'verification_uri');
  const verificationUri = httpsUri(complete);
  const expiresInSeconds = positiveNumber(response.body, 'expires_in');
  const state = newRecordId(32);
  const existing = deps.db
    .select({ apiKeyCipher: provider.apiKeyCipher })
    .from(provider)
    .where(and(eq(provider.teamId, input.teamId), eq(provider.providerId, 'xai')))
    .get();
  deps.states.set(state, {
    teamId: input.teamId,
    createdBy: input.createdBy,
    deviceCode: requiredString(response.body, 'device_code'),
    baselineCipher: existing?.apiKeyCipher ?? null,
    intervalSeconds,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    lastPollAt: Date.now(),
  });
  return {
    state,
    userCode: requiredString(response.body, 'user_code'),
    verificationUri,
    intervalSeconds,
    expiresInSeconds,
  };
}

function ownState(deps: XaiDeviceDeps, teamId: string, state: string): XaiDeviceState {
  const entry = deps.states.get(state);
  if (!entry || entry.teamId !== teamId) throw new HttpError(404, 'xAI device login not found');
  return entry;
}

function saveSubscription(
  deps: XaiDeviceDeps,
  input: { teamId: string; createdBy: string; sealed: string; baselineCipher: string | null },
): boolean {
  const existing = deps.db
    .select()
    .from(provider)
    .where(and(eq(provider.teamId, input.teamId), eq(provider.providerId, 'xai')))
    .get();
  const keyDeps = { db: deps.db, box: deps.box };
  if (input.baselineCipher === null) {
    if (existing) return false;
    createProvider(keyDeps, {
      teamId: input.teamId,
      createdBy: input.createdBy,
      body: {
        providerId: 'xai',
        label: 'xAI',
        baseUrl: XAI_PROVIDER_BASE_URL,
        api: 'openai-responses',
        authHeader: false,
        models: XAI_SUBSCRIPTION_MODELS,
        apiKey: input.sealed,
      },
    });
    return true;
  }
  if (!existing || existing.apiKeyCipher !== input.baselineCipher) return false;
  const written = deps.db
    .update(provider)
    .set({
      label: 'xAI',
      baseUrl: XAI_PROVIDER_BASE_URL,
      api: 'openai-responses',
      authHeader: false,
      apiKeyCipher: deps.box.seal(input.sealed),
      ...(existing.models.length === 0 ? { models: XAI_SUBSCRIPTION_MODELS } : {}),
      updatedAt: nowMs(),
    })
    .where(and(eq(provider.id, existing.id), eq(provider.apiKeyCipher, input.baselineCipher)))
    .run();
  return written.changes === 1;
}

export async function pollXaiDeviceLogin(
  deps: XaiDeviceDeps,
  input: { teamId: string; state: string },
): Promise<
  | { status: 'pending'; intervalSeconds: number }
  | { status: 'complete' }
  | { status: 'superseded' }
  | { status: 'denied' }
  | { status: 'expired' }
> {
  const entry = ownState(deps, input.teamId, input.state);
  if (entry.expiresAt <= Date.now()) {
    deps.states.delete(input.state);
    return { status: 'expired' };
  }
  if (Date.now() - entry.lastPollAt < entry.intervalSeconds * 1000) {
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  entry.lastPollAt = Date.now();
  const response = await postForm(deps.fetch, XAI_TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: XAI_PI_PUBLIC_CLIENT_ID,
    device_code: entry.deviceCode,
  });
  if (response.ok) {
    const tokens = tokensFromBody(response.body);
    const saved = saveSubscription(deps, {
      teamId: entry.teamId,
      createdBy: entry.createdBy,
      sealed: sealSecret(tokens),
      baselineCipher: entry.baselineCipher,
    });
    deps.states.delete(input.state);
    return saved ? { status: 'complete' } : { status: 'superseded' };
  }
  const error = response.body.error;
  if (error === 'authorization_pending') {
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  if (error === 'slow_down') {
    const interval = response.body.interval;
    if (typeof interval === 'number' && interval > 0) entry.intervalSeconds = interval;
    else entry.intervalSeconds += 5;
    return { status: 'pending', intervalSeconds: entry.intervalSeconds };
  }
  deps.states.delete(input.state);
  if (error === 'access_denied' || error === 'authorization_denied') return { status: 'denied' };
  if (error === 'expired_token') return { status: 'expired' };
  throw new HttpError(502, 'xAI device login failed');
}

async function refreshAccess(
  deps: XaiDeviceDeps,
  teamId: string,
  providerId: string,
  secret: XaiOAuthSecret,
): Promise<string> {
  if (Date.now() < secret.expires) return secret.access;
  const row = deps.db
    .select({ id: provider.id, apiKeyCipher: provider.apiKeyCipher })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (!row?.apiKeyCipher) throw new HttpError(502, 'xAI subscription token refresh failed');
  const response = await postForm(deps.fetch, XAI_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: XAI_PI_PUBLIC_CLIENT_ID,
    refresh_token: secret.refresh,
  });
  if (!response.ok) throw new HttpError(502, 'xAI subscription token refresh failed');
  const tokens = tokensFromBody(response.body, secret.refresh);
  const sealed = sealSecret(tokens);
  const latest = deps.db
    .select({ apiKeyCipher: provider.apiKeyCipher })
    .from(provider)
    .where(eq(provider.id, row.id))
    .get();
  const latestRaw = latest?.apiKeyCipher == null ? null : deps.box.open(latest.apiKeyCipher);
  const latestSecret = latestRaw == null ? null : secretOf(latestRaw);
  if (latestSecret?.refresh !== secret.refresh) {
    if (latestRaw == null) throw new HttpError(502, 'xAI subscription token refresh failed');
    if (latestSecret == null) return latestRaw;
    if (Date.now() < latestSecret.expires) return latestSecret.access;
    return refreshAccess(deps, teamId, providerId, latestSecret);
  }
  const written = deps.db
    .update(provider)
    .set({ apiKeyCipher: deps.box.seal(sealed), updatedAt: nowMs() })
    .where(and(eq(provider.id, row.id), eq(provider.apiKeyCipher, row.apiKeyCipher)))
    .run();
  if (written.changes === 0) {
    const again = deps.db
      .select({ apiKeyCipher: provider.apiKeyCipher })
      .from(provider)
      .where(eq(provider.id, row.id))
      .get();
    const againRaw = again?.apiKeyCipher == null ? null : deps.box.open(again.apiKeyCipher);
    if (againRaw == null) throw new HttpError(502, 'xAI subscription token refresh failed');
    const againSecret = secretOf(againRaw);
    if (againSecret == null) return againRaw;
    if (Date.now() < againSecret.expires) return againSecret.access;
    if (againSecret.refresh === secret.refresh) {
      throw new HttpError(502, 'xAI subscription token refresh failed');
    }
    return refreshAccess(deps, teamId, providerId, againSecret);
  }
  return tokens.access;
}

export async function materializeXaiAccessToken(
  deps: XaiDeviceDeps,
  teamId: string,
  providerId: string,
): Promise<string> {
  const stored = deps.db
    .select({ apiKeyCipher: provider.apiKeyCipher })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (stored?.apiKeyCipher == null) {
    throw new HttpError(409, 'provider credential is no longer stored');
  }
  const raw = deps.box.open(stored.apiKeyCipher);
  const secret = secretOf(raw);
  if (!secret) return raw;
  const lockKey = `${teamId}/${providerId}`;
  const inflight = refreshInflight.get(lockKey);
  if (inflight) return inflight;
  const pending = refreshAccess(deps, teamId, providerId, secret).finally(() => {
    refreshInflight.delete(lockKey);
  });
  refreshInflight.set(lockKey, pending);
  return pending;
}
