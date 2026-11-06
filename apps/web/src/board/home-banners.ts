export type HomeBannerKind = 'backup' | 'login' | 'quota' | 'notify' | 'first-pr';

export const HOME_BANNER_LIMIT = 2;

const RANK: Record<HomeBannerKind, number> = {
  backup: 0,
  login: 0,
  quota: 1,
  notify: 1,
  'first-pr': 2,
};

export function pickHomeBanners<T extends { kind: HomeBannerKind }>(candidates: T[]): T[] {
  return candidates
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.kind] - RANK[b.item.kind] || a.index - b.index)
    .slice(0, HOME_BANNER_LIMIT)
    .map(({ item }) => item);
}
