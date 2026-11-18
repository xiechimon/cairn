import { z } from 'zod';
import { mcpConnectorRecordSchema } from './mcp-connector.js';

export const COMPOSIO_API_KEY_SECRET = 'composio.api-key';
export const COMPOSIO_CATALOG_ID = 'composio';

export const composioToolkitSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, 'toolkit slug is lowercase letters, digits, - and _')
  .refine((slug) => !slug.includes('__'), 'toolkit slug cannot hold a double underscore');

export const composioKeyBodySchema = z.strictObject({
  key: z
    .string()
    .trim()
    .min(1, 'the Composio key is empty')
    .max(256, 'the Composio key is too long')
    .regex(/^[^\p{Cc}]+$/u, 'the Composio key holds a control character'),
});
export type ComposioKeyBody = z.infer<typeof composioKeyBodySchema>;

export const composioConfiguredSchema = z.strictObject({ configured: z.boolean() });
export type ComposioConfigured = z.infer<typeof composioConfiguredSchema>;

export const composioAppEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  noAuth: z.boolean(),
  toolsCount: z.number().int().nullable(),
  connector: mcpConnectorRecordSchema.nullable(),
});
export type ComposioAppEntry = z.infer<typeof composioAppEntrySchema>;

export const composioAppsSchema = z.object({
  configured: z.boolean(),
  apps: z.array(composioAppEntrySchema),
});
export type ComposioApps = z.infer<typeof composioAppsSchema>;

export const composioConnectBodySchema = z.strictObject({ slug: composioToolkitSlugSchema });
export type ComposioConnectBody = z.infer<typeof composioConnectBodySchema>;

export const composioAuthorizeResponseSchema = z.object({
  redirectUrl: z.string().nullable(),
  connector: mcpConnectorRecordSchema,
});
export type ComposioAuthorizeResponse = z.infer<typeof composioAuthorizeResponseSchema>;
