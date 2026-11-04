import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { ATTACHMENT_MAX_BYTES, formatAttachmentToken, isImageAttachmentExt } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { attachment, message, type step, type todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { extOf, validateAttachmentUpload, writeAttachmentFile } from './attachments.js';
import { type MachineDeps, upsertMessage } from './machine-deps.js';

function attachmentMime(fileName: string, bytes: Buffer): string {
  const ext = extOf(fileName);
  if (isImageAttachmentExt(ext) && !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    throw new HttpError(400, 'attach_file image type is not allowed; use PNG, JPEG, GIF, or WebP');
  }
  const starts = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const detected = starts('89504e470d0a1a0a')
    ? 'image/png'
    : starts('ffd8ff')
      ? 'image/jpeg'
      : bytes.subarray(0, 6).toString('latin1') === 'GIF87a' ||
          bytes.subarray(0, 6).toString('latin1') === 'GIF89a'
        ? 'image/gif'
        : bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
            bytes.subarray(8, 12).toString('latin1') === 'WEBP'
          ? 'image/webp'
          : bytes.subarray(0, 5).toString('latin1') === '%PDF-'
            ? 'application/pdf'
            : null;
  const expected: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  if (detected !== null) {
    if (expected[ext] !== detected)
      throw new HttpError(400, 'attach_file content does not match its file extension');
    return detected;
  }
  if (isImageAttachmentExt(ext) || ext === 'pdf') {
    throw new HttpError(400, 'attach_file content does not match its file extension');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'attach_file requires a supported image, PDF, or UTF-8 text file');
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new HttpError(400, 'attach_file text contains binary control characters');
    }
  }
  if (ext === 'json') {
    try {
      JSON.parse(text);
    } catch {
      throw new HttpError(400, 'attach_file requires valid JSON content');
    }
    return 'application/json';
  }
  return ext === 'xml' ? 'application/xml' : 'text/plain';
}

export function attachWorkerFile(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  params: Record<string, unknown>,
): string {
  if (stepRow.status !== 'claimed') throw new HttpError(409, 'attach_file requires a claimed step');
  if (typeof params.fileName !== 'string' || typeof params.contentBase64 !== 'string') {
    throw new HttpError(400, 'attach_file requires a file prepared inside the step worktree');
  }
  if (
    params.caption !== undefined &&
    (typeof params.caption !== 'string' || params.caption.length > 2000)
  ) {
    throw new HttpError(400, 'attach_file caption must be a string of at most 2000 characters');
  }
  const fileName = params.fileName;
  const encoded = params.contentBase64;
  if (encoded.length > 4 * Math.ceil(ATTACHMENT_MAX_BYTES / 3)) {
    throw new HttpError(400, 'attach_file exceeds the 10 MiB attachment cap');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > ATTACHMENT_MAX_BYTES)
    throw new HttpError(400, 'attach_file exceeds the 10 MiB attachment cap');
  if (bytes.toString('base64') !== encoded)
    throw new HttpError(400, 'attach_file content must be valid base64');
  const mimeType = attachmentMime(fileName, bytes);
  validateAttachmentUpload(
    { db: deps.db, teamId: todoRow.teamId },
    {
      fileName,
      mimeType,
      size: bytes.length,
      scope: 'message',
    },
  );
  const id = newRecordId();
  const key = `${todoRow.teamId}/${id}.${extOf(fileName)}`;
  const caption = (typeof params.caption === 'string' ? params.caption : fileName).replace(
    /[[\]\r\n]/g,
    ' ',
  );
  const token = formatAttachmentToken(caption, key);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const outputId = `attachment-output-${stepRow.id}`;
  const prior = deps.db.select().from(message).where(eq(message.id, outputId)).get();
  writeAttachmentFile(deps.attachmentsDir, key, bytes);
  try {
    deps.db.transaction(() => {
      deps.db
        .insert(attachment)
        .values({
          id,
          teamId: todoRow.teamId,
          todoId: todoRow.id,
          sha256,
          createdBy: `step:${stepRow.id}`,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
          storageKey: key,
          grantId: newRecordId(),
          scope: 'message',
          status: 'ready',
          createdAt: nowMs(),
        })
        .run();
      upsertMessage(deps, {
        id: outputId,
        conversationId: stepRow.buildId,
        role: 'assistant',
        content: typeof prior?.content === 'string' ? `${prior.content}\n${token}` : token,
        createdAt: prior?.createdAt ?? nowMs(),
      });
    });
  } catch (error) {
    rmSync(join(deps.attachmentsDir, key), { force: true });
    throw error;
  }
  return JSON.stringify({ id, key, token, sha256 });
}
