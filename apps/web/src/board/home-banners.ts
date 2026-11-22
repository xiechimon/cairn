export type HomeBannerKind = 'backup' | 'login' | 'autonomy' | 'quota' | 'notify';

export const HOME_BANNER_LIMIT = 2;

const RANK: Record<HomeBannerKind, number> = {
  backup: 0,
  login: 0,
  autonomy: 1,
  quota: 1,
  notify: 1,
};

export function pickHomeBanners<T extends { kind: HomeBannerKind; blocking?: boolean }>(
  candidates: T[],
): T[] {
  return candidates
    .map((item, index) => ({ item, index, rank: item.blocking ? -1 : RANK[item.kind] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, HOME_BANNER_LIMIT)
    .map(({ item }) => item);
}
