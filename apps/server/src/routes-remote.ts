import { networkInterfaces } from 'node:os';
import { pairBodySchema, REMOTE_DESCRIPTOR_VERSION, type RemoteDescriptor } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { buildRemoteRoutes } from './lib/remote-routes.js';
import { matchesAuthToken } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import {
  createPairedDevice,
  createPairingBook,
  hasRoomForDevice,
  listPairedDevices,
  revokePairedDevice,
} from './services/paired-devices.js';

function bearerToken(c: Context): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '');
  return match?.[1] ?? null;
}

export function registerRemoteRoutes(app: Hono, ctx: AppContext): void {
  const remote = ctx.remote;
  if (remote === undefined) return;
  const book = createPairingBook();

  const requireOwner = (c: Context): void => {
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    if (c.get('tailnetOwnerLogin') !== undefined) return;
    const provided = bearerToken(c);
    if (provided === null || !matchesAuthToken(ctx.authToken, provided)) {
      throw new HttpError(403, 'only the owner token can manage pairing');
    }
  };

  app.get('/api/remote/identity', (c) => {
    c.header('cache-control', 'no-store');
    const login = c.get('tailnetOwnerLogin');
    return c.json(login === undefined ? { login: null, via: null } : { login, via: 'tailscale' });
  });

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
    return c.json(
      buildRemoteRoutes(remote.environmentId, {
        listenHost: remote.listenHost,
        listenPort: remote.listenPort,
        interfaces: (remote.networkInterfaces ?? networkInterfaces)(),
        tailnet: remote.tailnetStatus(),
      }),
    );
  });

  app.post('/api/remote/pairing', (c) => {
    requireOwner(c);
    c.header('cache-control', 'no-store');
    const issued = book.issue();
    return c.json({ ...issued, environmentId: remote.environmentId }, 201);
  });

  app.post('/api/remote/pair', async (c) => {
    c.header('cache-control', 'no-store');
    if (ctx.authToken === null) {
      throw new HttpError(409, 'pairing needs token auth, which is turned off');
    }
    const body = parseWith(pairBodySchema, await jsonBody(c), 'body');
    if (!hasRoomForDevice(ctx.db)) {
      throw new HttpError(409, 'too many paired devices; revoke one first');
    }
    if (!book.redeem(body.code)) {
      throw new HttpError(401, 'pairing code is invalid or expired');
    }
    const { device, token } = createPairedDevice(ctx.db, {
      teamId: ctx.team.id,
      name: body.name,
    });
    return c.json({ token, deviceId: device.id, environmentId: remote.environmentId }, 201);
  });

  app.get('/api/remote/devices', (c) => {
    requireOwner(c);
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
