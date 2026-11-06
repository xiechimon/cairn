import { describe, expect, it } from 'vitest';
import { pickHomeBanners } from '../src/board/home-banners.js';

const kinds = (list: { kind: string }[]) => list.map((item) => item.kind);

describe('pickHomeBanners', () => {
  it('shows at most two banners', () => {
    const picked = pickHomeBanners([
      { kind: 'first-pr' as const },
      { kind: 'quota' as const },
      { kind: 'backup' as const },
      { kind: 'notify' as const },
    ]);
    expect(picked).toHaveLength(2);
  });

  it('orders blocking before need-to-know before celebration', () => {
    expect(
      kinds(pickHomeBanners([{ kind: 'first-pr' as const }, { kind: 'quota' as const }])),
    ).toEqual(['quota', 'first-pr']);
    expect(
      kinds(pickHomeBanners([{ kind: 'quota' as const }, { kind: 'backup' as const }])),
    ).toEqual(['backup', 'quota']);
  });

  it('never lets the first-PR card push out a need-to-know banner', () => {
    expect(
      kinds(
        pickHomeBanners([
          { kind: 'first-pr' as const },
          { kind: 'backup' as const },
          { kind: 'quota' as const },
        ]),
      ),
    ).toEqual(['backup', 'quota']);
  });

  it('keeps input order inside a rank and handles an empty list', () => {
    expect(
      kinds(pickHomeBanners([{ kind: 'notify' as const }, { kind: 'quota' as const }])),
    ).toEqual(['notify', 'quota']);
    expect(pickHomeBanners([])).toEqual([]);
  });
});

describe('pickHomeBanners with the Claude login warning', () => {
  it('counts the login warning against the limit and ranks it as blocking', () => {
    expect(
      kinds(
        pickHomeBanners([
          { kind: 'first-pr' as const },
          { kind: 'quota' as const },
          { kind: 'login' as const },
        ]),
      ),
    ).toEqual(['login', 'quota']);
  });
});
