import { z } from 'zod';
import { epochMs } from './common.js';

export const SNOOZE_MODES = ['needed', 'until'] as const;
export const snoozeModeSchema = z.enum(SNOOZE_MODES);
export type SnoozeMode = z.infer<typeof snoozeModeSchema>;

export const SNOOZE_PRESETS = ['needed', 'tomorrow', 'tomorrow-09:00', 'next-monday'] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_EVENTS = [
  'user-message',
  'scheduled-run-finished',
  'schedule-cleared',
  'needs-you',
  'github-event',
  'tool-call',
] as const;
export type SnoozeEvent = (typeof SNOOZE_EVENTS)[number];

export const SNOOZE_EVENT_ENDS_SNOOZE: Record<SnoozeEvent, boolean> = {
  'user-message': true,
  'scheduled-run-finished': true,
  'schedule-cleared': true,
  'needs-you': true,
  'github-event': false,
  'tool-call': false,
};

export const snoozeUntilSchema = z.union([
  z.enum(SNOOZE_PRESETS),
  epochMs,
  z.string().datetime({ offset: true }),
]);
export type SnoozeUntil = z.infer<typeof snoozeUntilSchema>;

export const snoozeTodoBodySchema = z.object({
  until: snoozeUntilSchema,
  tz: z.string().min(1).optional(),
});
export type SnoozeTodoBody = z.infer<typeof snoozeTodoBodySchema>;
