import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { SecretBox } from '@cairn/shared';

export const ATTACHMENT_GRANT_TTL_MS = 5 * 60 * 1000;

export interface AttachmentGrantPayload {
  attachmentId: string;
  teamId: string;
  key: string;
  sizeBytes: number;
  mimeType: string;
  scope: 'spec' | 'message';
  exp: number;
}

const keyCache = new WeakMap<SecretBox, Buffer>();

function hmacKey(secretBox: SecretBox): Buffer {
  const cached = keyCache.get(secretBox);
  if (cached) return cached;
  const sealed = secretBox.seal('attachment-grant-key-v1');
  const plain = secretBox.open(sealed);
  const key = createHash('sha256').update(plain).digest();
  keyCache.set(secretBox, key);
  return key;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signAttachmentGrant(secretBox: SecretBox, payload: AttachmentGrantPayload): string {
  const json = JSON.stringify(payload);
  const head = b64url(json);
  const mac = createHmac('sha256', hmacKey(secretBox)).update(head).digest();
  return `${head}.${b64url(mac)}`;
}

export function verifyAttachmentGrant(secretBox: SecretBox, token: string): AttachmentGrantPayload {
  if (typeof token !== 'string' || token === '') {
    throw new AttachmentGrantError('grant missing', 401);
  }
  const sep = token.indexOf('.');
  if (sep <= 0 || sep >= token.length - 1) {
    throw new AttachmentGrantError('malformed grant', 401);
  }
  const head = token.slice(0, sep);
  const sig = token.slice(sep + 1);
  const expected = createHmac('sha256', hmacKey(secretBox)).update(head).digest();
  const provided = b64urlDecode(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AttachmentGrantError('grant signature mismatch', 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(head).toString('utf8'));
  } catch {
    throw new AttachmentGrantError('grant payload undecodable', 401);
  }
  if (!isPayload(payload)) {
    throw new AttachmentGrantError('grant payload invalid', 401);
  }
  if (payload.exp <= Date.now()) {
    throw new AttachmentGrantError('grant expired', 401);
  }
  return payload;
}

function isPayload(v: unknown): v is AttachmentGrantPayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.attachmentId === 'string' &&
    typeof p.teamId === 'string' &&
    typeof p.key === 'string' &&
    typeof p.sizeBytes === 'number' &&
    typeof p.mimeType === 'string' &&
    (p.scope === 'spec' || p.scope === 'message') &&
    typeof p.exp === 'number'
  );
}

export class AttachmentGrantError extends Error {
  constructor(
    message: string,
    public status: 401 | 409,
  ) {
    super(message);
    this.name = 'AttachmentGrantError';
  }
}
