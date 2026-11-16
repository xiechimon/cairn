import { z } from 'zod';
import { epochMs, recordId } from './common.js';
import { mcpConnectorStatusSchema } from './mcp-connector.js';

export const mcpTransportSchema = z.enum(['http', 'stdio']);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpServerSourceSchema = z.enum(['local', 'connector']);
export type McpServerSource = z.infer<typeof mcpServerSourceSchema>;

export const mcpServerRecordSchema = z.object({
  teamId: recordId,
  label: z.string(),
  slug: z.string(),
  transport: mcpTransportSchema,
  url: z.string(),
  hasCredential: z.boolean(),
  credentialKeys: z.array(z.string()),
  source: mcpServerSourceSchema,
  status: mcpConnectorStatusSchema.nullable(),
  createdBy: recordId,
  id: recordId,
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type McpServerRecord = z.infer<typeof mcpServerRecordSchema>;
