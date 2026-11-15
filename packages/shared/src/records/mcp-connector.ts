import { z } from 'zod';
import { epochMs, recordId } from './common.js';
import { isSecretHeaderName } from './secret.js';

export type McpConnectorAuth = 'none' | 'token' | 'oauth';

export interface McpCatalogOption {
  id: string;
  label: string;
  kind: 'header' | 'query';
  name: string;
  input: 'flag' | 'text';
}

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  docsUrl: string;
  auth: readonly McpConnectorAuth[];
  tokenLabel?: string;
  tokenHelpUrl?: string;
  options: readonly McpCatalogOption[];
}

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: '仓库、Issue、Pull Request 与 Actions',
    url: 'https://api.githubcopilot.com/mcp/',
    docsUrl: 'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
    auth: ['token'],
    tokenLabel: '个人访问令牌',
    tokenHelpUrl: 'https://github.com/settings/personal-access-tokens/new',
    options: [
      { id: 'readonly', label: '只读', kind: 'header', name: 'X-MCP-Readonly', input: 'flag' },
      { id: 'toolsets', label: '工具集', kind: 'header', name: 'X-MCP-Toolsets', input: 'text' },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Workers、DNS、R2 等 Cloudflare API',
    url: 'https://mcp.cloudflare.com/mcp',
    docsUrl: 'https://github.com/cloudflare/mcp',
    auth: ['oauth', 'token'],
    tokenLabel: 'API 令牌',
    tokenHelpUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    options: [],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue、项目与周期',
    url: 'https://mcp.linear.app/mcp',
    docsUrl: 'https://linear.app/docs/mcp',
    auth: ['oauth', 'token'],
    tokenLabel: 'API 密钥',
    tokenHelpUrl: 'https://linear.app/settings/account/security',
    options: [],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: '页面与数据库',
    url: 'https://mcp.notion.com/mcp',
    docsUrl: 'https://developers.notion.com/docs/get-started-with-mcp',
    auth: ['oauth'],
    options: [],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: '错误与性能问题（测试版）',
    url: 'https://mcp.sentry.dev/mcp',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    auth: ['oauth'],
    options: [],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: '数据库、函数与项目管理（测试版）',
    url: 'https://mcp.supabase.com/mcp',
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
    auth: ['oauth', 'token'],
    tokenLabel: '个人访问令牌',
    tokenHelpUrl: 'https://supabase.com/dashboard/account/tokens',
    options: [
      { id: 'project', label: '项目 ref', kind: 'query', name: 'project_ref', input: 'text' },
      { id: 'readonly', label: '只读', kind: 'query', name: 'read_only', input: 'flag' },
    ],
  },
  {
    id: 'context7',
    name: 'Context7',
    description: '最新的库文档与代码示例',
    url: 'https://mcp.context7.com/mcp',
    docsUrl: 'https://github.com/upstash/context7',
    auth: ['none', 'token'],
    tokenLabel: 'API 密钥',
    tokenHelpUrl: 'https://context7.com/dashboard',
    options: [],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: '模型、数据集与 Spaces',
    url: 'https://huggingface.co/mcp',
    docsUrl: 'https://github.com/huggingface/hf-mcp-server',
    auth: ['none', 'oauth', 'token'],
    tokenLabel: '访问令牌',
    tokenHelpUrl: 'https://huggingface.co/settings/tokens',
    options: [],
  },
];

export function mcpCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}

export const MCP_RESERVED_SLUGS: readonly string[] = ['cairn'];

export const mcpConnectorSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'slug is lowercase letters, digits and dashes, at most 40')
  .refine((slug) => !MCP_RESERVED_SLUGS.includes(slug), 'slug is reserved');

const headerValue = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\p{Cc}]*$/u, 'no control characters');

const connectorHeadersSchema = z
  .record(z.string().refine(isSecretHeaderName, 'header name is not allowed'), headerValue)
  .refine((headers) => Object.keys(headers).length <= 20, 'at most 20 headers');

export const mcpConnectorUrlSchema = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '';
}, 'url must be https without credentials or fragment');

export const MCP_CONNECTOR_STATUSES = ['unchecked', 'connected', 'needs_auth', 'error'] as const;
export const mcpConnectorStatusSchema = z.enum(MCP_CONNECTOR_STATUSES);
export type McpConnectorStatus = z.infer<typeof mcpConnectorStatusSchema>;

export const MCP_CONNECTOR_AUTH_KINDS = ['none', 'static', 'oauth'] as const;
export const mcpConnectorAuthKindSchema = z.enum(MCP_CONNECTOR_AUTH_KINDS);
export type McpConnectorAuthKind = z.infer<typeof mcpConnectorAuthKindSchema>;

export interface McpConnectorOAuthMeta {
  issuer: string;
  authorizationServerUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  tokenAuthMethods: string[];
  resource: string;
  redirectUri: string;
  scope: string | null;
}

export const mcpConnectorRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  slug: z.string(),
  label: z.string(),
  catalogId: z.string().nullable(),
  url: z.string(),
  headerNames: z.array(z.string()),
  authKind: mcpConnectorAuthKindSchema,
  status: mcpConnectorStatusSchema,
  statusReason: z.string().nullable(),
  toolCount: z.number().int().nullable(),
  checkedAt: epochMs.nullable(),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type McpConnectorRecord = z.infer<typeof mcpConnectorRecordSchema>;

const catalogOptionsSchema = z.record(
  z.string(),
  z
    .string()
    .max(200)
    .regex(/^[^\p{Cc}]*$/u, 'no control characters'),
);

export const createMcpConnectorBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('catalog'),
    catalogId: z.string(),
    slug: mcpConnectorSlugSchema,
    token: headerValue.optional(),
    options: catalogOptionsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('custom'),
    slug: mcpConnectorSlugSchema,
    label: z.string().trim().min(1).max(80),
    url: mcpConnectorUrlSchema,
    headers: connectorHeadersSchema.optional(),
  }),
]);
export type CreateMcpConnectorBody = z.infer<typeof createMcpConnectorBodySchema>;

export const patchMcpConnectorBodySchema = z
  .strictObject({
    label: z.string().trim().min(1).max(80).optional(),
    token: headerValue.optional(),
    options: catalogOptionsSchema.optional(),
    url: mcpConnectorUrlSchema.optional(),
    headers: connectorHeadersSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
export type PatchMcpConnectorBody = z.infer<typeof patchMcpConnectorBodySchema>;

export const startMcpConnectorOAuthBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('catalog'),
    catalogId: z.string(),
    slug: mcpConnectorSlugSchema,
    options: catalogOptionsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('custom'),
    slug: mcpConnectorSlugSchema,
    label: z.string().trim().min(1).max(80),
    url: mcpConnectorUrlSchema,
  }),
  z.strictObject({
    kind: z.literal('reconnect'),
    connectorId: recordId,
  }),
]);
export type StartMcpConnectorOAuthBody = z.infer<typeof startMcpConnectorOAuthBodySchema>;

export const startMcpConnectorOAuthResponseSchema = z.object({ authorizationUrl: z.string() });
