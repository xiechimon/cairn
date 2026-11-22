import { describe, expect, it } from 'vitest';
import { SETTINGS_ROW_INDEX } from '../src/settings/settings-index.js';

describe('C30 settings information density', () => {
  it('every settings section built from rows carries at least three of them', () => {
    const counts = new Map<string, number>();
    for (const row of SETTINGS_ROW_INDEX) counts.set(row.section, (counts.get(row.section) ?? 0) + 1);
    const thin = [...counts].filter(([, count]) => count < 3).map(([section, count]) => `${section}: ${count}`);
    expect(thin).toEqual([]);
  });
});
