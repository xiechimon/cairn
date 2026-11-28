import { cloudConnectStartBodySchema } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { requestOrigin } from './lib/request-origin.js';
import { matchesAuthToken, pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import {
  type CloudAccountDeps,
  type CloudPkceEntry,
  completeCloudCallback,
  disconnectCloudAccount,
  getCloudStatus,
  openCloudBillingPortal,
  startCloudCheckout,
  startCloudConnect,
} from './services/cloud-account.js';

function bearerToken(c: Context): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1] ?? null;
}

function requireCloudOwner(c: Context, ctx: AppContext): void {
  const deviceId = pairedDeviceIdOf(c);
  const owner = c.get('ownerIdentity');
  if (deviceId !== null || owner?.via === 'device') {
    throw new HttpError(403, 'owner session required');
  }
  if (ctx.authToken !== null) {
    const ownerCookieOrAccess = owner?.via === 'session' || owner?.via === 'access';
    if (!ownerCookieOrAccess) {
      const provided = bearerToken(c);
      if (provided === null || !matchesAuthToken(ctx.authToken, provided)) {
        throw new HttpError(403, 'owner session required');
      }
    }
  }
}

export function registerCloudRoutes(app: Hono, ctx: AppContext): void {
  const pkceStates = ctx.cloudPkceStates ?? new Map<string, CloudPkceEntry>();
  const deps = (): CloudAccountDeps => ({
    cloudUrl: ctx.cloudUrl ?? null,
    dataDir: ctx.dataDir ?? ctx.homeDir,
    secretBox: ctx.secretBox,
    pkceStates,
    ...(ctx.cloudFetch !== undefined ? { cloudFetch: ctx.cloudFetch } : {}),
  });

  app.get('/api/cloud/status', async (c) => {
    requireCloudOwner(c, ctx);
    c.header('cache-control', 'no-store');
    return c.json(await getCloudStatus(deps()));
  });

  app.post('/api/cloud/connect/start', async (c) => {
    requireCloudOwner(c, ctx);
    c.header('cache-control', 'no-store');
    const rawBody = await jsonBody(c);
    const body = rawBody === null ? {} : parseWith(cloudConnectStartBodySchema, rawBody, 'body');
    const origin = requestOrigin(c, ctx.webOrigin, ctx.trustedProxies);
    return c.json(startCloudConnect(deps(), { origin, body }));
  });

  app.get('/api/cloud/callback', async (c) => {
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    const outcome = await completeCloudCallback(deps(), {
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
    });
    if (outcome.kind === 'html') {
      c.header('x-frame-options', 'DENY');
      c.header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      );
      return c.html(outcome.html, outcome.status as 200 | 400);
    }
    return c.redirect(outcome.location, 302);
  });

  app.post('/api/cloud/checkout', async (c) => {
    requireCloudOwner(c, ctx);
    c.header('cache-control', 'no-store');
    return c.json(await startCloudCheckout(deps()));
  });

  app.post('/api/cloud/billing-portal', async (c) => {
    requireCloudOwner(c, ctx);
    c.header('cache-control', 'no-store');
    return c.json(await openCloudBillingPortal(deps()));
  });

  app.post('/api/cloud/disconnect', async (c) => {
    requireCloudOwner(c, ctx);
    c.header('cache-control', 'no-store');
    await disconnectCloudAccount(deps());
    return c.json({ ok: true });
  });
}
