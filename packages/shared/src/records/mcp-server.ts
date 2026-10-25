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

export const MCP_SLUG_COPY =
  '小写字母标识符，将作为工具名前缀（mcp__<标识符>__<工具>），创建后不可修改。';
