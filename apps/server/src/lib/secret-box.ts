import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SECRET_BOX_ENVELOPE_VERSION, type SecretBox } from '@cairn/shared';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecretBoxError';
  }
}

export type KeySecretBox = SecretBox & { keyBytes: Buffer };

function codec(key: Buffer): KeySecretBox {
  return {
    keyBytes: key,
    seal(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const body = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
      return `${SECRET_BOX_ENVELOPE_VERSION}:${body.toString('base64')}`;
    },
    open(envelope: string): string {
      const sep = envelope.indexOf(':');
      const version = sep >= 0 ? envelope.slice(0, sep) : '';
      if (version !== SECRET_BOX_ENVELOPE_VERSION) {
        throw new SecretBoxError(`unknown envelope version: ${version || '(missing)'}`);
      }
      const body = Buffer.from(envelope.slice(sep + 1), 'base64');
      if (body.length < IV_BYTES + TAG_BYTES) {
        throw new SecretBoxError('malformed envelope: truncated body');
      }
      const iv = body.subarray(0, IV_BYTES);
      const authTag = body.subarray(body.length - TAG_BYTES);
      const ciphertext = body.subarray(IV_BYTES, body.length - TAG_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      } catch (err) {
        throw new SecretBoxError('envelope authentication failed (tampered or wrong keyfile)', {
          cause: err,
        });
      }
    },
  };
}

export function createKeyfileSecretBox(keyfilePath: string): KeySecretBox {
  mkdirSync(dirname(keyfilePath), { recursive: true });
  if (!existsSync(keyfilePath)) {
    writeFileSync(keyfilePath, `${randomBytes(KEY_BYTES).toString('base64')}\n`, {
      mode: 0o600,
    });
    chmodSync(keyfilePath, 0o600); // writeFileSync's mode is trimmed by umask
  }
  const key = Buffer.from(readFileSync(keyfilePath, 'utf8').trim(), 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `keyfile malformed (expected base64 of ${KEY_BYTES} bytes): ${keyfilePath}`,
    );
  }
  return codec(key);
}

export function createEphemeralSecretBox(): KeySecretBox {
  return codec(randomBytes(KEY_BYTES));
}
