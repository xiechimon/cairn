import { z } from 'zod';
import { COMPUTER_STATES } from './computer.js';

export const COMPUTER_PRESENCE_LIMIT = 250;
export const computerPresenceSchema = z.object({
  scopeKey: z.string().min(1).max(256),
  providerRef: z.string().min(1).max(256),
  state: z.enum(COMPUTER_STATES),
});
export type ComputerPresence = z.infer<typeof computerPresenceSchema>;

export const computerPresenceListSchema = z
  .array(computerPresenceSchema)
  .max(COMPUTER_PRESENCE_LIMIT)
  .refine(
    (reports) => new Set(reports.map((report) => report.scopeKey)).size === reports.length,
    'Computer scopes must be unique',
  );
