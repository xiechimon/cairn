import { z } from 'zod';

export const CLAUDE_LOGIN_STATES = ['ok', 'expiring', 'expired', 'unknown'] as const;
export const CLAUDE_LOGIN_DAY_MS = 24 * 60 * 60 * 1000;
export const CLAUDE_LOGIN_WARN_WITHIN_MS = 3 * CLAUDE_LOGIN_DAY_MS;

export const claudeLoginSchema = z.object({
  state: z.enum(CLAUDE_LOGIN_STATES),
  expiresAt: z.number().int().optional(),
});
export type ClaudeLogin = z.infer<typeof claudeLoginSchema>;

export type ClaudeAuthProbeState = 'logged-in' | 'not-logged-in' | 'unknown';

export type ClaudeLoginNotice = { kind: 'expired' } | { kind: 'expiring'; days: number | null };

type LoginFact = { state: string; expiresAt?: number } | null | undefined;

export function classifyClaudeCodeLogin(
  authState: ClaudeAuthProbeState,
  expiresAt: number | null,
  nowMs: number,
): ClaudeLogin {
  if (authState === 'unknown') return { state: 'unknown' };
  if (expiresAt !== null) {
    if (nowMs >= expiresAt) return { state: 'expired', expiresAt };
    if (expiresAt - nowMs <= CLAUDE_LOGIN_WARN_WITHIN_MS) {
      return { state: 'expiring', expiresAt };
    }
    return { state: 'ok', expiresAt };
  }
  if (authState === 'logged-in') return { state: 'ok' };
  return { state: 'unknown' };
}

export function claudeLoginBlocksClaim(login: LoginFact, nowMs: number): boolean {
  if (login == null || login.state === 'unknown') return false;
  if (login.state === 'expired') return true;
  return typeof login.expiresAt === 'number' && login.expiresAt <= nowMs;
}

export function claudeLoginNotice(login: LoginFact, nowMs: number): ClaudeLoginNotice | null {
  if (login == null || login.state === 'unknown') return null;
  if (typeof login.expiresAt === 'number') {
    if (nowMs >= login.expiresAt) return { kind: 'expired' };
    const remaining = login.expiresAt - nowMs;
    if (remaining > CLAUDE_LOGIN_WARN_WITHIN_MS) return null;
    if (remaining < CLAUDE_LOGIN_DAY_MS) return { kind: 'expiring', days: null };
    return { kind: 'expiring', days: Math.ceil(remaining / CLAUDE_LOGIN_DAY_MS) };
  }
  if (login.state === 'expired') return { kind: 'expired' };
  if (login.state === 'expiring') return { kind: 'expiring', days: null };
  return null;
}
