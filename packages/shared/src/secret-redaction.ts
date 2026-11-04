import { SECRET_BOX_ENVELOPE_VERSION } from './secret-box.js';

export function redactSecrets(source: unknown): { value: unknown; count: number } {
  let count = 0;
  const pattern = new RegExp(
    `Bearer\\s+[A-Za-z0-9._~+/-]+=*|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|${SECRET_BOX_ENVELOPE_VERSION}:[A-Za-z0-9+/]{38,}={0,2}`,
    'g',
  );
  const redactText = (text: string) =>
    text.replace(pattern, () => {
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
