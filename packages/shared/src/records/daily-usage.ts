import { z } from 'zod';

export const DAILY_USAGE_MAX_DAYS = 371;

export const dailyUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(DAILY_USAGE_MAX_DAYS),
  tz: z.string().min(1),
});

const tokens = z.number().int().nonnegative();

export const dailyUsageDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coordinator: tokens,
  tasks: tokens,
  input: tokens,
  output: tokens,
  cacheRead: tokens,
  cacheWrite: tokens,
  models: z.record(z.string(), tokens),
  projects: z.record(z.string(), tokens),
  todos: z.array(z.string()),
  cost: z.number().nonnegative().nullable(),
});
export type DailyUsageDay = z.infer<typeof dailyUsageDaySchema>;

export const dailyUsageModelSchema = z.object({
  key: z.string(),
  name: z.string(),
  provider: z.string(),
});
export type DailyUsageModel = z.infer<typeof dailyUsageModelSchema>;

export const dailyUsageSchema = z.object({
  days: z.array(dailyUsageDaySchema),
  models: z.array(dailyUsageModelSchema),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type DailyUsage = z.infer<typeof dailyUsageSchema>;
