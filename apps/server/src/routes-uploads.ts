import { readFileSync } from 'node:fs';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { HttpError, parseWith } from './lib/errors.js';
import { jsonBody } from './routes-helpers.js';
import {
  grantUpload as grantAttachmentUpload,
  readAttachment,
  uploadFile as uploadAttachmentFile,
} from './services/attachments.js';

export function registerUploadRoutes(app: Hono, ctx: AppContext): void {
  const grantBodySchema = z.object({
    kind: z.literal('attachment'),
    fileName: z.string(),
    mimeType: z.string(),
    size: z.number().int().positive(),
    scope: z.enum(['spec', 'message']).optional(),
  });

  app.post('/api/uploads/grant', async (c) => {
    const body = parseWith(grantBodySchema, await jsonBody(c), 'body');
    const out = grantAttachmentUpload(
      {
        db: ctx.db,
        secretBox: ctx.secretBox,
        attachmentsDir: ctx.attachmentsDir,
        userId: ctx.user.id,
        teamId: ctx.team.id,
      },
      {
        fileName: body.fileName,
        mimeType: body.mimeType,
        size: body.size,
        scope: body.scope ?? 'message',
      },
    );
    return c.json(out, 200);
  });

  app.post('/api/uploads/upload', async (c) => {
    const form = await c.req.formData();
    const grant = form.get('grant');
    const file = form.get('file');
    if (typeof grant !== 'string' || grant === '') {
      throw new HttpError(401, 'grant missing');
    }
    if (!(file instanceof File)) {
      throw new HttpError(400, 'file missing');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const out = uploadAttachmentFile(
      {
        db: ctx.db,
        secretBox: ctx.secretBox,
        attachmentsDir: ctx.attachmentsDir,
        userId: ctx.user.id,
        teamId: ctx.team.id,
      },
      {
        grant,
        fileBytes: bytes,
        fileMimeType: file.type || 'application/octet-stream',
        fileName: file.name || '',
      },
    );
    return c.json(out, 201);
  });

  app.get('/api/attachments/:id', async (c) => {
    const id = c.req.param('id');
    const { row, absPath } = readAttachment(
      {
        db: ctx.db,
        secretBox: ctx.secretBox,
        attachmentsDir: ctx.attachmentsDir,
        userId: ctx.user.id,
        teamId: ctx.team.id,
      },
      id,
    );
    const bytes = readFileSync(absPath);
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': row.mimeType,
        'content-length': String(row.sizeBytes),
        'cache-control': 'private, max-age=300',
      },
    });
  });
}
