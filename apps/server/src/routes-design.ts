import { readFileSync } from 'node:fs';
import {
  artifactUserVersionSchema,
  DESIGN_LIMITS,
  designCommentCreateSchema,
  designCommentPatchSchema,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { jsonBody } from './routes-helpers.js';
import { readAttachment } from './services/attachments.js';
import {
  artifactOfAttachment,
  createDesignShare,
  designPageResponse,
  listDesignPages,
  listDesignVersions,
  readDesignVersionHtml,
  relayOrigin,
  requireDesignVersion,
  restoreDesignVersion,
  revokeDesignShare,
  saveUserVersion,
} from './services/design.js';
import {
  createDesignComment,
  deleteDesignComment,
  listDesignComments,
  patchDesignComment,
  saveDesignMark,
} from './services/design-comments.js';
import {
  buildDocumentPreview,
  DocumentPreviewError,
} from './vendor-open-design/document-preview.js';

const markBodySchema = z.object({
  pngBase64: z
    .string()
    .min(1)
    .max(Math.ceil((DESIGN_LIMITS.markBytes * 4) / 3) + 4),
});

export function registerDesignRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/todos/:id/design', (c) =>
    c.json({
      pages: listDesignPages(ctx.db, ctx.team.id, c.req.param('id')),
      shareOrigin: relayOrigin(),
    }),
  );

  app.get('/api/todos/:id/design/:fileName/versions', (c) =>
    c.json(listDesignVersions(ctx.db, ctx.team.id, c.req.param('id'), c.req.param('fileName'))),
  );

  app.post('/api/todos/:id/design/:fileName/versions', async (c) => {
    const body = parseWith(artifactUserVersionSchema, await jsonBody(c), 'body');
    return c.json(
      saveUserVersion(
        { db: ctx.db, attachmentsDir: ctx.attachmentsDir },
        {
          teamId: ctx.team.id,
          todoId: c.req.param('id'),
          fileName: c.req.param('fileName'),
          userId: ctx.user.id,
          content: body.content,
        },
      ),
      201,
    );
  });

  app.get('/api/attachments/:id/artifact', (c) =>
    c.json(artifactOfAttachment(ctx.db, ctx.team.id, c.req.param('id'))),
  );

  app.post('/api/todos/:id/design/versions/:versionId/restore', (c) =>
    c.json(
      restoreDesignVersion(ctx.db, {
        teamId: ctx.team.id,
        todoId: c.req.param('id'),
        versionId: c.req.param('versionId'),
        userId: ctx.user.id,
      }),
      201,
    ),
  );

  app.get('/api/design/versions/:versionId/page', (c) => {
    const version = requireDesignVersion(ctx.db, ctx.team.id, c.req.param('versionId'));
    const html = readDesignVersionHtml(ctx.db, ctx.attachmentsDir, version);
    return designPageResponse(html, { print: c.req.query('print') === '1' });
  });

  app.get('/api/attachments/:id/document-preview', (c) => {
    const { row, absPath } = readAttachment(
      {
        db: ctx.db,
        secretBox: ctx.secretBox,
        attachmentsDir: ctx.attachmentsDir,
        userId: ctx.user.id,
        teamId: ctx.team.id,
      },
      c.req.param('id'),
    );
    try {
      return c.json(buildDocumentPreview({ name: row.fileName, buffer: readFileSync(absPath) }));
    } catch (error) {
      if (error instanceof DocumentPreviewError)
        throw new HttpError(error.statusCode, error.message);
      throw error;
    }
  });

  app.get('/api/todos/:id/design/:fileName/comments', (c) =>
    c.json(listDesignComments(ctx.db, ctx.team.id, c.req.param('id'), c.req.param('fileName'))),
  );

  app.post('/api/todos/:id/design/comments', async (c) => {
    const body = parseWith(designCommentCreateSchema, await jsonBody(c), 'body');
    return c.json(
      createDesignComment(ctx.db, {
        teamId: ctx.team.id,
        todoId: c.req.param('id'),
        userId: ctx.user.id,
        body,
      }),
      201,
    );
  });

  app.patch('/api/todos/:id/design/comments/:commentId', async (c) => {
    const body = parseWith(designCommentPatchSchema, await jsonBody(c), 'body');
    return c.json(
      patchDesignComment(ctx.db, {
        teamId: ctx.team.id,
        todoId: c.req.param('id'),
        commentId: c.req.param('commentId'),
        body,
      }),
    );
  });

  app.delete('/api/todos/:id/design/comments/:commentId', (c) => {
    deleteDesignComment(ctx.db, {
      teamId: ctx.team.id,
      todoId: c.req.param('id'),
      commentId: c.req.param('commentId'),
    });
    return c.json({ ok: true as const });
  });

  app.post('/api/todos/:id/design/marks', async (c) => {
    const body = parseWith(markBodySchema, await jsonBody(c), 'body');
    return c.json(
      saveDesignMark(
        { db: ctx.db, attachmentsDir: ctx.attachmentsDir },
        {
          teamId: ctx.team.id,
          todoId: c.req.param('id'),
          userId: ctx.user.id,
          pngBase64: body.pngBase64,
        },
      ),
      201,
    );
  });

  app.post('/api/todos/:id/design/:fileName/share', (c) =>
    c.json(
      createDesignShare(ctx.db, {
        teamId: ctx.team.id,
        todoId: c.req.param('id'),
        fileName: c.req.param('fileName'),
        userId: ctx.user.id,
      }),
      201,
    ),
  );

  app.delete('/api/todos/:id/design/:fileName/share', (c) => {
    revokeDesignShare(ctx.db, {
      teamId: ctx.team.id,
      todoId: c.req.param('id'),
      fileName: c.req.param('fileName'),
    });
    return c.json({ ok: true as const });
  });
}
