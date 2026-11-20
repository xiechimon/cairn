import { z } from 'zod';

export const PROVIDER_ORDER_MAX = 500;

const providerKeySchema = z
  .string()
  .max(200)
  .regex(/^(subscription|provider):[^\s]+$/);

export const providerOrderBodySchema = z.object({
  order: z
    .array(providerKeySchema)
    .max(PROVIDER_ORDER_MAX)
    .refine((keys) => new Set(keys).size === keys.length, 'duplicate provider key'),
});

export type ProviderOrderBody = z.infer<typeof providerOrderBodySchema>;

export function orderByKeys<T>(
  items: readonly T[],
  keysOf: (item: T) => readonly string[],
  order: readonly string[] | null | undefined,
): T[] {
  if (order === null || order === undefined || order.length === 0) return [...items];
  const rank = new Map(order.map((key, index) => [key, index]));
  const rankOf = (item: T) =>
    Math.min(...keysOf(item).map((key) => rank.get(key) ?? Number.POSITIVE_INFINITY));
  return items
    .map((item, index) => ({ item, index, rank: rankOf(item) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map(({ item }) => item);
}
