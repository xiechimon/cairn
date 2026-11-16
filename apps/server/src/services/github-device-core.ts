import { HttpError } from '../lib/errors.js';
import { type FetchLike, githubUserIdentity } from '../lib/github.js';

const VERIFICATION_URI = 'https://github.com/login/device';
const DEVICE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(502, 'GitHub returned an incomplete device authorization');
  }
  return value;
}

function positiveSeconds(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(502, 'GitHub returned an invalid authorization expiry or interval');
  }
  return value;
}

async function postForm(
  deps: { fetch: FetchLike },
  url: string,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await deps.fetch(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, 'GitHub authorization is temporarily unavailable');
  }
  if (response.status === 401) {
    if (fields.grant_type === 'refresh_token') {
      throw new HttpError(401, 'GitHub authorization expired; reconnect GitHub');
    }
    return { error: 'unauthorized_client' };
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.get('retry-after') !== null))
  ) {
    throw new HttpError(429, 'GitHub is throttling authorization requests; try connecting later');
  }
  if (response.status === 403) {
    throw new HttpError(
      403,
      'GitHub authorization forbidden; check App permissions or organization policy',
    );
  }
  if (!response.ok && response.status !== 400)
    throw new HttpError(502, 'GitHub authorization is temporarily unavailable');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(502, 'GitHub returned an invalid authorization response');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(502, 'GitHub returned an invalid authorization response');
  }
  return body as Record<string, unknown>;
}

function tokenGrant(body: Record<string, unknown>) {
  return {
    accessToken: requiredString(body, 'access_token'),
    refreshToken: requiredString(body, 'refresh_token'),
    expiresInSeconds: positiveSeconds(body, 'expires_in'),
    refreshTokenExpiresInSeconds: positiveSeconds(body, 'refresh_token_expires_in'),
    scope: typeof body.scope === 'string' ? body.scope : '',
  };
}

export async function requestGithubDeviceCode(deps: { fetch: FetchLike }, clientId: string) {
  const body = await postForm(deps, DEVICE_URL, {
    client_id: clientId,
    scope: 'offline_access',
  });
  if (body.error !== undefined) {
    throw new HttpError(
      502,
      'GitHub device authorization failed; check the public App registration',
    );
  }
  if (body.verification_uri !== VERIFICATION_URI) {
    throw new HttpError(502, 'GitHub returned an untrusted verification URL');
  }
  return {
    deviceCode: requiredString(body, 'device_code'),
    userCode: requiredString(body, 'user_code'),
    verificationUri: VERIFICATION_URI,
    intervalSeconds: body.interval === undefined ? 5 : positiveSeconds(body, 'interval'),
    expiresInSeconds: positiveSeconds(body, 'expires_in'),
  };
}

export async function pollGithubDeviceCode(
  deps: { fetch: FetchLike },
  clientId: string,
  deviceCode: string,
) {
  const body = await postForm(deps, TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (body.error === 'authorization_pending') return { status: 'pending' as const };
  if (body.error === 'slow_down') {
    return {
      status: 'slow_down' as const,
      ...(body.interval === undefined
        ? {}
        : { intervalSeconds: positiveSeconds(body, 'interval') }),
    };
  }
  if (body.error === 'expired_token') return { status: 'expired' as const };
  if (body.error === 'access_denied') return { status: 'denied' as const };
  if (body.error !== undefined) return { status: 'failed' as const };
  const grant = tokenGrant(body);
  let identity: Awaited<ReturnType<typeof githubUserIdentity>>;
  try {
    identity = await githubUserIdentity(deps.fetch, grant.accessToken);
  } catch {
    throw new HttpError(502, 'Could not verify the GitHub account; reconnect GitHub');
  }
  return { status: 'complete' as const, ...grant, identity };
}

export async function refreshGithubDeviceToken(
  deps: { fetch: FetchLike },
  clientId: string,
  refreshToken: string,
) {
  const body = await postForm(deps, TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (body.error === 'bad_refresh_token' || body.error === 'expired_token') {
    throw new HttpError(401, 'GitHub authorization expired; reconnect GitHub');
  }
  if (body.error !== undefined)
    throw new HttpError(502, 'GitHub token refresh is temporarily unavailable');
  return tokenGrant(body);
}
