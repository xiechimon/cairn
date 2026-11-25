import type { PairingRequestView } from '@cairn/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test, vi } from 'vitest';
import {
  applyOptimisticPairDecision,
  restoreOptimisticPairDecision,
} from '../src/api/hooks.js';
import { pairRequestSourceLabel } from '../src/overlay/pairing-request-banner.js';

const PENDING: PairingRequestView[] = [
  {
    id: 'req-1',
    code: 'ABCD1234',
    name: 'Browser',
    detail: 'Chrome 156',
    source: 'tailnet',
    createdAt: 1000,
    expiresAt: 301000,
  },
  {
    id: 'req-2',
    code: 'WXYZ5678',
    name: 'Browser',
    detail: 'Chrome 158',
    source: 'public',
    createdAt: 2000,
    expiresAt: 302000,
  },
];

describe('pairing request banner helpers', () => {
  test('optimistically removes decided pairing request in the same frame and rolls back on failure', () => {
    const qc = new QueryClient();
    qc.setQueryData(['pairingRequests'], PENDING);

    const snapshot = applyOptimisticPairDecision(qc, 'req-1');
    expect(qc.getQueryData<PairingRequestView[]>(['pairingRequests'])?.map((r) => r.id)).toEqual([
      'req-2',
    ]);

    restoreOptimisticPairDecision(qc, snapshot);
    expect(qc.getQueryData<PairingRequestView[]>(['pairingRequests'])?.map((r) => r.id)).toEqual([
      'req-1',
      'req-2',
    ]);
  });

  test('maps pairing request source to localized label instead of raw enum', () => {
    const t = vi.fn((key: string) => key);
    expect(pairRequestSourceLabel('loopback', t)).toBe('这台电脑');
    expect(pairRequestSourceLabel('lan', t)).toBe('局域网');
    expect(pairRequestSourceLabel('tailnet', t)).toBe('Tailscale');
    expect(pairRequestSourceLabel('public', t)).toBe('外部网络');
    expect(pairRequestSourceLabel('unknown', t)).toBe('不明');
  });
});
