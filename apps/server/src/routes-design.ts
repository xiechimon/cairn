import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import type { AppContext } from './context.js';
import { HttpError } from './lib/errors.js';
import { readAttachment } from './services/attachments.js';
import {
  designPageResponse,
  listDesignPages,
  listDesignVersions,
  readDesignVersionHtml,
  requireDesignVersion,
  restoreDesignVersion,
} from './services/design.js';
import {
  buildDocumentPreview,
  DocumentPreviewError,
} from './vendor-open-design/document-preview.js';

export function registerDesignRoutes(app: Hono, ctx: AppContext): void {
  app.get('/api/todos/:id/design', (c) =>
    c.json({
      pages: listDesignPages(ctx.db, ctx.team.id, c.req.param('id')),
      shareOrigin: process.env.CAIRN_RELAY_ORIGIN?.trim() || null,
    }),
  );

  app.get('/api/todos/:id/design/:fileName/versions', (c) =>
    c.json(listDesignVersions(ctx.db, ctx.team.id, c.req.param('id'), c.req.param('fileName'))),
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
}
