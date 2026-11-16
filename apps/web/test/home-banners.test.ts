import { describe, expect, it } from 'vitest';
import { pickHomeBanners } from '../src/board/home-banners.js';

const kinds = (list: { kind: string }[]) => list.map((item) => item.kind);

describe('pickHomeBanners', () => {
  it('shows at most two banners', () => {
    const picked = pickHomeBanners([
      { kind: 'login' as const },
      { kind: 'quota' as const },
      { kind: 'backup' as const },
      { kind: 'notify' as const },
    ]);
    expect(picked).toHaveLength(2);
  });

  it('orders blocking before need-to-know', () => {
    expect(
      kinds(pickHomeBanners([{ kind: 'quota' as const }, { kind: 'backup' as const }])),
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
          { kind: 'notify' as const },
          { kind: 'quota' as const },
          { kind: 'login' as const },
        ]),
      ),
    ).toEqual(['login', 'notify']);
  });
});

describe('pickHomeBanners with login, backup, quota and notifications together', () => {
  it('shows exactly two and keeps the login warning', () => {
    const picked = pickHomeBanners([
      { kind: 'backup' as const },
      { kind: 'quota' as const },
      { kind: 'login' as const },
      { kind: 'notify' as const },
    ]);
    expect(picked).toHaveLength(2);
    expect(kinds(picked)).toContain('login');
  });
});
