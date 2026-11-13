import { readFileSync } from 'node:fs';
import { ATTACHMENT_MAX_BYTES, isInlineAttachment, servedAttachmentMime } from '@cairn/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppContext } from './context.js';
import { attachmentDownloadDisposition } from './lib/attachment-disposition.js';
import { HttpError, parseWith } from './lib/errors.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { jsonBody } from './routes-helpers.js';
import {
  grantUpload as grantAttachmentUpload,
  readAttachment,
  uploadFile as uploadAttachmentFile,
} from './services/attachments.js';
import { assertDeviceActive } from './services/paired-devices.js';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function registerUploadRoutes(app: Hono, ctx: AppContext): void {
  const grantBodySchema = z.object({
    kind: z.literal('attachment'),
    fileName: z.string(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
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

  const boundedUpload = bodyLimit({
    maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES,
    onError: (c) => c.json({ error: `invalid size: must be 0..${ATTACHMENT_MAX_BYTES}` }, 400),
  });

  app.post('/api/uploads/upload', boundedUpload, async (c) => {
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
    assertDeviceActive(pairedDeviceIdOf(c));
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
    const download = c.req.query('download') === '1';
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
    const inlineDisposition = isInlineAttachment(row.storageKey, row.mimeType)
      ? 'inline'
      : 'attachment';
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': servedAttachmentMime(row.storageKey),
        'content-length': String(row.sizeBytes),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'content-disposition': download
          ? attachmentDownloadDisposition(row.fileName)
          : inlineDisposition,
      },
    });
  });
}
