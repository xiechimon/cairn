import type { UsageCost } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { mapUsageCost } from '../src/api/mappers.js';

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

describe('mapUsageCost', () => {
  test('a known free total is $0.00 and an unknown total stays blank', () => {
    expect(mapUsageCost({ ...ZERO, priced: true } as UsageCost)).toEqual({
      total: '$0.00',
      cacheRead: '$0.00',
      input: '$0.00',
      output: '$0.00',
    });
    expect(mapUsageCost({ ...ZERO, priced: false } as UsageCost)).toBeNull();
    expect(mapUsageCost(ZERO)).toBeNull();
  });

  test('a reported total with no split shows the dollars and blanks the parts', () => {
    expect(mapUsageCost({ ...ZERO, total: 0.01 })).toEqual({
      total: '$0.01',
      cacheRead: '—',
      input: '—',
      output: '—',
    });
  });
});
