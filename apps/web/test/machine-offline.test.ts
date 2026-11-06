import { describe, expect, it } from 'vitest';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';
import { offlineGuidance } from '../src/resources/machine-offline.js';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const tZh = (source: string, vars?: Record<string, string | number>) =>
  translate('zh', {}, source, vars);
const tEn = (source: string, vars?: Record<string, string | number>) =>
  translate('en', EN, source, vars);

describe('offlineGuidance', () => {
  it('says nothing for an online machine', () => {
    expect(offlineGuidance({ online: true, lastSeenAt: NOW }, NOW, 'cairn start', tZh)).toBeNull();
  });

  it('gives the last-seen time and the recovery command when offline', () => {
    const guidance = offlineGuidance(
      { online: false, lastSeenAt: NOW - 3 * 3_600_000 },
      NOW,
      'cairn start',
      tZh,
    );
    expect(guidance?.lastSeen).toBe('最后在线 3 小时前');
    expect(guidance?.recovery).toContain('`cairn start`');
  });

  it('omits last-seen when the machine never reported', () => {
    expect(offlineGuidance({ online: false, lastSeenAt: null }, NOW, 'cairn start', tZh)?.lastSeen)
      .toBeNull();
  });

  it('has English copy for both lines', () => {
    const guidance = offlineGuidance(
      { online: false, lastSeenAt: NOW - 3_600_000 },
      NOW,
      'cairn start',
      tEn,
    );
    expect(guidance?.lastSeen).toMatch(/^Last seen /);
    expect(guidance?.recovery).toMatch(/`cairn start`/);
    expect(guidance?.recovery).not.toMatch(/[一-鿿]/);
  });
});
