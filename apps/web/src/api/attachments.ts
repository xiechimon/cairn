import { ATTACHMENT_MAX_BYTES, resolveAttachmentMime } from '@cairn/shared';

const MAX_BYTES = ATTACHMENT_MAX_BYTES;

export type AttachmentRejectReason = 'invalid-name' | 'size' | 'mime' | 'grant' | 'upload';

export class AttachmentError extends Error {
  readonly reason: AttachmentRejectReason;

  constructor(reason: AttachmentRejectReason, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.reason = reason;
  }
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
  const grantRes = await fetch('/api/uploads/grant', {
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
    throw new AttachmentError('grant', `grant failed: ${grantRes.status} ${await grantRes.text()}`);
  }
  const grantBody = (await grantRes.json()) as GrantResponse;
  const form = new FormData();
  form.set('grant', grantBody.grant);
  form.set('file', file, file.name);
  const upRes = await fetch(`${grantBody.uploadUrl}/upload`, { method: 'POST', body: form });
  if (!upRes.ok) {
    throw new AttachmentError('upload', `upload failed: ${upRes.status} ${await upRes.text()}`);
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
