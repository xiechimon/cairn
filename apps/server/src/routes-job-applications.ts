import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { setJobCapLimit, writeJobHost, writeOwnerProfile } from './services/job-applications.js';

function requireJobOwner(c: Context, authToken: string | null): void {
  if (c.get('pairedDeviceId') || (authToken !== null && c.get('ownerIdentity') === undefined)) {
    throw new HttpError(403, 'only the owner can write job application state');
  }
}

export function registerJobApplicationRoutes(app: Hono, ctx: AppContext): void {
  app.put('/api/job-applications/hosts', async (c) => {
    requireJobOwner(c, ctx.authToken);
    const body = (await c.req.json()) as { host?: unknown; status?: unknown };
    if ((body.status !== 'allowed' && body.status !== 'refused') || typeof body.host !== 'string') {
      throw new HttpError(400, 'invalid host');
    }
    writeJobHost(ctx.db, 'owner', ctx.user.id, body.host, body.status);
    return c.json({ host: body.host, status: body.status });
  });
  app.put('/api/job-applications/profile', async (c) => {
    requireJobOwner(c, ctx.authToken);
    const body = (await c.req.json()) as { fields?: unknown; resumeAttachmentId?: unknown };
    const saved = writeOwnerProfile(ctx.db, 'owner', {
      userId: ctx.user.id,
      teamId: ctx.team.id,
      fields: body.fields,
      resumeAttachmentId:
        typeof body.resumeAttachmentId === 'string' ? body.resumeAttachmentId : null,
    });
    return c.json(saved);
  });
  app.put('/api/job-applications/cap', async (c) => {
    requireJobOwner(c, ctx.authToken);
    const body = (await c.req.json()) as { limit?: unknown };
    if (typeof body.limit !== 'number') throw new HttpError(400, 'invalid cap');
    setJobCapLimit(ctx.db, 'owner', ctx.user.id, Date.now(), body.limit);
    return c.json({ limit: body.limit });
  });
}
