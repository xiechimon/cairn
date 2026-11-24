import semver from 'semver';
import { ANTIGRAVITY_TOKEN_REGEX } from './antigravity-subscription.js';
import type { DesktopSubscriptionMetadata } from './desktop-local-credentials.js';

export interface AntigravityLocalStatus {
  installed: boolean;
  loggedIn: boolean;
  canLogin: boolean;
  runnerId?: string;
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
  | 'failed'
  | 'no-key'
  | 'save';

export type AntigravityLoginOutcome =
  | { ok: true; subscription: DesktopSubscriptionMetadata; runnerId?: string }
  | { ok: false; reason: AntigravityLoginFailure };

export type AntigravityLoginPhase = 'installing' | 'authenticating';

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

function toSemver(version: string): semver.SemVer | null {
  const parsed = semver.parse(version);
  if (parsed !== null) return parsed;
  return /^\d+(?:\.\d+){0,2}$/.test(version) ? semver.coerce(version) : null;
}

export function compareVersions(a: string, b: string): number {
  const sa = toSemver(a);
  const sb = toSemver(b);
  if (sa !== null && sb !== null) return semver.compare(sa, sb);
  return a.localeCompare(b);
}
