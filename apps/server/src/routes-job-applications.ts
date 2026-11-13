import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import {
  isJobOwnerCaller,
  setJobCapLimit,
  writeJobHost,
  writeOwnerProfile,
} from './services/job-applications.js';

const hostBodySchema = z.object({
  host: z.string(),
  status: z.enum(['allowed', 'refused']),
});
const profileBodySchema = z.object({
  fields: z.unknown().optional(),
  resumeAttachmentId: z.unknown().optional(),
});
const capBodySchema = z.object({
  limit: z.number(),
});

async function jobBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function requireJobOwner(c: Context, authToken: string | null): void {
  if (!isJobOwnerCaller(c.get('pairedDeviceId'), c.get('ownerIdentity'), authToken)) {
    throw new HttpError(403, 'only the owner can write job application state');
  }
}

export function registerJobApplicationRoutes(app: Hono, ctx: AppContext): void {
  app.put('/api/job-applications/hosts', async (c) => {
    requireJobOwner(c, ctx.authToken);
    const body = parseWith(hostBodySchema, await jobBody(c), 'body');
    writeJobHost(ctx.db, 'owner', ctx.user.id, body.host, body.status);
    return c.json({ host: body.host, status: body.status });
  });
  app.put('/api/job-applications/profile', async (c) => {
    requireJobOwner(c, ctx.authToken);
    const body = parseWith(profileBodySchema, await jobBody(c), 'body');
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
    const body = parseWith(capBodySchema, await jobBody(c), 'body');
    setJobCapLimit(ctx.db, 'owner', ctx.user.id, Date.now(), body.limit);
    return c.json({ limit: body.limit });
  });
}
