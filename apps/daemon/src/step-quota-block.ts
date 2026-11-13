import type { ProviderConfig, QuotaBlock } from '@cairn/shared';
import { classifyAgentFailure, parseRetryAfterMs } from '@cairn/shared';
import type { QuotaTrip } from './claude-quota-trip.js';

function quotaBlockOf(
  provider: ProviderConfig | null,
  kind: 'quota' | 'capacity',
  reason: string,
  retryAfterMs: number | null,
): QuotaBlock {
  return {
    kind,
    providerId: provider?.providerId ?? 'unknown',
    ...(provider?.label !== undefined ? { label: provider.label } : {}),
    reason: reason.slice(0, 500),
    ...(retryAfterMs !== null ? { retryAfterMs } : {}),
  };
}

export function stepQuotaBlock(input: {
  provider: ProviderConfig | null;
  quotaTrip: QuotaTrip | null;
  stopped: boolean;
  processCrash: boolean;
  failureText: string | null;
}): QuotaBlock | null {
  const { provider, quotaTrip, failureText } = input;
  if (quotaTrip !== null) {
    return quotaBlockOf(provider, quotaTrip.kind, quotaTrip.reason, quotaTrip.retryAfterMs);
  }
  if (input.stopped || input.processCrash || failureText === null) return null;
  const failureKind = classifyAgentFailure(failureText);
  if (failureKind !== 'quota' && failureKind !== 'capacity') return null;
  return quotaBlockOf(provider, failureKind, failureText, parseRetryAfterMs(failureText));
}
