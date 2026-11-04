import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { isOwner, releaseFlag, validFlagKey } from './services/feature-flags.js';

export function registerFlagRoutes(app: Hono, ctx: AppContext): void {
  app.post('/api/flags/:key/release', (c) => {
    const key = c.req.param('key');
    if (!validFlagKey(key)) throw new HttpError(400, 'invalid flag key');
    if (!isOwner(ctx.db, ctx.user.id))
      throw new HttpError(403, 'only the owner can release a flag');
    releaseFlag(ctx.db, key);
    return c.json({ key, released: true });
  });
}
