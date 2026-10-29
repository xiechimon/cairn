import { redactSecrets } from '@cairn/shared';
import type { ExportedDispatchCase } from './types.mts';

export const HIGH_RISK_AFTER_REDACTION: RegExp[] = [
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/,
  /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
  /(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PATH_RE = /(?:\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+)/g;
const HOST_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|lan|internal|corp|home|test)\b/gi;
const REPO_RE = /\b(?!xiechimon\/cairn\b)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g;
const PERSON_CANDIDATE_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;

type Bucket = 'PERSON' | 'EMAIL' | 'PATH' | 'HOST' | 'REPO';

export class RedactionTable {
  private readonly maps = new Map<Bucket, Map<string, string>>();
  private readonly counters: Record<Bucket, number> = {
    PERSON: 0,
    EMAIL: 0,
    PATH: 0,
    HOST: 0,
    REPO: 0,
  };

  placeholder(bucket: Bucket, raw: string): string {
    const key =
      bucket === 'EMAIL' || bucket === 'HOST' || bucket === 'REPO' ? raw.toLowerCase() : raw;
    let map = this.maps.get(bucket);
    if (map === undefined) {
      map = new Map();
      this.maps.set(bucket, map);
    }
    const existing = map.get(key);
    if (existing !== undefined) return existing;
    this.counters[bucket] += 1;
    const token = `<${bucket}_${this.counters[bucket]}>`;
    map.set(key, token);
    return token;
  }
}

const SHARED = new RedactionTable();

function replaceAll(pattern: RegExp, text: string, map: (m: string) => string): string {
  return text.replace(pattern, (m) => map(m));
}

export function redactText(text: string, table: RedactionTable = SHARED): string {
  let out = text;
  out = replaceAll(EMAIL_RE, out, (m) => table.placeholder('EMAIL', m));
  out = replaceAll(PATH_RE, out, (m) => table.placeholder('PATH', m));
  out = replaceAll(HOST_RE, out, (m) => table.placeholder('HOST', m));
  out = replaceAll(REPO_RE, out, (m) => table.placeholder('REPO', m));
  out = replaceAll(PERSON_CANDIDATE_RE, out, (m) => table.placeholder('PERSON', m));
  const secrets = redactSecrets(out);
  return typeof secrets.value === 'string' ? secrets.value : out;
}

function stillHighRisk(text: string): boolean {
  return HIGH_RISK_AFTER_REDACTION.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

function redactDeep(value: unknown, table: RedactionTable): unknown {
  if (typeof value === 'string') return redactText(value, table);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, table));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redactDeep(v, table);
  }
  return out;
}

export function redactDispatchCase(
  input: ExportedDispatchCase,
  table: RedactionTable = SHARED,
): { kept: true; case: ExportedDispatchCase } | { kept: false; reason: string } {
  const redacted = redactDeep(input, table) as ExportedDispatchCase;
  const blob = JSON.stringify(redacted);
  if (stillHighRisk(blob)) {
    return { kept: false, reason: 'high-risk pattern remained after redaction' };
  }
  return { kept: true, case: redacted };
}

export function redactDispatchCases(
  inputs: ExportedDispatchCase[],
  table: RedactionTable = SHARED,
): Array<{ kept: true; case: ExportedDispatchCase } | { kept: false; reason: string }> {
  return inputs.map((c) => redactDispatchCase(c, table));
}
