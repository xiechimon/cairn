// provider record——02 §6.2（r3 §2 实测原样，key 打码）。
// 密钥纪律（02 §8）：apiKey 只写不读，GET 永不返回——record schema 刻意不含
// apiKey 字段。presets 38 项目录照抄 r3 §2 清单（与 pi-ai provider 集合同源
// [推断]）；内置 built-in 模型走 Pro，不在复刻范围（02 §2.4 排除项）。

import { z } from 'zod';
import { epochMs, recordId } from './common.js';

/** 自定义端点三协议（02 §6.2：OpenAI Completions / OpenAI Responses /
 * Anthropic Messages）。wire 值 `anthropic-messages` 为 r3 §2 实测；
 * 另两值按同形逆推 [推断]，可改判。 */
export const providerApiSchema = z.enum([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
]);
export type ProviderApi = z.infer<typeof providerApiSchema>;

/** custom 端点模型价格声明（#927）：USD / 1M tokens（pi 目录价语义，pi-ai
 * ModelCostRates 同形——不含 tiers，档位价留给 pi 内建目录）。写入 models.json
 * 条目后由 pi calculateCost 算 per-message cost——宿主不自造价格表、不重算；
 * 缺省 = 零价（该端点 cost 恒 0，如实反映「无价格来源」）。 */
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
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

/** custom provider 兼容旋钮（#654，B-C2c 面）：pi models.json provider 级
 * compat 的记录投影。缺省位 = pi 按端点探测的默认行为（对未知自定义端点
 * 即现代字段形：max_completion_tokens + store），显式设置才覆盖——三种网关
 * 兼容坑的落点：token 上限字段名、store 字段、system/developer 角色。 */
export const providerCompatSchema = z.object({
  /** 系统提示词走 developer 角色的支持位（r3 §2 表单实测；false = 用
   * system 角色发）。 */
  supportsDeveloperRole: z.boolean().optional(),
  /** token 上限字段名：现代 `max_completion_tokens` / 旧式 `max_tokens`。
   * 部分网关通道拒现代字段（#654 实测：relay 确定性 400「Model does not
   * support this protocol」，同形重试恒败）。 */
  maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
  /** 是否发送 OpenAI `store` 字段（pi 探测默认对未知端点发 `store:false`）。
   * 部分网关通道拒该字段（#654 同上）。 */
  supportsStore: z.boolean().optional(),
});
export type ProviderCompat = z.infer<typeof providerCompatSchema>;

