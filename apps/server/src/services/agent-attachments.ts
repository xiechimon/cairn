import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTACHMENT_MAX_BYTES,
  formatAttachmentToken,
  inlineImageMimeOfBytes,
  isImageAttachmentExt,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import {
  attachment,
  chiefMessage,
  type chiefThread,
  message,
  type step,
  type todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { extOf, validateAttachmentUpload, writeAttachmentFile } from './attachments.js';
import { recordDesignVersion } from './design.js';
import { type MachineDeps, upsertChiefRow, upsertMessage } from './machine-deps.js';
import { stepScopeProjectId } from './picked-project.js';

const BINARY_MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const BINARY_KIND_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'pdf',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  mp4: 'isobmff',
  mov: 'isobmff',
  webm: 'ebml',
};

function binaryKindOfBytes(bytes: Buffer): string | null {
  const image = inlineImageMimeOfBytes(bytes);
  if (image !== null) return image;
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip';
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'isobmff';
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'ebml';
  return null;
}

export function attachmentMime(fileName: string, bytes: Buffer): string {
  const ext = extOf(fileName);
  if (isImageAttachmentExt(ext) && !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    throw new HttpError(400, 'attach_file image type is not allowed; use PNG, JPEG, GIF, or WebP');
  }
  const detected = binaryKindOfBytes(bytes);
  if (detected !== null) {
    const mime = BINARY_MIME_BY_EXT[ext];
    if (mime === undefined || BINARY_KIND_BY_EXT[ext] !== detected)
      throw new HttpError(400, 'attach_file content does not match its file extension');
    return mime;
  }
  if (isImageAttachmentExt(ext) || ext in BINARY_MIME_BY_EXT) {
    throw new HttpError(400, 'attach_file content does not match its file extension');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(
      400,
      'attach_file requires a supported image, PDF, Office document, video, or UTF-8 text file',
    );
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
      recordDesignVersion(deps.db, {
        teamId: todoRow.teamId,
        todoId: todoRow.id,
        fileName,
        attachmentId: id,
        sha256,
        createdBy: `step:${stepRow.id}`,
        createdAt: nowMs(),
      });
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

export function attachCoordinatorFile(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  input: { fileName: string; caption?: string | undefined; bytes: Buffer },
): { id: string; key: string; token: string; sha256: string } {
  if (stepRow.status !== 'claimed') throw new HttpError(409, 'attach_file requires a claimed turn');
  if (input.caption !== undefined && input.caption.length > 2000) {
    throw new HttpError(400, 'attach_file caption must be a string of at most 2000 characters');
  }
  if (input.bytes.length <= 0) {
    throw new HttpError(400, 'attach_file requires a non-empty file');
  }
  if (input.bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new HttpError(400, 'attach_file exceeds the 10 MiB attachment cap');
  }
  const mimeType = attachmentMime(input.fileName, input.bytes);
  validateAttachmentUpload(
    { db: deps.db, teamId: threadRow.teamId },
    {
      fileName: input.fileName,
      mimeType,
      size: input.bytes.length,
      scope: 'message',
    },
  );
  const id = newRecordId();
  const key = `${threadRow.teamId}/${id}.${extOf(input.fileName)}`;
  const caption = (
    input.caption !== undefined && input.caption.trim() !== '' ? input.caption : input.fileName
  ).replace(/[[\]\r\n]/g, ' ');
  const token = formatAttachmentToken(caption, key);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const outputId = `attachment-output-${stepRow.id}`;
  const prior = deps.db.select().from(chiefMessage).where(eq(chiefMessage.id, outputId)).get();
  const now = nowMs();
  writeAttachmentFile(deps.attachmentsDir, key, input.bytes);
  try {
    deps.db.transaction(() => {
      deps.db
        .insert(attachment)
        .values({
          id,
          teamId: threadRow.teamId,
          todoId: null,
          sha256,
          createdBy: `step:${stepRow.id}`,
          fileName: input.fileName,
          mimeType,
          sizeBytes: input.bytes.length,
          storageKey: key,
          grantId: newRecordId(),
          scope: 'message',
          status: 'ready',
          createdAt: now,
        })
        .run();
      upsertChiefRow(deps, {
        id: outputId,
        threadId: threadRow.id,
        projectId: stepScopeProjectId(stepRow),
        role: 'assistant',
        content: typeof prior?.content === 'string' ? `${prior.content}\n${token}` : token,
        createdAt: prior?.createdAt ?? now,
      });
    });
  } catch (error) {
    rmSync(join(deps.attachmentsDir, key), { force: true });
    throw error;
  }
  return { id, key, token, sha256 };
}
