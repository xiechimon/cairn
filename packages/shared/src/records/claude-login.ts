import { z } from 'zod';

export const CLAUDE_LOGIN_STATES = ['ok', 'expiring', 'expired', 'unknown'] as const;
const CLAUDE_LOGIN_WARN_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;

export const claudeLoginSchema = z.object({
  state: z.enum(CLAUDE_LOGIN_STATES),
  expiresAt: z.number().int().optional(),
});
export type ClaudeLogin = z.infer<typeof claudeLoginSchema>;

export type ClaudeAuthProbeState = 'logged-in' | 'not-logged-in' | 'unknown';

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
