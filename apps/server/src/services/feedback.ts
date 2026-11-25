import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { type FeedbackSubmitBody, type FeedbackSubmitResponse, redactSecrets } from '@cairn/shared';

const MAX_DIAGNOSTICS_CHARS = 12_000;
const PER_FILE_TAIL_CHARS = 4_000;
export const DEFAULT_FEEDBACK_ENDPOINT = 'https://feedback.xmon.me/submit';

function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeFeedbackText(raw: string, extraSecrets: readonly string[] = []): string {
  let out = String(redactSecrets(raw).value);
  for (const secret of extraSecrets) {
    if (secret.length >= 6) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out
    .replace(/\bcairn_dev_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\bcairn_session=[^;\s"'`]+/g, 'cairn_session=[REDACTED]')
    .replace(/([#?&](?:pair|token)=)[^\s&#"'`]+/gi, '$1[REDACTED]')
    .replace(/((?:set-)?cookie:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\/Users\/[^/\s"'`]+/g, '/Users/~')
    .replace(/\/home\/[^/\s"'`]+/g, '/home/~')
    .replace(/[A-Z]:\\Users\\[^\\\s"'`]+/gi, 'C:\\Users\\~');
}

function readTail(path: string, maxChars: number): string {
  try {
    const content = readFileSync(path, 'utf8');
    return content.length <= maxChars ? content : content.slice(-maxChars);
  } catch {
    return '';
  }
}

export function collectSanitizedDiagnostics(input: {
  homeDir: string;
  dataDir: string;
  maxChars?: number;
  extraSecrets?: readonly string[];
}): string {
  const maxChars = input.maxChars ?? MAX_DIAGNOSTICS_CHARS;
  const dirs = [
    ...new Set([join(input.homeDir, 'logs'), join(input.dataDir, 'logs'), input.homeDir]),
  ];
  const candidates: Array<{ path: string; name: string; mtimeMs: number }> = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.log')) continue;
        const full = join(dir, entry);
        const st = lstatSync(full);
        if (st.isSymbolicLink() || !st.isFile() || st.size === 0) continue;
        candidates.push({ path: full, name: entry, mtimeMs: st.mtimeMs });
      }
    } catch {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const chunks: string[] = [];
  let total = 0;
  for (const file of candidates.slice(0, 4)) {
    const tail = sanitizeFeedbackText(
      readTail(file.path, PER_FILE_TAIL_CHARS),
      input.extraSecrets,
    ).trim();
    if (tail === '') continue;
    const block = `--- ${file.name} ---\n${tail}`;
    if (total + block.length > maxChars) {
      const remaining = maxChars - total;
      if (remaining > 200) chunks.push(block.slice(0, remaining));
      break;
    }
    chunks.push(block);
    total += block.length;
  }
  return chunks.join('\n\n');
}

export async function submitFeedbackReport(input: {
  body: FeedbackSubmitBody;
  homeDir: string;
  dataDir: string;
  endpoint?: string | null;
  fetchImpl?: typeof fetch;
  extraSecrets?: readonly string[];
}): Promise<FeedbackSubmitResponse> {
  const localId = `fb_${randomBytes(6).toString('hex')}`;
  const includeLogs = input.body.includeLogs !== false;
  const logs = includeLogs
    ? collectSanitizedDiagnostics({
        homeDir: input.homeDir,
        dataDir: input.dataDir,
        ...(input.extraSecrets !== undefined ? { extraSecrets: input.extraSecrets } : {}),
      })
    : '';
  const payload = {
    id: localId,
    createdAt: new Date().toISOString(),
    message: sanitizeFeedbackText(input.body.message, input.extraSecrets),
    route:
      input.body.route !== undefined
        ? sanitizeFeedbackText(input.body.route, input.extraSecrets)
        : null,
    errorSummary:
      input.body.errorSummary !== undefined
        ? sanitizeFeedbackText(input.body.errorSummary, input.extraSecrets)
        : null,
    context: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    ...(logs !== '' ? { logs } : {}),
  };

  const localPath = join(input.dataDir, 'feedback.jsonl');
  mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
  appendFileSync(localPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });

  const endpoint =
    input.endpoint === undefined
      ? (process.env.CAIRN_FEEDBACK_ENDPOINT ?? DEFAULT_FEEDBACK_ENDPOINT)
      : input.endpoint;
  if (endpoint !== null && endpoint !== '') {
    const fetchFn = input.fetchImpl ?? globalThis.fetch;
    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const remote = (await res.json()) as { id?: string; issueUrl?: string | null };
        if (typeof remote.id === 'string' && remote.id !== '') {
          const safeUrl =
            typeof remote.issueUrl === 'string' && isHttpsUrl(remote.issueUrl)
              ? remote.issueUrl
              : undefined;
          return {
            ok: true,
            id: remote.id,
            ...(safeUrl !== undefined ? { issueUrl: safeUrl } : {}),
          };
        }
      }
    } catch {}
  }

  return { ok: true, id: localId };
}
