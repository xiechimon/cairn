import { z } from 'zod';

export const DAILY_USAGE_MAX_DAYS = 371;

export const dailyUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(DAILY_USAGE_MAX_DAYS),
  tz: z.string().min(1),
});

export const dailyUsageDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coordinator: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
});
export type DailyUsageDay = z.infer<typeof dailyUsageDaySchema>;

export const dailyUsageSchema = z.object({ days: z.array(dailyUsageDaySchema) });
export type DailyUsage = z.infer<typeof dailyUsageSchema>;
