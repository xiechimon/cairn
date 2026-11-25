import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { parseWith } from './lib/errors.js';
import { jsonBody } from './routes-helpers.js';
import { readDeployLease, updateDeployLease } from './services/deploy-lease.js';

const ownerSchema = z.object({ owner: z.string().uuid() }).strict();
const acquireSchema = ownerSchema.extend({ ttlMs: z.number().int().min(1).max(3_600_000) });

export function registerDeployRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/server/deploy/lease', (c) => c.json(readDeployLease(ctx.db)));
  app.put('/api/server/deploy/lease', async (c) => {
    const body = parseWith(acquireSchema, await jsonBody(c), 'body');
    return c.json(updateDeployLease(ctx.db, body.owner, body.ttlMs));
  });
  app.delete('/api/server/deploy/lease', async (c) => {
    const body = parseWith(ownerSchema, await jsonBody(c), 'body');
    const result = updateDeployLease(ctx.db, body.owner, null);
    ctx.machineHub.wake(ctx.team.id);
    return c.json(result);
  });
}
