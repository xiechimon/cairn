import { redactSecrets } from '@cairn/shared';
import type { ExportedDispatchCase } from './types.mts';

export const HIGH_RISK_AFTER_REDACTION: RegExp[] = [
  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/,
  /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
  /(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\/(?:srv|var|opt|data|mnt|root|private|Users|home)\b/,
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PATH_RE =
  /(?:\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+|\/(?:srv|var|opt|data|mnt|root|private)\/[^\s"'`]+)/g;
const DOTTED_HOST_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:local|lan|internal|corp|home|test|[a-z]{2,})\b/gi;
const SINGLE_HOST_RE =
  /\b(?:(?:host(?:name)?|machine|server|box|node)\s+|on\s+|ssh\s+|@)([a-z][a-z0-9-]{1,48})\b/gi;
const BARE_HOST_TOKEN_RE =
  /\b(?!(?:cairn|localhost|http|https|email|repo|path)\b)(omarchy|devbox|staging|prod-box|[a-z0-9]+-box)\b/gi;
const REPO_OWNER_RE = /\b(?!xiechimon\/cairn\b)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g;
const STANDALONE_REPO_RE =
  /\b(?:repo(?:sitory)?|project)\s+(?!cairn\b)([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;
const PERSON_LATIN_RE = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
const CN_SURNAMES =
  '张李王刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程魏苏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const CN_PERSON_RE = new RegExp(
  `(?:${[...CN_SURNAMES].map((c) => c).join('|')})[\\u4e00-\\u9fff]{1,2}`,
  'g',
);

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
  out = replaceAll(DOTTED_HOST_RE, out, (m) => table.placeholder('HOST', m));
  out = out.replace(SINGLE_HOST_RE, (full, host: string) =>
    full.replace(host, table.placeholder('HOST', host)),
  );
  out = replaceAll(BARE_HOST_TOKEN_RE, out, (m) => table.placeholder('HOST', m));
  out = replaceAll(REPO_OWNER_RE, out, (m) => table.placeholder('REPO', m));
  out = out.replace(STANDALONE_REPO_RE, (full, repo: string) =>
    full.replace(repo, table.placeholder('REPO', repo)),
  );
  out = replaceAll(PERSON_LATIN_RE, out, (m) => table.placeholder('PERSON', m));
  out = replaceAll(CN_PERSON_RE, out, (m) => table.placeholder('PERSON', m));
  const secrets = redactSecrets(out);
  return typeof secrets.value === 'string' ? secrets.value : out;
}

function stillHighRisk(text: string): boolean {
  return HIGH_RISK_AFTER_REDACTION.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

function redactDeep(value: unknown, table: RedactionTable, path: string[] = []): unknown {
  if (typeof value === 'string') {
    let out = redactText(value, table);
    const leaf = path[path.length - 1];
    if (
      (leaf === 'name' || leaf === 'displayName') &&
      out !== 'cairn' &&
      out !== 'xiechimon/cairn' &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(out)
    ) {
      out = table.placeholder('REPO', out);
    }
    if (leaf === 'displayName' || leaf === 'name') {
      if (CN_PERSON_RE.test(out)) {
        CN_PERSON_RE.lastIndex = 0;
        out = redactText(out, table);
      }
      CN_PERSON_RE.lastIndex = 0;
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v, i) => redactDeep(v, table, [...path, String(i)]));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redactDeep(v, table, [...path, k]);
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
