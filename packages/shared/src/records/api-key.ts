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

export const API_KEY_ONE_TIME_COPY = '请立即复制密钥，它仅显示一次。';

export function maskApiKey(plaintext: string): string {
  return `${plaintext.slice(0, BRAND.apiKeyPrefix.length + 8)}…`;
}

export const API_KEY_PAGE_COPY = 'API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的看板。';

export const API_KEY_GRANT_SEMANTICS_COPY = [
  "The key's tool selection limits every call: a client cannot invoke a tool it was not granted.",
  'Removing every MCP tool disables MCP for that key, and does not affect machines that hold their own machine token.',
] as const;
