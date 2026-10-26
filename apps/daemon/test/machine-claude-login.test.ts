import { describe, expect, test } from 'vitest';
import { boot, waitFor } from './machine-loop-harness.js';

const DAY = 24 * 60 * 60 * 1000;

function loginOf(body: unknown): { state?: string; expiresAt?: number } | undefined {
  return (body as { claudeCode?: { login?: { state?: string; expiresAt?: number } } } | undefined)
    ?.claudeCode?.login;
}

describe('machine presence carries Claude Code login', () => {
  test('startup presence reports expiring when the oauth clock is inside 3 days', async () => {
    const expiresAt = Date.now() + 2 * DAY;
    const { handle, api } = await boot({
      readClaudeOauthExpiresAt: () => expiresAt,
    });
    try {
      await waitFor(() => api.presenceBodies.length > 0);
      expect(loginOf(api.enrollBodies[0])).toEqual({ state: 'expiring', expiresAt });
      expect(loginOf(api.presenceBodies[0])).toEqual({ state: 'expiring', expiresAt });
    } finally {
      await handle.stop();
      await handle.done;
    }
  });

  test('an unknown auth probe does not read credentials and reports unknown', async () => {
    let reads = 0;
    const { handle, api } = await boot({
      claudeCodeAuthProbe: async () => ({ state: 'unknown', reason: 'probe failed' }),
      readClaudeOauthExpiresAt: () => {
        reads += 1;
        return Date.now() - 60_000;
      },
    });
    try {
      await waitFor(() => api.presenceBodies.length > 0);
      expect(loginOf(api.presenceBodies[0])).toEqual({ state: 'unknown' });
      expect(reads).toBe(0);
    } finally {
      await handle.stop();
      await handle.done;
    }
  });

  test('the presence beat re-probes and the next report follows a newly expired clock', async () => {
    let expiresAt = Date.now() + 2 * DAY;
    const { handle, api } = await boot({
      presenceIntervalMs: 40,
      readClaudeOauthExpiresAt: () => expiresAt,
    });
    try {
      await waitFor(() => api.presenceBodies.length > 0);
      expect(loginOf(api.presenceBodies[0])?.state).toBe('expiring');
      expiresAt = Date.now() - 60_000;
      await waitFor(() => api.presenceBodies.some((body) => loginOf(body)?.state === 'expired'));
    } finally {
      await handle.stop();
      await handle.done;
    }
  });
});
