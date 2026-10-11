// AgentBackend 缝——01 §5 签名（00/D1 移交项闭环，锁定形状、实现期可精化字段）。
// 事件词表 = 02 §5.6 pi 词表 1:1，不得增删改名（PI_STREAM_EVENTS 的会话内
// 15 件；wake/shutdown 为机器控制事件，走机器 stream 通道不入 StepEvent，
// protocol/sse.ts MACHINE_STREAM_EVENT_TYPES）。
// 缝纪律（01 §5/§7.3）：daemon 内 pi 实现类之外，任何模块不得 import
// `@earendil-works/*`（biome noRestrictedImports 强制，seam-lint 面）。
// 第二引擎将来 = 新增一个 AgentBackend 实现，事件面/能力面不动（00/D1）。
// 本文件零依赖 pi——shared 零反向（01 §3）。

import { z } from 'zod';
// 类型-only（编译期擦除）：brief-file.ts 反向依赖本模块的 isBackendRuntimeId，
// 值导入会成环。
import type { BriefBackendId } from './brief-file.js';
import { epochMs, recordId } from './records/common.js';
import { messageRecordSchema } from './records/message.js';
import {
  providerApiSchema,
  providerCompatSchema,
  providerModelSchema,
} from './records/provider.js';

/** 工具调用行（02 §5.6 `toolcall_end` 载荷；transcript 工具行 `> edit README.md`
 * 的数据面，r3 §3.5）。wire 细形未采 [推断]：字段 = pi toolCall + 执行结果的
 * 最小投影，实现期重放补采后回写 02 §11 收紧（04 §3 不判负口径）。 */
export const toolCallRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.unknown(),
  /** 执行结果（toolcall 块完成时可能尚未有结果——live 回传时缺省，
   * transcript 终稿必含 [设计]）。 */
  result: z.unknown().optional(),
  isError: z.boolean().optional(),
  startedAt: epochMs.optional(),
  endedAt: epochMs.optional(),
});
export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;

/** per-message 成本分项（#927）：USD，pi `calculateCost` 按模型目录价/声明价
 * 算出的产物——宿主**原样透传不自造价格表**（票面口径）。溯源面 = message_end
 * 行携的 per-message usage（messageRecordSchema loose 位）。 */
export const modelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
});
export type ModelCost = z.infer<typeof modelCostSchema>;

/** per-model 四维计数（02 §6.2 tokenUsage 分项；`<provider>/<modelId>` 串
 * r3 §1.5）。build 维由宿主落库时补全（token_usage 表主键 buildId×model）。
 * cost = 成本维（#927）：可选位——旧 daemon 与 claude-code 后端的行不带
 * （mixed-version / 双后端零回归，server 侧缺省按 0 记账）。 */
export const modelUsageSchema = z.object({
  model: z.string(),
  input: z.number().int(),
  output: z.number().int(),
  cacheRead: z.number().int(),
  cacheWrite: z.number().int(),
  cost: modelCostSchema.optional(),
});
export type ModelUsage = z.infer<typeof modelUsageSchema>;

/** 01 §5 `usage(): TokenUsage`——build × model × {输入,输出,缓存读,缓存写}
 * （02 §6.2）；缝内视角 = per-model 行集（build 维在宿主）。命名精化为
 * AgentTokenUsage 以让位 records/token-usage.ts 的 wire record TokenUsage
 * （01 §5「实现期可精化字段」口径）。 */
export type AgentTokenUsage = readonly ModelUsage[];

export const agentTokenUsageSchema = z.array(modelUsageSchema);

/** provider 配置（01 §5 SessionOpts.provider；kind = 02 §5.6 配置 kind 的
 * provider 三值——`stdio` 为 MCP transport 专用，不入 provider 配置）。
 * apiKey 为运行时内存态：per-step 下发不落盘（02 §8 运行时层），永不持久化、
 * 永不回传 server。 */
