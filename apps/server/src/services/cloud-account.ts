import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type CloudConnectStartBody,
  type CloudStatusResponse,
  type CloudUserProfile,
  type CloudWorkspaceView,
  cloudUserProfileSchema,
  type SecretBox,
} from '@cairn/shared';
import { isLoopbackHost } from '@cairn/shared/loopback';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { SecretBoxError } from '../lib/secret-box.js';

const PKCE_TTL_MS = 10 * 60_000;
const MAX_PKCE_STATES = 32;
const CLOUD_TIMEOUT_MS = 15_000;
const REVOKE_TIMEOUT_MS = 2_000;

export type CloudShellKind = 'browser' | 'desktop';

export interface CloudPkceEntry {
  verifier: string;
  returnTo: string;
  origin: string;
  shell: CloudShellKind;
  createdAt: number;
}

const storedCloudAccountSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  user: cloudUserProfileSchema,
  updatedAt: z.number().int(),
});

type StoredCloudAccount = z.infer<typeof storedCloudAccountSchema>;

const epochOrIsoSchema = z.union([z.number(), z.string()]).nullable().optional();

const controlPlaneExchangeSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: epochOrIsoSchema,
  user: cloudUserProfileSchema,
});

const controlPlaneMeSchema = z.object({
  user: cloudUserProfileSchema,
  subscribed: z.boolean().default(false),
  hasBillingCustomer: z.boolean().default(false),
  subscriptionStatus: z.string().nullable().default(null),
  currentPeriodEnd: epochOrIsoSchema,
  tenant: z
    .object({
      appName: z.string().min(1),
      url: z.string().nullable().optional(),
      status: z.string().min(1),
      region: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
});

function normalizeTimestampIso(raw: string | number | null | undefined): string | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? new Date(raw).toISOString() : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

const controlPlaneCheckoutSchema = z.object({
  checkoutUrl: z.string().url(),
});

const controlPlanePortalSchema = z.object({
  portalUrl: z.string().url(),
});

const accountFileLocks = new Map<string, Promise<unknown>>();

function withAccountFileLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = accountFileLocks.get(filePath) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    () => fn(),
  );
  accountFileLocks.set(filePath, next);
  return next.finally(() => {
    if (accountFileLocks.get(filePath) === next) {
      accountFileLocks.delete(filePath);
    }
  });
}

export function cloudAccountFilePath(dataDir: string): string {
  return join(dataDir, 'cloud-account.enc');
}

function unlinkedStatus(configured: boolean): CloudStatusResponse {
  return {
    configured,
    linked: false,
    cloudReachable: true,
    user: null,
    subscribed: false,
    hasBillingCustomer: false,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    workspace: null,
  };
}

function isLoopbackOriginUrl(url: URL): boolean {
  return isLoopbackHost(url.hostname.replace(/^\[(.*)\]$/, '$1'));
}

export function validateCloudTargetUrl(rawUrl: string, configuredCloudUrl: string): string {
  let parsed: URL;
  let configured: URL;
  try {
    parsed = new URL(rawUrl);
    configured = new URL(configuredCloudUrl);
  } catch {
    throw new HttpError(502, 'cloud service returned an invalid URL');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new HttpError(502, 'cloud service returned an invalid URL');
  }
  if (parsed.protocol === 'https:') return parsed.toString();
  if (
    parsed.protocol === 'http:' &&
    isLoopbackOriginUrl(configured) &&
    isLoopbackOriginUrl(parsed)
  ) {
    return parsed.toString();
  }
  throw new HttpError(502, 'cloud service returned an unsafe URL');
}

export function validateOptionalCloudWorkspaceUrl(
  rawUrl: string | null | undefined,
  configuredCloudUrl: string,
): string | null {
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') return null;
  try {
    return validateCloudTargetUrl(rawUrl, configuredCloudUrl);
  } catch {
    return null;
  }
}

