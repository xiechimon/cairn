import { SECRET_BOX_ENVELOPE_VERSION } from './secret-box.js';

const BEARER_START = 'Bearer\\s';
const GITHUB_START = '(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20}';
const API_KEY_START = 'sk-[A-Za-z0-9_-]{20}';
const ENVELOPE_START = `${SECRET_BOX_ENVELOPE_VERSION}:[A-Za-z0-9+/]{38}`;
const NEXT_SECRET = `(?!${BEARER_START}|${GITHUB_START}|${API_KEY_START}|${ENVELOPE_START})`;
const GENERATED_RECORD_ID = '[A-Za-z0-9][A-Za-z0-9_-]{20}';

const REDACTION_PATTERN = new RegExp(
  [
    `((?<![A-Za-z0-9_-])chief-${GENERATED_RECORD_ID}-${GENERATED_RECORD_ID}(?![A-Za-z0-9_-]))`,
    '#token=[^\\s"\'<>\\\\]*',
    '(?<=[?&])token=[^\\s&"\'<>\\\\]*',
    '(?<=Authorization:[\\t ]*)Basic[\\t ]+[A-Za-z0-9+/]+=*',
    `Bearer\\s+[A-Za-z0-9._~+/-](?:${NEXT_SECRET}[A-Za-z0-9._~+/-])*=*`,
    `(?:gh[pousr]_|github_pat_)(?:${NEXT_SECRET}[A-Za-z0-9_]){20,}`,
    `sk-(?:${NEXT_SECRET}[A-Za-z0-9_-]){20,}`,
    `${SECRET_BOX_ENVELOPE_VERSION}:(?:${NEXT_SECRET}[A-Za-z0-9+/]){38,}={0,2}`,
    '(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}',
    'sk-[A-Za-z0-9_-]{20,}',
  ].join('|'),
  'gi',
);

export function redactSecrets(
  source: unknown,
  secrets: readonly string[] = [],
): { value: unknown; count: number } {
  let count = 0;
  const redactText = (text: string) => {
    for (const secret of secrets) {
      if (secret === '') continue;
      text = text.replaceAll(secret, () => {
        count++;
        return '[REDACTED]';
      });
    }
    return text.replace(REDACTION_PATTERN, (match, chiefId: string | undefined) => {
      if (chiefId !== undefined) return match;
      count++;
      return '[REDACTED]';
    });
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value !== 'object' || value === null) return value;
    const entries = Object.entries(value).map(([key, child]) => {
      if (/^(authorization|token|authToken)$/i.test(key) && child !== null) {
        count++;
        return [key, '[REDACTED]'] as const;
      }
      return [redactText(key), visit(child)] as const;
    });
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new Error('Redacted object keys collide');
    return Object.fromEntries(entries);
  };
  const value = visit(source);
  return { value, count };
}