export const providerConfigSchema = z.object({
  kind: z.enum(['api_key', 'oauth', 'http']),
  /** preset provider id（38 目录，records/provider.ts）或 custom providerId。 */
  providerId: z.string(),
  label: z.string().optional(),
  /** custom 端点 baseUrl（preset 走 pi 内建目录时可缺省）。 */
  baseUrl: z.string().optional(),
  /** custom 端点三协议（records/provider.ts providerApiSchema）。 */
  api: providerApiSchema.optional(),
  /** 兼容旋钮（#654：records/provider.ts providerCompatSchema——maxTokensField
   * / supportsStore / supportsDeveloperRole；daemon 物化进 pi models.json，
   * 缺省位 = pi 端点探测默认）。 */
  compat: providerCompatSchema.optional(),
  authHeader: z.boolean().optional(),
  models: z.array(providerModelSchema).optional(),
  apiKey: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** 宿主增量工具规格（01 §5 SessionOpts.tools：web_fetch / remote_shell /
 * push_branch / save_memory，02 §4.4/§5.6）；parameters = JSON Schema（typebox
 * 产物的 wire 形 [设计]）。 */
export const toolSpecSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string(),
  parameters: z.unknown().optional(),
});
export type ToolSpec = z.infer<typeof toolSpecSchema>;

/** daemon 本地工具定义（02 §8 密钥取用通道）：位形同 remoteTools（backend 映
 * 射为 pi customTool），差别只在 execute 的落点——本类在 daemon 进程内跑，
 * 不经 relay、不出机器。函数字段故非 wire schema（与 executeRemoteTool 同律）。 */
export interface LocalToolDef {
  name: string;
  label?: string;
  description: string;
  /** JSON Schema（同 remoteTools.parameters 位形 [设计]）。 */
  parameters?: unknown;
  /** 执行：返回结果文本（pi 侧照常消费）。 */
  execute(params: Record<string, unknown>): Promise<string>;
}

/** MCP 端点（01 §5 SessionOpts.mcpServers；02 §7.1：per-turn 连接、失败降级
 * 不阻断；工具名 `mcp__<slug>__<tool>`）。spec 13 起本形状只活在 daemon 内部
 * （backend 缝 → pi 会话）：claim wire 改携 slug 列表，端点由 daemon 读本机
 * `~/.claude.json` 解析——凭证值从不跨 wire。 */
export const mcpEndpointSchema = z.object({
  slug: z.string(),
  transport: z.enum(['http', 'stdio']),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  /** stdio 子进程环境（config env 段；SDK 与默认继承环境合并后 spawn）。 */
  env: z.record(z.string(), z.string()).optional(),
});
export type McpEndpoint = z.infer<typeof mcpEndpointSchema>;

/** StepEvent——02 §5.6 pi 流事件词表的会话内 15 件 1:1（01 §5 锁定：
 * `thinking` = thinking 块全文（thinking_end 时机）、`message_stop` = 流被
 * 停止（abort/stop 语义 [推断]）、`done` 携 usage、`error.retryable` 供宿主
 * 重试策略；映射自 pi AgentSessionEvent 的实现归 daemon backend/pi.ts）。 */
export const stepEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('thinking_delta'), text: z.string() }),
  z.object({ type: z.literal('toolcall_end'), call: toolCallRecordSchema }),
  z.object({ type: z.literal('message_update'), message: messageRecordSchema }),
  z.object({ type: z.literal('message_end'), message: messageRecordSchema }),
  z.object({ type: z.literal('message_stop'), message: messageRecordSchema }),
  z.object({ type: z.literal('compaction') }),
  z.object({ type: z.literal('compaction_start') }),
  z.object({ type: z.literal('compaction_end') }),
  z.object({ type: z.literal('auto_retry_start'), attempt: z.number().int() }),
  z.object({ type: z.literal('auto_retry_end'), attempt: z.number().int() }),
  z.object({ type: z.literal('steer'), text: z.string() }),
  z.object({ type: z.literal('done'), usage: agentTokenUsageSchema }),
  z.object({
    type: z.literal('error'),
    error: z.object({ message: z.string(), retryable: z.boolean() }),
  }),
]);
export type StepEvent = z.infer<typeof stepEventSchema>;

