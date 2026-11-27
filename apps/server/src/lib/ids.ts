import { randomBytes, randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LEADING_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function newRecordId(size = 21): string {
  if (size <= 0) return '';
  let out = LEADING_ALPHABET.charAt(randomInt(LEADING_ALPHABET.length));
  const tail = randomBytes(size - 1);
  for (let i = 0; i < tail.length; i++) {
    out += ALPHABET[(tail[i] as number) & 63];
  }
  return out;
}

export function newUuidv7(): string {
  let ms = Date.now();
  const bytes = randomBytes(16);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nowMs(): number {
  return Date.now();
}
