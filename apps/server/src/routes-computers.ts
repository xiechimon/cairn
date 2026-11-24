import { computerManageParamsSchema, packageInstallDecisionBodySchema } from '@cairn/shared';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { conditionalGet } from './lib/conditional-get.js';
import { HttpError, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { ensureCoordinatorComputer, listComputers } from './services/computer-feed.js';
import { computerStepShot, listComputerSteps } from './services/computer-steps.js';
import { decidePackageInstall, manageComputer } from './services/machine-computer.js';

export function registerComputerRoutes(app: Hono, ctx: AppContext): void {
  const requireOwnerSession = (c: Context): void => {
    const owner =
      pairedDeviceIdOf(c) === null &&
      (ctx.authToken === null || c.get('ownerIdentity') !== undefined);
    if (!owner) throw new HttpError(403, 'owner session required');
  };

  app.post('/api/computers/package-install', async (c) => {
    requireOwnerSession(c);
    const body = parseWith(packageInstallDecisionBodySchema, await c.req.json(), 'body');
    decidePackageInstall(ctx.db, ctx.team.id, ctx.user.id, body);
    return c.json({ ok: true });
  });

  app.post('/api/computers/:id/actions', async (c) => {
    requireOwnerSession(c);
    const body = parseWith(computerManageParamsSchema, await c.req.json(), 'body');
    const outcome = await manageComputer(
      { db: ctx.db, hub: ctx.hub, machineHub: ctx.machineHub },
      ctx.team.id,
      ctx.user.id,
      c.req.param('id'),
      body.action,
    );
    return c.json({ outcome });
  });

  app.get('/api/computers', conditionalGet(), (c) => {
    ensureCoordinatorComputer(ctx.db, ctx.team.id, ctx.user.id);
    return c.json({ computers: listComputers(ctx.db, ctx.team.id, ctx.user.id) });
  });

  app.get('/api/computers/steps', (c) =>
    c.json({ steps: listComputerSteps(ctx.db, ctx.team.id, ctx.user.id) }),
  );

  app.get('/api/computers/steps/:callId/shot', (c) => {
    const image = computerStepShot(ctx.db, ctx.team.id, ctx.user.id, c.req.param('callId'));
    if (image === null) throw new HttpError(404, 'no screenshot for this step');
    const bytes = Buffer.from(image.data, 'base64');
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': image.mimeType,
        'content-length': String(bytes.length),
        'cache-control': 'private, max-age=86400, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
      },
    });
  });
}