/** StepEvent type 词表（与 PI_STREAM_EVENTS 前 15 件一致 = 01 §5「1:1 不得
 * 增删改名」的静态自检面；vocabulary.test 对拍）。 */
export const STEP_EVENT_TYPES = stepEventSchema.options.map(
  (o) => o.shape.type.value,
) as readonly string[];

// —— 01 §5 接口签名（TS 面原样；zod 面 = 上方 wire schema）———————————————

/** 思考强度档位词表单源（能力读面的值域）：pi 七档，逐字 = 上游
 * `ThinkingLevel` 联合（@earendil-works/pi-agent-core 0.86.0
 * dist/types.d.ts:267）。三端同引此常量——daemon 的 `PI_CAPABILITIES`
 * 取它当能力声明、server 的 `GET /api/capabilities` 投影它、web 的 Agent
 * 详情只读行消费它，跨缝不复制常量（XMON-16 / #499 B3 裁决 A）。 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const thinkingLevelSchema = z.enum(THINKING_LEVELS);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

export interface AgentBackendCapabilities {
  readonly name: string; // 'pi'
  /** 配置面「思考强度」（02 §6.2 agent 形状）；值域 = THINKING_LEVELS 单源。 */
  readonly thinkingLevels: readonly string[];
  /** anthropic/openai-codex/github-copilot/xai（#34 锁定订阅项，02 §5.6）。 */
  readonly oauthProviders: readonly string[];
  readonly compaction: boolean;
  /** continue session（合并轮复用，02 §4.2）。 */
  readonly sessionResume: boolean;
}

