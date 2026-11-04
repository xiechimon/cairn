import { SECRET_BOX_ENVELOPE_VERSION } from './secret-box.js';

const BEARER_START = 'Bearer\\s';
const GITHUB_START = '(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}';
const API_KEY_START = 'sk-[A-Za-z0-9_-]{20,}';
const ENVELOPE_START = `${SECRET_BOX_ENVELOPE_VERSION}:[A-Za-z0-9+/]{38,}`;
const NEXT_SECRET = `(?!${BEARER_START}|${GITHUB_START}|${API_KEY_START}|${ENVELOPE_START})`;

const REDACTION_PATTERN = new RegExp(
  [
    `Bearer\\s+[A-Za-z0-9._~+/-](?:${NEXT_SECRET}[A-Za-z0-9._~+/-])*=*`,
    `(?:gh[pousr]_|github_pat_)(?:${NEXT_SECRET}[A-Za-z0-9_]){20,}`,
    `sk-(?:${NEXT_SECRET}[A-Za-z0-9_-]){20,}`,
    `${SECRET_BOX_ENVELOPE_VERSION}:(?:${NEXT_SECRET}[A-Za-z0-9+/]){38,}={0,2}`,
  ].join('|'),
  'g',
);

export function redactSecrets(source: unknown): { value: unknown; count: number } {
  let count = 0;
  const redactText = (text: string) =>
    text.replace(REDACTION_PATTERN, () => {
      count++;
      return '[REDACTED]';
    });
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value !== 'object' || value === null) return value;
    const entries = Object.entries(value).map(
      ([key, child]) => [redactText(key), visit(child)] as const,
    );
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new Error('Redacted object keys collide');
    return Object.fromEntries(entries);
  };
  const value = visit(source);
  return { value, count };
}
