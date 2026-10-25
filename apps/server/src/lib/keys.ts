import { randomBytes } from 'node:crypto';
import { hashCredential } from './hash.js';

export function newMachineToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString('hex');
  return { plain, hash: hashCredential(plain) };
}

export function newDeviceId(): string {
  return randomBytes(16).toString('hex');
}
