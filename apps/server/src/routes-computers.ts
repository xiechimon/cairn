import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { conditionalGet } from './lib/conditional-get.js';
import { ensureCoordinatorComputer, listComputers } from './services/computer-feed.js';
import { computerStepShot, listComputerSteps } from './services/computer-steps.js';

export function registerComputerRoutes(app: Hono, ctx: AppContext): void {
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
