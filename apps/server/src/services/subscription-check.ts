import type { SubscriptionCheck } from '@cairn/shared';
import { nowMs } from '../lib/ids.js';

export async function timedCheck<R extends { ok: boolean; reason?: string }>(
  run: () => Promise<R>,
  meta: Pick<SubscriptionCheck, 'check' | 'command' | 'model'>,
): Promise<R & { check: SubscriptionCheck }> {
  const started = performance.now();
  const result = await run();
  return {
    ...result,
    check: {
      at: nowMs(),
      ok: result.ok,
      reason: result.ok ? null : (result.reason ?? 'failed'),
      ...meta,
      durationMs: Math.round(performance.now() - started),
    },
  };
}
