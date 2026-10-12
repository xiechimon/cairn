// model-source record（spec 11 §A3/A4 数据契约单源，#356）：providers 页
// runtime tabs 的封套形状。pacman 自身不提供远程模型服务——页面语义 =
// 各 runtime 的模型来源直读：pi 段 = 用户配置的 custom provider 的
// models[] 投影；claude-code 段 = 各执行机 daemon 读本机
// ~/.claude/settings.json 经 presence/enroll 上报、server 按机器聚合
// （#707；文件缺失/解析失败 → installed:false，不空报不崩）。
//
// #1050 起 claude-code 段另带两个可用性事实位（`bin` / `auth`）：`installed`
// 只说「配置文件在」，说不了「二进制在不在、什么版本、登没登」——两个方向
// 都曾是说谎的（配置在而二进制缺失 → 假绿；装好了没写配置 → 假红）。

import { z } from 'zod';

/** runtime 词表（providers tablist 的 data-runtime 值；machine
 *  enabledRuntimes PATCH 词表同源，spec 11 数据契约）。 */
export const MODEL_SOURCE_RUNTIMES = ['pi', 'claude-code'] as const;
export const modelSourceRuntimeSchema = z.enum(MODEL_SOURCE_RUNTIMES);
export type ModelSourceRuntime = z.infer<typeof modelSourceRuntimeSchema>;

/** runtime 显示名（品牌/runtime 名不译，不走 i18n）——单源：web
 * RUNTIME_LABELS（providers 页 tablist + toModelOptions 投影）与 server
 * chief models 工具（#627，providerLabel 行语义对齐 toModelOptions）共消费；
 * Codex 等后续 runtime 扩在此补（spec 11 §A1），两侧自动同更。 */
export const MODEL_SOURCE_RUNTIME_LABELS: Record<ModelSourceRuntime, string> = {
  pi: 'pi',
  'claude-code': 'Claude Code',
};

export const modelSourceModelSchema = z.object({
  /** 模型 id（pi = custom provider models[] 的 id；claude-code = settings.json
   *  槽值原样）。 */
  id: z.string().min(1),
  /** 显示名（pi = models[] 的 name；claude-code = 模型 id 原样）。 */
  name: z.string().min(1),
  /** 槽位名（claude-code：default / opus / sonnet / …，env.ANTHROPIC_*_MODEL
   *  中段小写化；pi 段缺省）。 */
  slot: z.string().optional(),
});
export type ModelSourceModel = z.infer<typeof modelSourceModelSchema>;

/** claude 二进制事实（#1050）：`path` 必填——有 path 就是「这台机器装了」的
 *  判据（探测侧只在校验通过时产出行）；`version: null` = 二进制在但输出里
 *  没有版本号（wrapper 打了别的东西），版本是信息位不是判据。 */
export const claudeBinInfoSchema = z.object({
  path: z.string().min(1),
  version: z.string().nullable(),
});
export type ClaudeBinInfoWire = z.infer<typeof claudeBinInfoSchema>;

/** 机器本地凭据态（#1050）：取自 `claude auth status` 预检三态
 *  （claude-code-auth.ts）。`unknown` = 探针说不清（CLI 缺失/超时/输出不可
 *  解析），不是「未登录」——UI 只在明确 not-logged-in 时出角标。 */
export const claudeAuthStateSchema = z.object({
  state: z.enum(['logged-in', 'not-logged-in', 'unknown']),
  method: z.string().optional(),
  provider: z.string().optional(),
  reason: z.string().optional(),
});
export type ClaudeAuthStateWire = z.infer<typeof claudeAuthStateSchema>;