export interface SessionOpts {
  /** kind: api_key | oauth | http（02 §5.6 配置 kind）。claude-code runtime 步
   * 收 inert 占位（`{kind:'api_key', providerId:'claude-code'}`，spec 17 A4
   * 零凭据语义——认证机器本地，后端不消费该字段）；pi 步语义不变。 */
  provider: ProviderConfig;
  modelId: string;
  thinkingLevel?: string;
  /** memory 注入经 pi before_agent_start 缝（00/D3、02 §4.4）。 */
  systemPrompt?: string;
  /** web_fetch / remote_shell / push_branch / save_memory（宿主增量）。 */
  tools?: ToolSpec[];
  /** remoteTools 定义（chief 步服务端工具，protocol/chief-tools.ts；位形一手
   * = bundle makeRemoteTools 读 step.remoteTools，r5 §3.1）。backend 把每条映射
   * 为 pi customTool，execute → executeRemoteTool relay 回传服务端执行。 */
  remoteTools?: import('./protocol/chief-tools.js').RemoteToolDef[];
  /** remoteTools relay 执行回调（runner 注入 = POST /api/machine/tool/<stepId>
   * {name, params} → {text}）；返回结果文本（r5 §3.1 bundle text() 形）。 */
  executeRemoteTool?: (name: string, params: Record<string, unknown>) => Promise<string>;
  /** daemon 本地工具（02 §8：团队密钥取用通道的落点）。空/缺省 = 不注册
   * （既有调用面零回归）。工具名进会话工具面（backend 构建）。 */
  localTools?: LocalToolDef[];
  /** per-turn 连接、失败降级不阻断（02 §7.1）。 */
  mcpServers?: McpEndpoint[];
  /** skills catalog 白名单（#372；spec 14「SessionOpts 不加字段」的修订——
   * 当时不过滤所以不加，本字段把过滤白名单补进契约）。slug 集 = claim 载荷
   * agent.skillsAllowlist（#1169 正名；frontmatter name 回落目录名，#367 wire
   * 模型）。undefined = 不过滤（chief 面全量直通，null「不限制」由 runner 折叠
   * 进来——两态不进本契约面）；[] = 不注入任何 skill 且全库 Read 被 #917 硬挡
   * （显式全拒）；名单内未知 slug 静默跳过（#367 容忍语义）。 */
  skillsAllowlist?: string[];
  /** #1106 派发技能注入选择（worker 步；claim 载荷 agent.injectedSkills
   * 透传）：本步任务 brief 实际注入的技能 id 集。在位（含 []）= 目录注入按
   * 本集收窄（描述全文不截断——选择本身已控制噪声，budget 闸让位）；
   * 缺省 = 旧 server 形，目录注入回落 skillsAllowlist 白名单。**不改变
   * 白名单硬挡**：#917 denied 判定仍吃 skillsAllowlist（授权语义），
   * 注入选择只管「brief 里提哪些」。 */
  injectedSkills?: string[];
  /** 团队技能物化目录（XMON-112 S2，spec 14 增补；#920 清单 + 按需拉）：
   * daemon 步启动经 GET /api/machine/skills/{stepId} 清单 + /file 按需拉取
   * 物化后的本机缓存视图目录。backend 把它排在本机 skillsDir 之前扫描——
   * 同名冲突团队条目胜（pi loadSkills first-wins，白名单授予是权威信号）。
   * 缺省 = 纯本机扫描（零回归）。 */
  teamSkillsDir?: string;
  /** 只读回合（#511 审核步）：文件写类内建工具（edit/write）不下发——审核者
   * 是来判定的，不是来动手的；bash 保留（跑验证命令是它的职责）。缺省 =
   * 全量工具面（worker/chief 步现行为）。落点 = backend 工具面构建，宿主
   * 无从旁路。 */
  readOnly?: boolean;
  /** #1148 per-step env 注入（worker 步端口基座 PACMAN_PORT_BASE 等）：值进
   * agent 进程的命令环境——pi = bash 工具 spawn env（spawnHook）；claude-code
   * = SDK options.env（整替语义，backend 展开 process.env）。注意它**不是**
   * wire 字段（claim 载荷不携带）：槽位分配是 machine-loop 的本地事实，env
   * 只随 SessionOpts 跨缝。缺省 = 不注入（backend 零变化）。 */
  env?: Record<string, string>;
  /** worktree 目录（02 §5.5）。 */
  cwd: string;
  /** 本轮任务文本（实现期精化，01 §5 头部口径）：createSession = 首条用户
   * 消息（02 §4.2 任务 spec）；continueSession = 续轮消息（驳回 feedback /
   * 合并指令，02 §4.2 确认回路）。缺省 = 开会话不发轮（Chief 面板形态）。
   * (#730) 值 = token 展开后的文本（原始 prompt 归 journal/transcript）。 */
  prompt?: string;
  /** 首轮随 prompt 交付的图片（#730：daemon 解析步 prompt 里的整行附件
   * token、经 machine 面下载后的内联交付面）。backend 映射为各自引擎的
   * image content block（claude-code = MessageParam 块数组；pi =
   * PromptOptions.images）。缺省 = 无图片（既有调用面零变化）。 */
  promptImages?: readonly DeliveredImage[];
}

/** 交付图片（#730）：跨缝中立形态——backend 映射为各自引擎的内联 image
 * content block。data = 裸 base64（无 data: 前缀）；mimeType = image/*。 */
export interface DeliveredImage {
  data: string;
  mimeType: string;
}

export interface AgentSessionHandle {
  /** 引擎侧会话标识（实现期精化）：done 回传 server（step.sessionId），
   * continueSession(id) 的解析键——宿主 durable 编排的会话持久化索引面
   * （00/D3：durable 语义宿主自持）。 */
  readonly sessionId: string;
  readonly events: AsyncIterable<StepEvent>;
  /** 中途补话（W3 #279）；images = 随话交付的图片（#730，可选——缺省 =
   * 纯文本，既有调用面零变化）。 */
  steer(text: string, images?: readonly DeliveredImage[]): Promise<void>;
  stop(): Promise<void>;
  /** build × model × {输入,输出,缓存读,缓存写}（02 §6.2）。 */
  usage(): AgentTokenUsage;
}

