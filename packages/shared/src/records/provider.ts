import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const providerApiSchema = z.enum([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
]);
export type ProviderApi = z.infer<typeof providerApiSchema>;

export const modelCostRatesSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
});
export type ModelCostRates = z.infer<typeof modelCostRatesSchema>;

export const providerModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  cost: modelCostRatesSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  input: z
    .array(z.enum(['text', 'image']))
    .min(1)
    .optional(),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

export const providerCompatSchema = z.object({
  supportsDeveloperRole: z.boolean().optional(),
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  supportsStore: z.boolean().optional(),
});
export type ProviderCompat = z.infer<typeof providerCompatSchema>;

export const providerRecordSchema = z.object({
  kind: z.literal('custom'),
  providerId: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  api: providerApiSchema,
  authHeader: z.boolean(),
  compat: providerCompatSchema,
  models: z.array(providerModelSchema),
  id: recordId,
  createdBy: recordId,
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type ProviderRecord = z.infer<typeof providerRecordSchema>;

export const createProviderBodySchema = z.object({
  providerId: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  api: providerApiSchema,
  authHeader: z.boolean().optional(),
  compat: providerCompatSchema.optional(),
  models: z.array(providerModelSchema).optional(),
  apiKey: z.string().nullish(),
});
export type CreateProviderBody = z.infer<typeof createProviderBodySchema>;

export const patchProviderBodySchema = createProviderBodySchema.partial();
export type PatchProviderBody = z.infer<typeof patchProviderBodySchema>;

export const PROVIDER_PRESET_IDS = [
  'github-copilot',
  'openai-codex',
  'xai',
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'together',
  'vercel-ai-gateway',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'z-ai',
  'z-ai-coding-cn',
] as const;

export const PROVIDER_OAUTH_PRESET_IDS = ['github-copilot', 'openai-codex'] as const;

export const PROVIDER_XAI_PRESET = {
  id: 'xai',
  auth: 'api_key',
  oauthLabel: 'Sign in with SuperGrok or X Premium',
} as const;

export const providerPresetSchema = z.object({
  id: z.string(),
  auth: z.enum(['api_key', 'oauth']),
  oauthLabel: z.string().optional(),
});
export type ProviderPreset = z.infer<typeof providerPresetSchema>;

export const PROVIDER_FORM_COPY = {
  apiKeyOptional: '无密钥网关可留空',
  probeModels: '探测模型',
  validateBeforeSave: '保存前验证',
  encryptedNotice: '密钥将加密存储，保存后无法再次查看。',
} as const;

export interface OAuthFamily {
  presetId: string;
  providerLabel: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  providerBaseUrl: string;
  providerApi: ProviderApi;
}

export const OAUTH_FAMILIES: readonly OAuthFamily[] = [
  {
    presetId: 'github-copilot',
    providerLabel: 'GitHub Copilot',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user',
    providerBaseUrl: 'https://api.githubcopilot.com',
    providerApi: 'openai-completions',
  },
];

export const oauthAuthorizeResponseSchema = z.object({
  authorizationUrl: z.string(),
});
export type OAuthAuthorizeResponse = z.infer<typeof oauthAuthorizeResponseSchema>;