export const modelSourceSchema = z.object({
  runtime: modelSourceRuntimeSchema,
  /** claude-code：上报机器的 settings.json 存在且解析为对象；pi 恒 true
   *  （server 在跑 = pacman 自有 runtime 可用）。**不是**「二进制装了」的
   *  判据——那是 `bin`（#1050）。 */
  installed: z.boolean(),
  /** 上报机器的 hostname（os.hostname()）——「已安装在 <hostname>」文案源。
   *  #707 起跟随执行机，不再是 server 主机。 */
  hostname: z.string(),
  /** #1259 归属机维：该段来自哪台机器（machine id）——创建 agent 三级
   *  级联按它过滤模型清单。pi 段缺席（server 侧目录，机器无关）。 */
  machineId: z.string().optional(),
  models: z.array(modelSourceModelSchema),
  /** claude 二进制事实（#1050）。三态，别压平：
   *  - 对象 = 探到了（path + version）；
   *  - `null` = **探过了、没有**（PATH 上没有 / 不可执行 / 超时）——这是
   *    「配置文件在而二进制缺失」那条假绿的判据，页面对它说「未安装」；
   *  - 缺席 = 没探过（老 daemon 未上报），UI 闭嘴（不写「未知」）。 */
  bin: claudeBinInfoSchema.nullable().optional(),
  /** 机器本地凭据态（#1050）：由步内预检回填，随节拍上行；缺席同 bin。 */
  auth: claudeAuthStateSchema.optional(),
});
export type ModelSource = z.infer<typeof modelSourceSchema>;

/** GET /api/teams/{id}/model-sources 封套（pi 一段 + 每台已上报机器一段
 *  claude-code，#707；上报过的机器按 hostname 排序，序固定）。 */
export const modelSourcesEnvelopeSchema = z.object({
  sources: z.array(modelSourceSchema),
});
export type ModelSourcesEnvelope = z.infer<typeof modelSourcesEnvelopeSchema>;

/** claude-code 槽位键模式：env.ANTHROPIC_<SLOT>_MODEL。ANTHROPIC_MODEL
 *  本体无中段（`ANTHROPIC_` 与 `_MODEL` 之间需至少一段）天然不命中，
 *  不会与顶层 model 的 default 槽撞名。 */
export const CLAUDE_MODEL_SLOT_PATTERN = /^ANTHROPIC_([A-Z0-9_]+)_MODEL$/;

/** settings.json 原文 → claude-code 段（#707 纯函数：server 与 daemon 共吃——
 *  谁读谁机器的文件，不存在「server 远程读执行机文件」的通道）。
 *  文件缺失 / 非法 JSON / 非对象 JSON 一律 installed:false，不空报不崩。
 *  槽值非字符串或空串的项跳过（installed 仍为 true）。 */
export function parseClaudeCodeModelSource(raw: unknown, hostname: string): ModelSource {
  const notInstalled: ModelSource = {
    runtime: 'claude-code',
    installed: false,
    hostname,
    models: [],
  };
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return notInstalled;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return notInstalled;
  }
  const settings = parsed as { model?: unknown; env?: unknown };
  const models: ModelSourceModel[] = [];
  if (typeof settings.model === 'string' && settings.model !== '') {
    models.push({ id: settings.model, name: settings.model, slot: 'default' });
  }
  const env = settings.env;
  if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env)) {
      const match = CLAUDE_MODEL_SLOT_PATTERN.exec(key);
      const slot = match?.[1];
      if (slot === undefined || typeof value !== 'string' || value === '') continue;
      models.push({ id: value, name: value, slot: slot.toLowerCase().replace(/_/g, '-') });
    }
  }
  return { runtime: 'claude-code', installed: true, hostname, models };
}

/** daemon → server 上报载荷（presence / enroll body 的 claudeCode 位，#707）：
 *  本机 settings.json 的解析结果 + 本机 hostname。缺席 = 旧 daemon 未上报
 *  （server 视为未知，不下发假清单）。`bin`/`auth` 为 #1050 增量，均可选——
 *  加字段不加迁移（json 列），双向兼容：新 daemon→老 server 的未知键被 zod
 *  剥掉（两个 body schema 均非 strict），老 daemon→新 server 则缺席。 */
export const claudeCodeReportSchema = z.object({
  installed: z.boolean(),
  hostname: z.string(),
  models: z.array(modelSourceModelSchema),
  bin: claudeBinInfoSchema.nullable().optional(),
  auth: claudeAuthStateSchema.optional(),
});
export type ClaudeCodeReport = z.infer<typeof claudeCodeReportSchema>;

/** provider+modelId 值对（model id 只在 provider 内有意义——裸串跨
 *  provider 撞名，对象形是 wire/存储两面的唯一合法形）。 */
export const modelRefSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
});
export type ModelRef = z.infer<typeof modelRefSchema>;