/** 简报文件通道（#958，可选能力位）。
 *
 * 在位 = 本后端**原生会读**任务 worktree 里的上下文文件，每一步的简报改落那个
 * 文件、systemPrompt 通道清空；缺席 = 本后端不读，runner 保留 inline
 * systemPrompt 通道（未来第三个后端的逃生口，Multica 的 prompt-only mode 同律）。 */
export interface BriefChannel {
  /** 落点用哪套候选序与新建名（`@pacman/shared` brief-file.ts 的 BriefBackendId）。
   * 这不是装饰——写错文件 = 简报完全不被读，且全搬之后没有回退通道。 */
  readonly backendId: BriefBackendId;
  /** 完整简报正文 = 后端贡献（技能目录等）接在 `base`（runner 侧的 systemPrompt
   * 正文）之后。整段由 runner 写进 worktree 文件。
   *
   * 把「拼接」也放在后端而不是只返回增量：目录构造吃的是**后端私有**的
   * skillsDir 与 cwd（spec 14 §49 刻意用 daemon home 而非 worktree），而拼接函数
   * （appendSkillsCatalog）住在 backend/skills.ts——runner 去 import 它会破坏缝纪律
   * （runner 不消费 @earendil-works 那一层）。返回空串 = 本后端无贡献。 */
  composeBody(opts: SessionOpts, base: string | undefined): string;
}

export interface AgentBackend {
  readonly capabilities: AgentBackendCapabilities;
  /** 简报文件通道（#958）。见 BriefChannel；缺席 = inline systemPrompt。 */
  readonly brief?: BriefChannel;
  /** new session <convId>（02 §5.7 步骤生命周期行）。 */
  createSession(opts: SessionOpts): Promise<AgentSessionHandle>;
  /** continue session <convId>（02 §5.7；id = 会话持久化标识，实现自定——
   * pi 侧 = sessionId/sessionFile，daemon chat-sessions/ 索引解析）。 */
  continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle>;
  /** 协议 400 自适配（#654，可选实现——Multica client.go 按错误回落同律）：
   * 错误签名命中上游明示的参数/协议不兼容时，返回翻了 compat 旋钮的
   * provider 配置（供步内一次回落重试）并记录进程内学习（后续步直接干净
   * 形态物化）；null = 未命中或无可翻。pi 后端实现；claude-code 后端不实现
   * （A4 零凭据面无 provider 形态可适配，调用面 `?.` 静默跳过）。 */
  adaptProviderCompat?(provider: ProviderConfig, errorMessage: string): ProviderConfig | null;
}

/** spec 17 A3 backend 身份词表：`agent.provider` ∈ 此表 = 该步跑对应第二
 * 后端（per-step 解析，唯一分叉点在 runner 的 backendFor）。'pi' 是模型源
 * runtime 但**非** backend 身份——pi 步的 provider 槽承载 custom provider
 * id，恒走默认支。子集关系 BACKEND_RUNTIME_IDS ⊆ MODEL_SOURCE_RUNTIMES 由
 * vocabulary.test 静态钉住（backend 必是模型源；模型源不必是 backend）。 */
export const BACKEND_RUNTIME_IDS = ['claude-code'] as const;
export type BackendRuntimeId = (typeof BACKEND_RUNTIME_IDS)[number];

/** backend 身份判定（窄类型守卫）：词表外（custom provider id / pi /
 * null / undefined）一律 false。server 侧 toProviderConfig 与 daemon 侧
 * runner 凭它分流零凭据通道（A4）。 */
export function isBackendRuntimeId(v: unknown): v is BackendRuntimeId {
  return typeof v === 'string' && (BACKEND_RUNTIME_IDS as readonly string[]).includes(v);
}

/** 会话持久化标识（continueSession 的 id 形）：宿主 durable 编排面——
 * buildId ≡ conversationId（CONTEXT.md）+ 引擎侧 sessionId 双记录 [设计]。 */
export const sessionRefSchema = z.object({
  conversationId: recordId,
  sessionId: z.string().nullable(),
});
export type SessionRef = z.infer<typeof sessionRefSchema>;
