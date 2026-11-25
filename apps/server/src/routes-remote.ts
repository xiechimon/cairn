import { networkInterfaces } from 'node:os';
import {
  feedbackSubmitBodySchema,
  pairBodySchema,
  pairClaimBodySchema,
  pairRequestBodySchema,
  REMOTE_DESCRIPTOR_VERSION,
  type RemoteDescriptor,
  tailnetSetBodySchema,
} from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, parseWith } from './lib/errors.js';
import { buildRemoteRoutes } from './lib/remote-routes.js';
import { pairRequestPeerOf } from './lib/request-origin.js';
import { matchesAuthToken, pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { requestIsSecure, setAuthCookie } from './services/browser-session.js';
import { submitFeedbackReport } from './services/feedback.js';
import {
  issuePairingGrant,
  listPairedDevices,
  listPairingGrants,
  pairFromGrant,
  revokePairedDevice,
  revokePairingGrant,
} from './services/paired-devices.js';
import {
  claimPairRequest,
  createPairRequest,
  decidePairRequest,
  listPairRequests,
} from './services/pairing-requests.js';

function bearerToken(c: Context): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1] ?? null;
}

export function registerRemoteRoutes(app: Hono, ctx: AppContext): void {
  const remote = ctx.remote;
  if (remote === undefined) return;

  const requireOwner = (c: Context): void => {
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    if (c.get('ownerIdentity') !== undefined) return;
    const provided = bearerToken(c);
    if (provided === null || !matchesAuthToken(ctx.authToken, provided)) {
      throw new HttpError(403, 'owner session required');
    }
  };

  app.get('/api/remote/descriptor', (c) => {
    const descriptor: RemoteDescriptor = {
      environmentId: remote.environmentId,
      version: REMOTE_DESCRIPTOR_VERSION,
    };
    c.header('cache-control', 'no-store');
    return c.json(descriptor);
  });

  app.get('/api/remote/routes', (c) => {
    c.header('cache-control', 'no-store');
    const routes = buildRemoteRoutes(remote.environmentId, {
      listenHost: remote.listenHost,
      listenPort: remote.listenPort,
      interfaces: (remote.networkInterfaces ?? networkInterfaces)(),
      tailnet: remote.tailnetStatus(),
    });
    if (ctx.authToken !== null && c.get('ownerIdentity') === undefined) {
      routes.tailnet.authUrl = null;
    }
    return c.json(routes);
  });

  app.get('/api/remote/tailscale', async (c) => {
    c.header('cache-control', 'no-store');
    if (remote.tailscale === undefined) throw new HttpError(404, 'tailscale access unavailable');
    return c.json(await remote.tailscale.status());
  });

  app.post('/api/remote/tailscale', async (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    if (remote.tailscale === undefined) throw new HttpError(404, 'tailscale access unavailable');
    return c.json(await remote.tailscale.enable());
  });

  app.get('/api/remote/pairing', (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    return c.json(listPairingGrants(ctx.db));
  });

  app.post('/api/remote/pairing', (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    const issued = issuePairingGrant(ctx.db);
    return c.json({ ...issued, environmentId: remote.environmentId }, 201);
  });

  app.delete('/api/remote/pairing/:id', (c) => {
    requireOwner(c);
    if (!revokePairingGrant(ctx.db, c.req.param('id'))) {
      throw new HttpError(404, 'pairing code not found');
    }
    return c.body(null, 204);
  });

  app.post('/api/remote/tailnet', async (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    if (remote.tailnet === undefined) throw new HttpError(404, 'tailnet access unavailable');
    const body = parseWith(tailnetSetBodySchema, await jsonBody(c), 'body');
    return c.json(await remote.tailnet.setEnabled(body.enabled));
  });

  const FEEDBACK_WINDOW_MS = 60_000;
  const FEEDBACK_MAX_PER_WINDOW = 10;
  const feedbackHits = new Map<string, number[]>();

  app.post('/api/feedback', async (c) => {
    c.header('cache-control', 'no-store');
    const callerKey = pairedDeviceIdOf(c) ?? 'owner';
    const now = Date.now();
    const recent = (feedbackHits.get(callerKey) ?? []).filter(
      (ts) => now - ts < FEEDBACK_WINDOW_MS,
    );
    if (recent.length >= FEEDBACK_MAX_PER_WINDOW) {
      return c.json({ error: 'too many feedback submissions' }, 429);
    }
    const body = parseWith(feedbackSubmitBodySchema, await jsonBody(c), 'body');
    recent.push(now);
    feedbackHits.set(callerKey, recent);
    const isOwner = !ctx.authToken || c.get('ownerIdentity') !== undefined;
    const result = await submitFeedbackReport({
      body: isOwner ? body : { ...body, includeLogs: false },
      homeDir: ctx.homeDir,
      dataDir: ctx.dataDir ?? ctx.homeDir,
      extraSecrets: typeof ctx.authToken === 'string' ? [ctx.authToken] : [],
    });
    return c.json(result, 201);
  });

  const requireTokenAuth = (): void => {
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
  };

  app.post('/api/remote/pair/request', async (c) => {
    if (
      c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      return c.json({ error: 'application/json required' }, 415);
    }
    requireTokenAuth();
    c.header('cache-control', 'no-store');
    const body = parseWith(pairRequestBodySchema, await jsonBody(c), 'body');
    const { source, peer } = pairRequestPeerOf(c);
    const issued = createPairRequest(ctx.db, {
      name: body.name,
      detail: body.detail,
      source,
      peer,
    });
    return c.json(issued, 201);
  });

  app.post('/api/remote/pair/claim', async (c) => {
    if (
      c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      return c.json({ error: 'application/json required' }, 415);
    }
    requireTokenAuth();
    c.header('cache-control', 'no-store');
    const body = parseWith(pairClaimBodySchema, await jsonBody(c), 'body');
    const outcome = claimPairRequest(ctx.db, {
      id: body.id,
      secret: body.secret,
      teamId: ctx.team.id,
    });
    if (outcome.status === 'missing') throw new HttpError(404, 'pairing request not found');
    if (outcome.status !== 'approved') return c.json({ status: outcome.status });
    setAuthCookie(c, outcome.sessionToken, requestIsSecure(c), outcome.sessionExpiresAt);
    return c.json({
      status: 'approved',
      token: outcome.token,
      deviceId: outcome.device.id,
      environmentId: remote.environmentId,
    });
  });

  app.get('/api/remote/pairing-requests', (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    return c.json(listPairRequests(ctx.db));
  });

  app.post('/api/remote/pairing-requests/:id/:decision', (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    const decision = c.req.param('decision');
    if (decision !== 'approve' && decision !== 'deny') {
      throw new HttpError(404, 'Not found');
    }
    const result = decidePairRequest(
      ctx.db,
      c.req.param('id'),
      decision === 'approve' ? 'approved' : 'denied',
    );
    if (result === 'missing') throw new HttpError(404, 'pairing request not found');
    if (result === 'decided') {
      throw new HttpError(409, 'pairing request already decided or expired');
    }
    return c.json({ id: c.req.param('id') });
  });

  app.post('/api/remote/pair', async (c) => {
    if (
      c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
    ) {
      return c.json({ error: 'application/json required' }, 415);
    }
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    const body = parseWith(pairBodySchema, await jsonBody(c), 'body');
    if (body.environmentId !== undefined && body.environmentId !== remote.environmentId) {
      throw new HttpError(409, 'pairing environment mismatch');
    }
    const paired = pairFromGrant(ctx.db, {
      code: body.code,
      teamId: ctx.team.id,
      name: body.name,
    });
    if (paired === null) {
      throw new HttpError(401, 'pairing code is invalid or expired');
    }
    setAuthCookie(c, paired.sessionToken, requestIsSecure(c));
    return c.json(
      { token: paired.token, deviceId: paired.device.id, environmentId: remote.environmentId },
      201,
    );
  });

  app.get('/api/remote/devices', conditionalGet(), (c) => {
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    return c.json(listPairedDevices(ctx.db, ctx.team.id));
  });

  app.delete('/api/remote/devices/:id', (c) => {
    requireOwner(c);
    if (!revokePairedDevice(ctx.db, ctx.team.id, c.req.param('id'))) {
      throw new HttpError(404, 'device not found');
    }
    return c.body(null, 204);
  });
}
