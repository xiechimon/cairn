import { z } from 'zod';
import { BRAND } from '../brand.js';
import { epochMs, recordId } from './common.js';

export const apiKeyRecordSchema = z.object({
  name: z.string().nullable(),
  gitAccess: z.boolean(),
  mcpAccess: z.boolean(),
  machineAccess: z.boolean().default(false),
  toolGrants: z.object({
    read: z.array(z.string()),
    write: z.array(z.string()),
  }),
});
export type ApiKeyRecord = z.infer<typeof apiKeyRecordSchema>;

export const apiKeyRowSchema = apiKeyRecordSchema.extend({
  id: recordId,
  masked: z.string(),
  createdAt: epochMs,
});
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

export function maskApiKey(plaintext: string): string {
  return `${plaintext.slice(0, BRAND.apiKeyPrefix.length + 8)}…`;
}