function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateCloudReturnTo(raw: string | undefined, origin: string): string {
  if (raw === undefined || raw === '') return '/app';
  const trimmed = raw.trim();
  if (
    trimmed.includes('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('@') ||
    hasControlChar(trimmed)
  ) {
    throw new HttpError(400, 'invalid returnTo path');
  }
  if (trimmed !== '/app' && !trimmed.startsWith('/app/') && !trimmed.startsWith('/app?')) {
    throw new HttpError(400, 'invalid returnTo path');
  }
  let parsed: URL;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
    parsed = new URL(trimmed, originUrl);
  } catch {
    throw new HttpError(400, 'invalid returnTo path');
  }
  if (parsed.origin !== originUrl.origin || !parsed.pathname.startsWith('/app')) {
    throw new HttpError(400, 'invalid returnTo path');
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function appendQueryParam(pathOrUrl: string, key: string, value: string): string {
  const url = new URL(pathOrUrl, 'http://cairn.local');
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function desktopCompletionHtml(ok: boolean, name: string | null, reason?: string): string {
  const heading = ok
    ? name !== null && name !== ''
      ? `Connected as ${escapeHtml(name)}`
      : 'Connected to Cairn Cloud'
    : 'Could not finish Cairn Cloud sign-in';
  const detail = ok
    ? 'You can close this tab and return to the Cairn desktop app.'
    : `Sign-in did not complete (${escapeHtml(reason ?? 'error')}). Return to Cairn and try again.`;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Cairn Cloud</title>',
    '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#faf8f5;color:#1b1a18;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{max-width:420px;background:#fff;border:1px solid #e4dfd5;border-radius:12px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#5c5851;margin:0;line-height:1.5}</style>',
    '</head>',
    '<body>',
    '<div class="card">',
    `<h1>${heading}</h1>`,
    `<p>${detail}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('');
}

function removeFileQuietly(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    return;
  }
}

function readStoredUnlocked(filePath: string, box: SecretBox): StoredCloudAccount | null {
  if (!existsSync(filePath)) return null;
  let stored: StoredCloudAccount;
  try {
    const envelope = readFileSync(filePath, 'utf8').trim();
    if (envelope === '') {
      removeFileQuietly(filePath);
      return null;
    }
    const plaintext = box.open(envelope);
    const parsed = storedCloudAccountSchema.safeParse(JSON.parse(plaintext));
    if (!parsed.success) {
      removeFileQuietly(filePath);
      return null;
    }
    stored = parsed.data;
  } catch (err) {
    if (err instanceof SecretBoxError || err instanceof SyntaxError) {
      removeFileQuietly(filePath);
      return null;
    }
    removeFileQuietly(filePath);
    return null;
  }
  if (stored.expiresAt !== null) {
    const expMs = Date.parse(stored.expiresAt);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) {
      removeFileQuietly(filePath);
      return null;
    }
  }
  return stored;
}

function writeStoredUnlocked(filePath: string, box: SecretBox, data: StoredCloudAccount): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  writeFileSync(tempPath, box.seal(JSON.stringify(data)), { mode: 0o600 });
  chmodSync(tempPath, 0o600);
  renameSync(tempPath, filePath);
}

async function clearIfTokenMatches(
  filePath: string,
  expectedToken: string,
  box: SecretBox,
): Promise<void> {
  await withAccountFileLock(filePath, () => {
    const current = readStoredUnlocked(filePath, box);
    if (current !== null && current.accessToken === expectedToken) {
      removeFileQuietly(filePath);
    }
  });
}

function sweepExpiredPkce(states: Map<string, CloudPkceEntry>, now: number): void {
  for (const [key, entry] of states) {
    if (now - entry.createdAt >= PKCE_TTL_MS) {
      states.delete(key);
    }
  }
}

function pkceChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export interface CloudAccountDeps {
  cloudUrl: string | null | undefined;
  dataDir: string;
  secretBox: SecretBox;
  pkceStates: Map<string, CloudPkceEntry>;
  cloudFetch?: typeof fetch;
}

function requireConfiguredCloudUrl(deps: CloudAccountDeps): string {
  if (deps.cloudUrl == null || deps.cloudUrl === '') {
    throw new HttpError(409, 'cloud account is not configured');
  }
  return deps.cloudUrl;
}

function fetcherOf(deps: CloudAccountDeps): typeof fetch {
  return deps.cloudFetch ?? globalThis.fetch;
}

async function parseControlPlaneError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === 'string' && data.error.trim() !== '') {
      return data.error.trim();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function startCloudConnect(
  deps: CloudAccountDeps,
  input: { origin: string; body: CloudConnectStartBody },
): { authorizationUrl: string } {
  const cloudUrl = requireConfiguredCloudUrl(deps);
  const returnTo = validateCloudReturnTo(input.body.returnTo, input.origin);
  const shell: CloudShellKind = input.body.shell ?? 'browser';
  const now = Date.now();
  sweepExpiredPkce(deps.pkceStates, now);
  if (deps.pkceStates.size >= MAX_PKCE_STATES) {
    throw new HttpError(429, 'too many pending cloud sign-in attempts');
  }
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  deps.pkceStates.set(state, {
    verifier,
    returnTo,
    origin: input.origin,
    shell,
    createdAt: now,
  });
  const url = new URL('/connect', cloudUrl);
  url.searchParams.set('redirect_uri', `${input.origin}/api/cloud/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkceChallengeOf(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: validateCloudTargetUrl(url.toString(), cloudUrl) };
}

export type CloudCallbackOutcome =
  | { kind: 'redirect'; location: string }
  | { kind: 'html'; status: number; html: string };

export async function completeCloudCallback(
  deps: CloudAccountDeps,
  input: { code?: string; state?: string; error?: string },
): Promise<CloudCallbackOutcome> {
  const state = input.state ?? '';
  const now = Date.now();
  const entry = state !== '' ? deps.pkceStates.get(state) : undefined;
  if (state !== '') deps.pkceStates.delete(state);
  sweepExpiredPkce(deps.pkceStates, now);
  if (entry === undefined || now - entry.createdAt >= PKCE_TTL_MS) {
    return { kind: 'redirect', location: '/app?cloud=error&reason=state' };
  }
  const failureResult = (reason: string): CloudCallbackOutcome => {
    if (entry.shell === 'desktop') {
      return { kind: 'html', status: 400, html: desktopCompletionHtml(false, null, reason) };
    }
    return {
      kind: 'redirect',
      location: appendQueryParam(
        appendQueryParam(entry.returnTo, 'cloud', 'error'),
        'reason',
        reason,
      ),
    };
  };
  if (deps.cloudUrl == null || deps.cloudUrl === '') {
    return failureResult('unconfigured');
  }
  if (input.error !== undefined || input.code === undefined || input.code === '') {
    return failureResult('denied');
  }
  const cloudUrl = deps.cloudUrl;
  let exchanged: z.infer<typeof controlPlaneExchangeSchema>;
  try {
    const res = await fetcherOf(deps)(`${cloudUrl}/api/app-auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        codeVerifier: entry.verifier,
        redirectUri: `${entry.origin}/api/cloud/callback`,
      }),
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
    });
    if (!res.ok) {
      return failureResult('exchange');
    }
    const parsed = controlPlaneExchangeSchema.safeParse(await res.json());
    if (!parsed.success) {
      return failureResult('exchange');
    }
    exchanged = parsed.data;
  } catch {
    return failureResult('exchange');
  }
  const filePath = cloudAccountFilePath(deps.dataDir);
  await withAccountFileLock(filePath, () => {
    writeStoredUnlocked(filePath, deps.secretBox, {
      accessToken: exchanged.accessToken,
      expiresAt: normalizeTimestampIso(exchanged.expiresAt),
      user: exchanged.user,
      updatedAt: Date.now(),
    });
  });
  if (entry.shell === 'desktop') {
    return {
      kind: 'html',
      status: 200,
      html: desktopCompletionHtml(true, exchanged.user.name),
    };
  }
  return {
    kind: 'redirect',
    location: appendQueryParam(entry.returnTo, 'cloud', 'connected'),
  };
}

export async function getCloudStatus(deps: CloudAccountDeps): Promise<CloudStatusResponse> {
  if (deps.cloudUrl == null || deps.cloudUrl === '') {
    return unlinkedStatus(false);
  }
  const cloudUrl = deps.cloudUrl;
  const filePath = cloudAccountFilePath(deps.dataDir);
  const stored = await withAccountFileLock(filePath, () =>
    readStoredUnlocked(filePath, deps.secretBox),
  );
  if (stored === null) {
    return unlinkedStatus(true);
  }
  try {
    const res = await fetcherOf(deps)(`${cloudUrl}/api/me`, {
      method: 'GET',
      headers: { authorization: `Bearer ${stored.accessToken}` },
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
    });
    if (res.status === 401) {
      await clearIfTokenMatches(filePath, stored.accessToken, deps.secretBox);
      return unlinkedStatus(true);
    }
    if (!res.ok) {
      return {
        ...unlinkedStatus(true),
        linked: true,
        cloudReachable: false,
        user: stored.user,
      };
    }
    const parsed = controlPlaneMeSchema.safeParse(await res.json());
    if (!parsed.success) {
      return {
        ...unlinkedStatus(true),
        linked: true,
        cloudReachable: false,
        user: stored.user,
      };
    }
    const me = parsed.data;
    if (
      me.user.sub !== stored.user.sub ||
      me.user.name !== stored.user.name ||
      me.user.email !== stored.user.email ||
      me.user.avatarUrl !== stored.user.avatarUrl
    ) {
      await withAccountFileLock(filePath, () => {
        const latest = readStoredUnlocked(filePath, deps.secretBox);
        if (latest !== null && latest.accessToken === stored.accessToken) {
          writeStoredUnlocked(filePath, deps.secretBox, {
            ...latest,
            user: me.user,
            updatedAt: Date.now(),
          });
        }
      });
    }
    const workspace: CloudWorkspaceView | null =
      me.tenant === null
        ? null
        : {
            appName: me.tenant.appName,
            url: validateOptionalCloudWorkspaceUrl(me.tenant.url, cloudUrl),
            status: me.tenant.status,
            ...(me.tenant.region !== undefined ? { region: me.tenant.region } : {}),
          };
    return {
      configured: true,
      linked: true,
      cloudReachable: true,
      user: me.user,
      subscribed: me.subscribed,
      hasBillingCustomer: me.hasBillingCustomer,
      subscriptionStatus: me.subscriptionStatus,
      currentPeriodEnd: normalizeTimestampIso(me.currentPeriodEnd),
      workspace,
    };
  } catch {
    return {
      ...unlinkedStatus(true),
      linked: true,
      cloudReachable: false,
      user: stored.user,
    };
  }
}

async function callLinkedCloudAction(
  deps: CloudAccountDeps,
  endpoint: '/api/billing/checkout' | '/api/billing/portal',
): Promise<string> {
  const cloudUrl = requireConfiguredCloudUrl(deps);
  const filePath = cloudAccountFilePath(deps.dataDir);
  const stored = await withAccountFileLock(filePath, () =>
    readStoredUnlocked(filePath, deps.secretBox),
  );
  if (stored === null) {
    throw new HttpError(401, 'cloud account not signed in');
  }
  let res: Response;
  try {
    res = await fetcherOf(deps)(`${cloudUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stored.accessToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, 'failed to reach cloud billing service');
  }
  if (res.status === 401) {
    await clearIfTokenMatches(filePath, stored.accessToken, deps.secretBox);
    throw new HttpError(401, 'cloud session expired; please sign in again');
  }
  if (!res.ok) {
    const msg = await parseControlPlaneError(res, 'cloud billing request failed');
    throw new HttpError(res.status >= 400 && res.status < 500 ? res.status : 502, msg);
  }
  let rawJson: unknown;
  try {
    rawJson = await res.json();
  } catch {
    throw new HttpError(502, 'cloud service returned an invalid response');
  }
  if (endpoint === '/api/billing/checkout') {
    const parsed = controlPlaneCheckoutSchema.safeParse(rawJson);
    if (!parsed.success) throw new HttpError(502, 'cloud service returned an invalid checkout URL');
    return validateCloudTargetUrl(parsed.data.checkoutUrl, cloudUrl);
  }
  const parsed = controlPlanePortalSchema.safeParse(rawJson);
  if (!parsed.success) throw new HttpError(502, 'cloud service returned an invalid portal URL');
  return validateCloudTargetUrl(parsed.data.portalUrl, cloudUrl);
}

export async function startCloudCheckout(deps: CloudAccountDeps): Promise<{ url: string }> {
  return { url: await callLinkedCloudAction(deps, '/api/billing/checkout') };
}

export async function openCloudBillingPortal(deps: CloudAccountDeps): Promise<{ url: string }> {
  return { url: await callLinkedCloudAction(deps, '/api/billing/portal') };
}

export async function disconnectCloudAccount(deps: CloudAccountDeps): Promise<void> {
  const filePath = cloudAccountFilePath(deps.dataDir);
  const stored = await withAccountFileLock(filePath, () => {
    const current = readStoredUnlocked(filePath, deps.secretBox);
    removeFileQuietly(filePath);
    return current;
  });
  if (stored === null || deps.cloudUrl == null || deps.cloudUrl === '') return;
  try {
    await fetcherOf(deps)(`${deps.cloudUrl}/api/app-auth/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stored.accessToken}` },
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    });
  } catch {
    return;
  }
}

export type CloudUserSummary = CloudUserProfile;