/** custom provider 记录（r3 §2 GET /api/teams/{id}/providers 实测原样）。 */
export const providerRecordSchema = z.object({
  kind: z.literal('custom'),
  providerId: z.string(), // 服务商 ID（表单 ph `例如 my-relay`，r3 §2）
  label: z.string(),
  baseUrl: z.string(), // 表单 ph `https://api.example.com/v1`（r3 §2）
  api: providerApiSchema,
  /** 「以 Authorization: Bearer 请求头发送 API 密钥」复选（r3 §2/§6.2）。 */
  authHeader: z.boolean(),
  compat: providerCompatSchema,
  models: z.array(providerModelSchema), // `探测模型` 对 /v1/models 拉列表（r3 §2）
  id: recordId,
  createdBy: recordId,
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type ProviderRecord = z.infer<typeof providerRecordSchema>;

/** POST /api/teams/{id}/providers body [推断]（r3 §2 表单实测字段投影，
 * wire 未采）：record 可写面 + apiKey 只写位（02 §8；null = 清除——「凭证
 * 只写不读：可以替换或删除」r2 §6.5）。 */
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

/** PATCH /api/teams/{id}/providers/{pid} body = create 全字段可选（05 §6.6
 * 随行项：与 POST 同族上收，#230）。 */
export const patchProviderBodySchema = createProviderBodySchema.partial();
export type PatchProviderBody = z.infer<typeof patchProviderBodySchema>;

/** presets 目录 38 项（r3 §2 盘点序：oauth 2 + xai 双通道 1 + api_key 35）。 */
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

/** `auth:"oauth"` 仅此二项（= ChatGPT/Codex 与 Copilot 订阅连接，r3 §2；
 * 04 §4 M6 真人一次项：OAuth 连自有订阅）。这是上游类型真值；本 server
 * 实际接线的族 = OAUTH_FAMILIES（现仅 github-copilot）——picker 徽标与
 * authorize 点击只给族表成员，表外成员渲染未接线态（#385）。 */
export const PROVIDER_OAUTH_PRESET_IDS = ['github-copilot', 'openai-codex'] as const;

/** xai 双通道（r3 §2：auth:"api_key" + oauthLabel 原文）。 */
export const PROVIDER_XAI_PRESET = {
  id: 'xai',
  auth: 'api_key',
  oauthLabel: 'Sign in with SuperGrok or X Premium',
} as const;

/** preset 条目最小形状（r3 §2 观测字段：id/auth/oauthLabel；其余目录字段
 * 未逐一采集 [推断]）。 */
export const providerPresetSchema = z.object({
  id: z.string(),
  auth: z.enum(['api_key', 'oauth']),
  oauthLabel: z.string().optional(),
});
export type ProviderPreset = z.infer<typeof providerPresetSchema>;

/** 表单行为词表（r3 §2 实测）：「无密钥网关可留空」+ Bearer 复选 +
 * `探测模型`（Anthropic 协议亦走 /v1/models）+ `保存前验证` 开关；
 * 表单注 canon「密钥将加密存储，保存后无法再次查看。」（02 §8 文案对齐）。 */
export const PROVIDER_FORM_COPY = {
  apiKeyOptional: '无密钥网关可留空',
  probeModels: '探测模型',
  validateBeforeSave: '保存前验证',
  encryptedNotice: '密钥将加密存储，保存后无法再次查看。',
} as const;

// —— OAuth 握手面（#231，M6 Q2/Q5「任一连通即过」）———————————————————————

/** OAuth 族描述符。#34 锁定订阅四家只通 github-copilot 一族（选型理由：
 * 唯一原生 server-callback 授权码流——anthropic = PKCE + 手工粘码无
 * callback；openai-codex = PKCE + 锁死 localhost:1455 回环口，违背 BYOC
 * 「机器可在他机」拓扑；xai 公开文档最薄）。族不在表 = authorize 404；
 * web 侧表内族才渲染可点授权面（死钮不渲染，#222 律）——picker 对表外
 * OAuth preset 渲染禁用行 + 「暂未开通」注记（#385）。 */
export interface OAuthFamily {
  /** provider 行 providerId（= preset id，PROVIDER_OAUTH_PRESET_IDS 成员）。 */
  presetId: string;
  /** 建行模板 label（品牌名不译）。 */
  providerLabel: string;
  /** 授权页 URL（client_id/redirect_uri/scope/state 由服务端拼装）。 */
  authorizeUrl: string;
  /** token 交换端点（form POST → JSON）。 */
  tokenUrl: string;
  /** 授权 scope 串（GitHub：read:user = 身份面；Copilot 订阅 entitlement
   * 由 GitHub 按账号判，非 scope 门）。 */
  scope: string;
  /** 建行模板 baseUrl [设计]：Copilot API OpenAI 兼容面。 */
  providerBaseUrl: string;
  /** 建行模板 api [设计]（同 baseUrl 注）。 */
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

/** POST /api/teams/{id}/providers/oauth/{preset}/authorize 响应（#231 [设计]：
 * web 拿 URL 后同页签跳转；错误走 {error} 单形状）。 */
export const oauthAuthorizeResponseSchema = z.object({
  authorizationUrl: z.string(),
});
export type OAuthAuthorizeResponse = z.infer<typeof oauthAuthorizeResponseSchema>;
