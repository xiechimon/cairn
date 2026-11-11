import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const mcpTransportSchema = z.enum(['http', 'stdio']);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerRecordSchema = z.object({
  teamId: recordId,
  label: z.string(),
  slug: z.string(),
  transport: mcpTransportSchema,
  url: z.string(),
  hasCredential: z.boolean(),
  credentialKeys: z.array(z.string()),
  createdBy: recordId,
  id: recordId,
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type McpServerRecord = z.infer<typeof mcpServerRecordSchema>;
