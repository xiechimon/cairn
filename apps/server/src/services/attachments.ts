import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { attachment } from '../db/schema.js';
import type { AttachmentGrantPayload } from '../lib/attachments-token.js';
import {
  ATTACHMENT_GRANT_TTL_MS,
  AttachmentGrantError,
  signAttachmentGrant,
  verifyAttachmentGrant,
} from '../lib/attachments-token.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { KeySecretBox } from '../lib/secret-box.js';
import { TEAM_ATTACHMENTS_QUOTA_BYTES, teamAttachmentBytes } from './attachment-gc.js';

const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ['text/', 'image/'];
const ALLOWED_MIME_EXACT = new Set(['application/json', 'application/pdf', 'application/xml']);

export function isAllowedMime(mime: string): boolean {
  if (ALLOWED_MIME_EXACT.has(mime)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

const ALLOWED_EXTS = new Set([
  'md',
  'txt',
  'markdown',
  'rst',
  'adoc',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'm',
  'mm',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'sql',
  'graphql',
  'proto',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
  'pdf',
  'log',
  'diff',
  'patch',
]);

export function extOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0 || lastDot === fileName.length - 1) return '';
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export function isValidFileName(fileName: string): boolean {
  if (fileName.length === 0 || fileName.length > 200) return false;
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0')) return false;
  if (fileName === '.' || fileName === '..') return false;
  for (let i = 0; i < fileName.length; i += 1) {
    if (fileName.charCodeAt(i) < 0x20) return false;
  }
  return true;
}

export interface GrantInput {
  fileName: string;
  mimeType: string;
  size: number;
  scope: 'spec' | 'message';
}

export interface GrantOutput {
  uploadUrl: string;
  grant: string;
  key: string;
  attachmentId: string;
}

export interface AttachmentDeps {
  db: Db;
  secretBox: KeySecretBox;
  attachmentsDir: string;
  userId: string;
  teamId: string;
}

export function grantUpload(deps: AttachmentDeps, input: GrantInput): GrantOutput {
  if (!isValidFileName(input.fileName)) {
    throw new HttpError(400, `invalid fileName: ${JSON.stringify(input.fileName)}`);
  }
  if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_BYTES) {
    throw new HttpError(400, `invalid size: must be 1..${MAX_BYTES}`);
  }
  if (!isAllowedMime(input.mimeType)) {
    throw new HttpError(400, `mime not allowed: ${input.mimeType}`);
  }
  const ext = extOf(input.fileName);
  if (ext === '' || !ALLOWED_EXTS.has(ext)) {
    throw new HttpError(400, `file extension not allowed: ${ext || '(none)'}`);
  }
  const usedBytes = teamAttachmentBytes(deps.db, deps.teamId);
  if (usedBytes + input.size > TEAM_ATTACHMENTS_QUOTA_BYTES) {
    throw new HttpError(
      400,
      `team attachment quota exceeded: ${usedBytes} + ${input.size} > ${TEAM_ATTACHMENTS_QUOTA_BYTES}`,
    );
  }
  const id = newRecordId();
  const storageKey = `${deps.teamId}/${id}.${ext}`;
  const now = nowMs();
  const grantId = newRecordId();
  const payload: AttachmentGrantPayload = {
    attachmentId: id,
    teamId: deps.teamId,
    grantId,
    key: storageKey,
    sizeBytes: input.size,
    mimeType: input.mimeType,
    scope: input.scope,
    exp: now + ATTACHMENT_GRANT_TTL_MS,
  };
  deps.db
    .insert(attachment)
    .values({
      id,
      teamId: deps.teamId,
      createdBy: deps.userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.size,
      storageKey,
      grantId,
      scope: input.scope,
      status: 'pending',
      createdAt: now,
    })
    .run();
  const token = signAttachmentGrant(deps.secretBox, payload);
  return {
    uploadUrl: '/api/uploads',
    grant: token,
    key: storageKey,
    attachmentId: id,
  };
}

export interface UploadInput {
  grant: string;
  fileBytes: Uint8Array;
  fileMimeType: string;
  fileName: string;
}

export interface UploadOutput {
  id: string;
  key: string;
  sizeBytes: number;
}

