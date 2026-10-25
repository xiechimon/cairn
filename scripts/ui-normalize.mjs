import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function stripCodeComments(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
}

export function normalizeSource(source) {
  return stripCodeComments(source)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function normalizedHash(source) {
  return createHash('sha256').update(normalizeSource(source), 'utf8').digest('hex');
}

export function hashFile(path) {
  return normalizedHash(readFileSync(path, 'utf8'));
}

export function isHashShape(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
