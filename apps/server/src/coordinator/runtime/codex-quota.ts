import type { ClaudeSubscriptionQuotaWindow } from '@cairn/shared';
import { z } from 'zod';
import type { FetchLike } from '../../lib/github.js';
import { CODEX_BASE_URL } from '../codex-login.js';

const windowSchema = z.object({
  used_percent: z.number().min(0).max(100),
  limit_window_seconds: z
    .number()
    .int()
    .positive()
    .max(366 * 86400),
  reset_at: z.number().int().positive().max(8_640_000_000_000).nullable().optional(),
});
const usageSchema = z.object({
  rate_limit: z.object({ primary_window: z.unknown(), secondary_window: z.unknown() }),
});

export async function readCodexQuota(
  fetch: FetchLike,
  credential: { access: string; accountId: string },
  signal: AbortSignal,
  now: number,
): Promise<ClaudeSubscriptionQuotaWindow[]> {
  try {
    const response = await fetch(`${CODEX_BASE_URL}/wham/usage`, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      headers: {
        authorization: `Bearer ${credential.access}`,
        'chatgpt-account-id': credential.accountId,
      },
    });
    if (!response.ok) {
      if (response instanceof Response) await response.body?.cancel();
      return [];
    }
    const payload = usageSchema.safeParse(await response.json());
    if (!payload.success) return [];
    const { primary_window, secondary_window } = payload.data.rate_limit;
    const windows = new Map<string, ClaudeSubscriptionQuotaWindow>();
    for (const raw of [primary_window, secondary_window]) {
      const window = windowSchema.safeParse(raw);
      if (!window.success) continue;
      const { limit_window_seconds: duration, used_percent: used, reset_at: reset } = window.data;
      const name =
        duration === 18000 ? 'five_hour' : duration === 604800 ? 'seven_day' : `codex_${duration}`;
      if (!windows.has(name))
        windows.set(name, {
          name,
          utilization: used / 100,
          observedAt: now,
          resetsAt: reset == null ? null : reset * 1000,
        });
    }
    return [...windows.values()];
  } catch {
    return [];
  }
}
