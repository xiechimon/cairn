import { ANTIGRAVITY_TOKEN_REGEX } from './antigravity-subscription.js';

export interface AntigravityLocalStatus {
  installed: boolean;
  loggedIn: boolean;
  canLogin: boolean;
  version?: string;
  source?: 'local' | 'managed';
}

export type AntigravityLoginFailure =
  | 'no-binary'
  | 'spawn'
  | 'exit'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'failed';

export type AntigravityLoginOutcome = { ok: true } | { ok: false; reason: AntigravityLoginFailure };

const GEMINI_KEY_ENV_LINE =
  /^(?:export\s+)?GEMINI_API_KEY\s*=\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s#\r\n]+))\s*$/m;

export function antigravityKeyFromText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const lineMatch = GEMINI_KEY_ENV_LINE.exec(trimmed);
  const envValue = lineMatch?.[1] ?? lineMatch?.[2] ?? lineMatch?.[3];
  if (envValue !== undefined) {
    return ANTIGRAVITY_TOKEN_REGEX.test(envValue) ? envValue : null;
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      for (const field of ['GEMINI_API_KEY', 'apiKey', 'token']) {
        const candidate = parsed[field];
        if (typeof candidate === 'string' && ANTIGRAVITY_TOKEN_REGEX.test(candidate.trim())) {
          return candidate.trim();
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  return ANTIGRAVITY_TOKEN_REGEX.test(trimmed) ? trimmed : null;
}

export function antigravityCliDir(home: string): string {
  return `${home}/.gemini/antigravity-cli`;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0 || Number.isNaN(pa[i]) || Number.isNaN(pb[i])) {
      return Number.isNaN(diff) ? a.localeCompare(b) : diff;
    }
  }
  return 0;
}

export function managedVersionedBins(
  versionsDir: string,
  versions: readonly string[],
  binRelPaths: readonly string[],
): string[] {
  return [...versions]
    .sort((a, b) => compareVersions(b, a))
    .flatMap((version) => binRelPaths.map((rel) => `${versionsDir}/${version}/${rel}`));
}
