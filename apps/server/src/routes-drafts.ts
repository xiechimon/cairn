import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { jsonBody, requireTeam } from './routes-helpers.js';
import {
  COMPOSER_DRAFT_MAX_CHARS,
  COMPOSER_DRAFT_SCOPE_RE,
  readComposerDraft,
  writeComposerDraft,
} from './services/composer-drafts.js';

const putDraftBodySchema = z.object({ content: z.string().max(COMPOSER_DRAFT_MAX_CHARS) });

export function registerDraftRoutes(app: Hono, ctx: AppContext): void {
  function ownerOf(teamId: string, scope: string) {
    requireTeam(ctx, teamId);
    if (!COMPOSER_DRAFT_SCOPE_RE.test(scope)) throw new HttpError(400, 'invalid draft scope');
    return { teamId, userId: ctx.user.id, scope };
  }

  app.get('/api/teams/:id/drafts/:scope', (c) =>
    c.json(readComposerDraft(ctx.db, ownerOf(c.req.param('id'), c.req.param('scope')))),
  );

  app.put('/api/teams/:id/drafts/:scope', async (c) => {
    const owner = ownerOf(c.req.param('id'), c.req.param('scope'));
    const body = parseWith(putDraftBodySchema, await jsonBody(c), 'body');
    return c.json(writeComposerDraft(ctx.db, owner, body.content));
  });
}
