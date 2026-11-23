import {
  pairBodySchema,
  REMOTE_DESCRIPTOR_VERSION,
  type RemoteDescriptor,
  tailnetSetBodySchema,
} from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, parseWith } from './lib/errors.js';
import { remoteRoutesOf } from './lib/remote-routes.js';
import { hasOwnerBearer } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import { requestIsSecure, setAuthCookie } from './services/browser-session.js';
import {
  issuePairingGrant,
  listPairedDevices,
  listPairingGrants,
  pairFromGrant,
  revokePairedDevice,
  revokePairingGrant,
} from './services/paired-devices.js';

export function registerRemoteRoutes(app: Hono, ctx: AppContext): void {
  const remote = ctx.remote;
  if (remote === undefined) return;

  const requireOwner = (c: Context): void => {
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    if (c.get('ownerIdentity') !== undefined) return;
    if (!hasOwnerBearer(c, ctx.authToken)) {
      throw new HttpError(403, 'only the owner token can manage pairing');
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
    const routes = remoteRoutesOf(remote);
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
