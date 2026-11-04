const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_PREFIXES = ['text/', 'image/'];
const ALLOWED_EXACT = new Set(['application/json', 'application/pdf', 'application/xml']);

export type AttachmentRejectReason = 'invalid-name' | 'size' | 'mime' | 'grant' | 'upload';

export class AttachmentError extends Error {
  readonly reason: AttachmentRejectReason;

  constructor(reason: AttachmentRejectReason, message: string) {
    super(message);
    this.name = 'AttachmentError';
    this.reason = reason;
  }
}

function isAllowedMime(mime: string): boolean {
  if (ALLOWED_EXACT.has(mime)) return true;
  return ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
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
  if (file.size <= 0 || file.size > MAX_BYTES) {
    throw new AttachmentError('size', `size out of range: ${file.size} (max ${MAX_BYTES})`);
  }
  if (!isAllowedMime(file.type || '')) {
    throw new AttachmentError('mime', `mime not allowed: ${file.type || '(empty)'}`);
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
