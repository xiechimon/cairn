import { ATTACHMENT_MAX_BYTES, isValidFileName, resolveAttachmentMime } from '@cairn/shared';
import { fetchWithSession } from './auth.js';

export { isValidFileName };

const MAX_BYTES = ATTACHMENT_MAX_BYTES;

export type AttachmentRejectReason =
  | 'invalid-name'
  | 'size'
  | 'mime'
  | 'quota'
  | 'grant'
  | 'upload';

export class AttachmentError extends Error {
  readonly reason: AttachmentRejectReason;

  constructor(reason: AttachmentRejectReason, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.reason = reason;
  }
}

export interface AttachFileInput {
  file: File;
  scope: 'spec' | 'message';
}

export interface AttachResult {
  token: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  key: string;
  attachmentId: string;
}

interface GrantResponse {
  uploadUrl: string;
  grant: string;
  key: string;
  attachmentId: string;
}

export async function attachFile(input: AttachFileInput): Promise<AttachResult> {
  const { file, scope } = input;
  if (!isValidFileName(file.name)) {
    throw new AttachmentError('invalid-name', `invalid fileName: ${file.name}`);
  }
  if (file.size < 0 || file.size > MAX_BYTES) {
    throw new AttachmentError('size', `size out of range: ${file.size} (max ${MAX_BYTES})`);
  }
  if (resolveAttachmentMime(file.name, file.type) === null) {
    throw new AttachmentError('mime', `file type not allowed: ${file.name}`);
  }
  const grantRes = await fetchWithSession('/api/uploads/grant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'attachment',
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      scope,
    }),
  });
  if (!grantRes.ok) {
    const body = await grantRes.text();
    if (/quota exceeded/i.test(body)) {
      throw new AttachmentError('quota', `grant failed: ${grantRes.status} ${body}`);
    }
    throw new AttachmentError('grant', `grant failed: ${grantRes.status} ${body}`);
  }
  const grantBody = (await grantRes.json()) as GrantResponse;
  const form = new FormData();
  form.set('grant', grantBody.grant);
  form.set('file', file, file.name);
  const upRes = await fetchWithSession(`${grantBody.uploadUrl}/upload`, {
    method: 'POST',
    body: form,
  });
  if (!upRes.ok) {
    const body = await upRes.text();
    if (/quota exceeded/i.test(body)) {
      throw new AttachmentError('quota', `upload failed: ${upRes.status} ${body}`);
    }
    throw new AttachmentError('upload', `upload failed: ${upRes.status} ${body}`);
  }
  return {
    token: `![${file.name}](attachment:${grantBody.key})`,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    key: grantBody.key,
    attachmentId: grantBody.attachmentId,
  };
}
