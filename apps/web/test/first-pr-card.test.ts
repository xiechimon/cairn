import { describe, expect, it } from 'vitest';
import { firstPrBodyCopy, firstPrCardInfo } from '../src/board/first-pr-card.js';

const PROMPT = {
  enabled: true,
  due: true,
  dismissedAt: null,
  firstPrAt: 4 * 86_400_000,
  firstPrNumber: 7,
};

describe('the first-PR card', () => {
  it('is hidden while the setting is off', () => {
    expect(firstPrCardInfo({ ...PROMPT, enabled: false }, 0)).toBeNull();
  });

  it('is hidden before a first pull request is recorded', () => {
    expect(
      firstPrCardInfo({ ...PROMPT, due: false, firstPrAt: null, firstPrNumber: null }, 0),
    ).toBeNull();
  });

  it('is hidden once dismissed', () => {
    expect(firstPrCardInfo({ ...PROMPT, dismissedAt: 5 }, 0)).toBeNull();
  });

  it('is shown while enabled, due and not dismissed', () => {
    expect(firstPrCardInfo(PROMPT, 0)).not.toBeNull();
  });

  it('links to the new-discussion form with the prefilled title and body', () => {
    const info = firstPrCardInfo(PROMPT, 0);
    const parsed = new URL(info?.href ?? '');
    expect(parsed.pathname).toBe('/xiechimon/cairn/discussions/new');
    expect(parsed.searchParams.get('title')?.length).toBeGreaterThan(0);
    expect(parsed.searchParams.get('body')?.length).toBeGreaterThan(0);
    expect(parsed.searchParams.get('category')).toBe('Q&A');
  });

  it('the link carries no repository name, PR URL, user, machine name or team id', () => {
    const info = firstPrCardInfo(PROMPT, 0);
    const parsed = new URL(info?.href ?? '');
    const payload = [
      parsed.searchParams.get('title'),
      parsed.searchParams.get('body'),
      info?.title,
      info?.body,
    ].join('\n');
    for (const forbidden of ['/pull/', 'team-1', 'macbook', 'secret-repo', 'owner@example.com']) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it('counts whole days from the team creation to the first pull request', () => {
    const info = firstPrCardInfo({ ...PROMPT, firstPrAt: 3.9 * 86_400_000 }, 0);
    expect(info?.daysToFirstPr).toBe(3);
    expect(new URL(info?.href ?? '').searchParams.get('body')).toContain('3 days');
  });

  it('omits the day count when the first pull request predates the team record', () => {
    const info = firstPrCardInfo({ ...PROMPT, firstPrAt: 0 }, 1_000);
    expect(info?.daysToFirstPr).toBeNull();
    expect(new URL(info?.href ?? '').searchParams.get('body')).not.toContain('days');
  });
});

describe('the first-PR card body', () => {
  const t = (source: string, vars?: Record<string, string | number>) =>
    source.replace(/\{(\w+)\}/g, (_, key: string) => String(vars?.[key] ?? ''));

  it('never says the first PR took 0 days', () => {
    expect(firstPrBodyCopy(0, t)).not.toMatch(/0 天/);
    expect(firstPrBodyCopy(0, t)).toContain('当天');
  });

  it('states the day count from one day up', () => {
    expect(firstPrBodyCopy(4, t)).toContain('4 天');
  });

  it('omits the duration when the time is unknown', () => {
    expect(firstPrBodyCopy(null, t)).not.toMatch(/\d/);
  });
});
