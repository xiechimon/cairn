import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { designPageResponse, readSharedPage } from './services/design.js';

export function registerDesignShareRoutes(app: Hono, ctx: AppContext): void {
  app.get('/s/:token', (c) => {
    const html = readSharedPage(ctx.db, ctx.attachmentsDir, c.req.param('token'));
    if (html === null) {
      return new Response('This shared page is no longer available.', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    const response = designPageResponse(html, { print: false });
    response.headers.set('cache-control', 'no-store');
    return response;
  });
}