export function uploadFile(deps: AttachmentDeps, input: UploadInput): UploadOutput {
  let payload: AttachmentGrantPayload;
  try {
    payload = verifyAttachmentGrant(deps.secretBox, input.grant);
  } catch (err) {
    if (err instanceof AttachmentGrantError) {
      throw new HttpError(err.status, err.message);
    }
    throw err;
  }
  if (payload.teamId !== deps.teamId) {
    throw new HttpError(401, 'grant team mismatch');
  }
  if (!isAllowedMime(payload.mimeType) || !isAllowedMime(input.fileMimeType)) {
    throw new HttpError(400, `mime not allowed: ${input.fileMimeType}`);
  }
  if (
    !Number.isInteger(payload.sizeBytes) ||
    payload.sizeBytes <= 0 ||
    payload.sizeBytes > MAX_BYTES ||
    input.fileBytes.byteLength > MAX_BYTES
  ) {
    throw new HttpError(400, `invalid size: must be 1..${MAX_BYTES}`);
  }
  if (input.fileBytes.byteLength !== payload.sizeBytes) {
    throw new HttpError(
      409,
      `uploaded size ${input.fileBytes.byteLength} ≠ grant ${payload.sizeBytes}`,
    );
  }
  if (input.fileMimeType !== payload.mimeType) {
    throw new HttpError(409, `uploaded mime ${input.fileMimeType} ≠ grant ${payload.mimeType}`);
  }
  const grantExt = payload.key.split('.').pop() ?? '';
  const fileExt = extOf(input.fileName);
  if (fileExt !== '' && grantExt !== fileExt) {
    throw new HttpError(409, `uploaded ext ${fileExt} ≠ grant ${grantExt}`);
  }
  const row = deps.db
    .select()
    .from(attachment)
    .where(
      and(
        eq(attachment.id, payload.attachmentId),
        eq(attachment.teamId, deps.teamId),
        eq(attachment.status, 'pending'),
      ),
    )
    .get();
  if (!row) {
    throw new HttpError(409, 'attachment grant pending row missing or already consumed');
  }
  if (
    row.grantId !== payload.grantId ||
    row.storageKey !== payload.key ||
    row.sizeBytes !== payload.sizeBytes ||
    row.mimeType !== payload.mimeType ||
    row.scope !== payload.scope
  ) {
    throw new HttpError(409, 'attachment grant payload does not match pending row');
  }
  const usedBytes = teamAttachmentBytes(deps.db, deps.teamId);
  if (usedBytes - row.sizeBytes + payload.sizeBytes > TEAM_ATTACHMENTS_QUOTA_BYTES) {
    throw new HttpError(
      400,
      `team attachment quota exceeded: ${usedBytes - row.sizeBytes} + ${payload.sizeBytes} > ${TEAM_ATTACHMENTS_QUOTA_BYTES}`,
    );
  }
  const attachmentsRoot = resolve(deps.attachmentsDir);
  const fullPath = resolve(deps.attachmentsDir, payload.key);
  const rootPrefix = attachmentsRoot.endsWith(sep) ? attachmentsRoot : attachmentsRoot + sep;
  if (fullPath !== attachmentsRoot && !fullPath.startsWith(rootPrefix)) {
    throw new HttpError(400, 'attachment key escapes attachments directory');
  }
  const parentDir = dirname(fullPath);
  mkdirSync(parentDir, { recursive: true });
  const realRoot = realpathSync(deps.attachmentsDir);
  const realParent = realpathSync(parentDir);
  const realPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realParent !== realRoot && !realParent.startsWith(realPrefix)) {
    throw new HttpError(400, 'attachment key escapes attachments directory');
  }
  writeFileSync(fullPath, input.fileBytes);
  const updated = deps.db
    .update(attachment)
    .set({ status: 'ready' })
    .where(
      and(
        eq(attachment.id, payload.attachmentId),
        eq(attachment.grantId, payload.grantId),
        eq(attachment.status, 'pending'),
      ),
    )
    .run();
  if (updated.changes !== 1) {
    throw new HttpError(409, 'attachment grant already consumed or missing');
  }
  return {
    id: payload.attachmentId,
    key: payload.key,
    sizeBytes: input.fileBytes.byteLength,
  };
}

export interface AttachmentRow {
  id: string;
  teamId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  scope: 'spec' | 'message';
  status: 'pending' | 'ready' | 'failed';
  createdAt: number;
}

export function requireAttachmentRow(db: Db, teamId: string, attachmentId: string): AttachmentRow {
  const row = db
    .select()
    .from(attachment)
    .where(and(eq(attachment.id, attachmentId), eq(attachment.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `attachment ${attachmentId}`);
  if (row.status !== 'ready') {
    throw new HttpError(409, `attachment ${attachmentId} not ready (${row.status})`);
  }
  return row;
}

export function readAttachment(
  deps: AttachmentDeps,
  attachmentId: string,
): { row: AttachmentRow; absPath: string } {
  const row = requireAttachmentRow(deps.db, deps.teamId, attachmentId);
  return { row, absPath: join(deps.attachmentsDir, row.storageKey) };
}

export function readAttachmentMeta(
  deps: { db: Db; attachmentsDir: string },
  teamId: string,
  attachmentId: string,
): {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  encoding: 'utf8' | 'base64';
  content: string;
} {
  const row = requireAttachmentRow(deps.db, teamId, attachmentId);
  const bytes = readFileSync(join(deps.attachmentsDir, row.storageKey));
  const isText = row.mimeType.startsWith('text/') || ALLOWED_MIME_EXACT.has(row.mimeType);
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    encoding: isText ? 'utf8' : 'base64',
    content: isText ? bytes.toString('utf8') : bytes.toString('base64'),
  };
}
