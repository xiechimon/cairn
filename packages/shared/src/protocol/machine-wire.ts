// 机器面 wire 层——02 §5 canonical 13 端点（MACHINE_ENDPOINTS 路径词表单源，
// r3 §1.6 bundle 静态提取）的请求/响应 zod schema。路径与字段名不改形状
// （02 §5.8 尾注）；HTTP 动词与载荷细形 r3 未逐一采集处 = [推断]/[设计]
// （04 §3 不判负口径），实现期重放补采后回写 02 §11 收紧。
// 认证（02 §8/§5.3）：机器面 = `Authorization: Bearer <machine token 64hex>`；
// enroll = `Authorization: Bearer <apiKey pacman_48hex>`（前缀 = brand.ts
// apiKeyPrefix 槽）；token 服务端存哈希。

import { z } from 'zod';
import { modelUsageSchema, providerConfigSchema, toolCallRecordSchema } from '../agent-backend.js';
import { epochMs, recordId } from '../records/common.js';
import { machineRecordSchema } from '../records/machine.js';
import { messageRoleSchema, transcriptRowSchema } from '../records/message.js';
import { claudeCodeReportSchema } from '../records/model-source.js';
import { PROJECT_REPO_KINDS } from '../records/project.js';
import { reviewVerdictSchema } from '../records/review.js';
import { stepActivityReportSchema, stepRecordSchema } from '../records/step.js';
import { verifyVerdictSchema } from '../records/verify.js';
import {
  machineToolRelayBodySchema,
  machineToolRelayResponseSchema,
  remoteToolDefSchema,
} from './chief-tools.js';
import { machineJsonSchema } from './executor.js';

/** 机器面认证头词表（02 §8：apiKey/machine token 存哈希不入 SecretBox）。 */
export const MACHINE_AUTH_HEADER = 'authorization';
export const MACHINE_AUTH_SCHEME = 'Bearer';

// —— enroll（02 §5.2 路径二：--api-key --team 非交互注册）—————————————————————

/** POST /api/machine/enroll body [推断]（r3 §1.2 实测命令行形状
 * `--api-key <key> --team <teamId>`；--name 默认 hostname，r3 §1.1）。 */
export const machineEnrollBodySchema = z.object({
  teamId: recordId,
  /** pacman start --name（缺省 = hostname）。 */
  name: z.string().optional(),
  /** CLI 版本（机器页 latestCliVersion 数据源，r5 §8）。 */
  cliVersion: z.string().optional(),
  /** 本机 claude-code 模型上报（#707）：daemon 读本机 settings.json 随注册
   *  上行，免等首个 presence 节拍。缺席 = 旧 daemon（server 视为未知）。 */
  claudeCode: claudeCodeReportSchema.optional(),
  /** 机器能力清单（#1251 / ADR 0018 决策 4.1）：已装 MCP slug 集 + 本机
   *  技能名集，随注册上行免等首个 presence 节拍。wire 级宽松位（z.unknown，
   *  心跳红线 02 §5.4——坏形状永不 400 注册/心跳）；server 侧对
   *  machineCapabilitiesSchema 单独 safeParse 收严落库，失败丢弃保留旧值。
   *  缺席 = 旧 daemon（server 视为未知，能力闸放行）。 */
  capabilities: z.unknown().optional(),
});
export type MachineEnrollBody = z.infer<typeof machineEnrollBodySchema>;

/** 响应 = machine.json 形状（r3 §1.3 实测 {machineId,token(64hex),teamId,
 * serverUrl}）；token 一次性下发（服务端只存哈希，02 §8）。重注册复用同一
 * machineId（r3 §1.2 实测，按 key/team 认机器 [推断]）。 */
export const machineEnrollResponseSchema = machineJsonSchema;
export type MachineEnrollResponse = z.infer<typeof machineEnrollResponseSchema>;

/** POST /api/machine/enroll/start（浏览器授权流，02 §5.2 路径一）——响应形状
 * [设计]（r3 未走通该路径）；web 侧授权页归 M5 接线。 */
export const machineEnrollStartBodySchema = z.object({
  teamId: recordId.optional(),
  name: z.string().optional(),
});
export const machineEnrollStartResponseSchema = z.object({
  enrollId: z.string(),
  /** 浏览器授权 URL（登录页授权团队，02 §5.2）。 */
  url: z.string(),
});

/** POST /api/machine/enroll/poll——status 词 [设计]。 */
export const machineEnrollPollBodySchema = z.object({ enrollId: z.string() });
export const machineEnrollPollResponseSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('authorized'), machine: machineJsonSchema }),
  z.object({ status: z.literal('expired') }),
]);

/** POST /api/machine/enroll/confirm（#285 [设计] 登记位 MACHINE_WIRE_EXTENSIONS）
 * ——授权页用户确认：建 machine 行（无 apiKey，capability=enrollId 单次）+
 * enroll 位转 authorized。响应 = machine.json 形状（授权页完成态展示；
 * poll authorized 态同载荷）。 */
export const machineEnrollConfirmBodySchema = z.object({ enrollId: z.string() });
export const machineEnrollConfirmResponseSchema = z.object({ machine: machineJsonSchema });

// —— me / presence / recover ————————————————————————————————————————————————

/** GET /api/machine/me → machine record（02 §6.2；机器页数据同源）。 */
export const machineMeResponseSchema = machineRecordSchema;

/** POST /api/machine/presence body [推断]（02 §5.4：presence 心跳并行失败、
 * 进程不退出）。claudeCode 位（#707）：daemon 读本机 settings.json 随 30s
 * 节拍上行（小 payload，无新增长连接）；缺席 = 旧 daemon，server 保留旧值。 */
export const machinePresenceBodySchema = z.object({
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  /** 机器能力清单（#1251，enroll 同律）：wire 级宽松位（z.unknown）——
   *  字段级解析失败不阻心跳（02 §5.4 红线），收严在 server 侧 safeParse
   *  （machineCapabilitiesSchema），失败丢弃该字段保留旧值、presence 恒
   *  {ok:true}。缺席 = 旧 daemon，server 保留旧值。 */
  capabilities: z.unknown().optional(),
});
export const machineOkResponseSchema = z.object({ ok: z.literal(true) });

/** POST /api/machine/recover → 本机 claimed 未收尾步集（02 §5.4 步 journal
 * 恢复的 server 侧真值；`[recover] no pending steps found` 行形 r3 §1.5）。
 * 动词 [推断]。 */
export const machineRecoverResponseSchema = z.object({
  steps: z.array(stepRecordSchema),
});
export type MachineRecoverResponse = z.infer<typeof machineRecoverResponseSchema>;

// —— tasks/claim（长轮询，节奏 ~75–76s，r3 §1.5/02 §5.4）—————————————————————

/** POST /api/machine/tasks/claim body [推断]（动词：长轮询有实证，POST 为
 * claim 语义惯用形）。#503 起空体：原 `running`（在跑步数）字段只服务已被
 * 摘除的并发门，server 侧从未读它。
 * #1148 增 `maxWorkers`（daemon worker 并发上限自报）：值 = daemon 侧
 * effective cap（env PACMAN_DAEMON_MAX_CONCURRENT > DB machine 行 > 默认，
 * daemon 解析单源）。server 的 worker 容量闸取 min(machine.maxConcurrent,
 * 此值)——chief 步不受它约束。缺省 = 老 daemon 形（server 只按机器行；
 * 纯增可选字段，zod strip 语义，无版本墙）。 */
export const machineClaimBodySchema = z.object({
  maxWorkers: z.number().int().min(1).optional(),
});
export type MachineClaimBody = z.infer<typeof machineClaimBodySchema>;

/** claim 载荷（02 §4.2 三类步 + §5.7 生命周期行所需上下文）[设计]——
 * wire 未采（r3 无 claim 响应样本）；字段 = 主时序执行最小集，凭证不在此
 * （per-step 走 token/{stepId}，02 §5.4/§8）。
 * M4a 扩展（chief 步，r5 §3.1 实测 Chief 回合 = 机器 step）：`remoteTools[]`
 * 位形一手 = bundle `makeRemoteTools(serverUrl, token, step)` 读
 * `step.remoteTools`（r5 §3.1 raw 提取）；`chief` 块与 `instruction` 为
 * [设计] 等价物（wire 未采）。 */
export const claimedStepSchema = z.object({
  step: stepRecordSchema,
  /** ≡ step.buildId（CONTEXT.md 实体等式；显式字段 = 02 §5.7 `for conv <uuid>`）。
   * chief 步 = `chief-<uuid>`（conversationId ≡ threadId，r5 §3.1）。 */
  conversationId: recordId,
  /** 会话语义（02 §4.2/§5.7）：new session | continue session（合并轮/驳回
   * 重规划/chief 续轮复用同 conv pi 会话）。sessionId = 引擎侧会话标识（done 回传）。 */
  session: z.object({
    action: z.enum(['new', 'continue']),
    sessionId: z.string().nullable(),
  }),
  /** 续轮指令（server 合成 [设计]）：驳回 feedback 注入重规划轮（r5 §4
   * 「v2 内容忠实执行反馈」的宿主等价物）、chief 回合任务文本/wake 事实。
   * 缺省 = daemon 按 kind 兜底（CONTINUE_PROMPTS）或 title+spec 任务文本。 */
  instruction: z.string().nullable().optional(),
  /** worker 步任务面；chief 步缺省（无 todo 语境，r5 §3.1）。 */
  todo: z
    .object({
      id: recordId,
      seqNum: z.number().int(),
      title: z.string(),
      spec: z.string(),
      /** 任务元信息注入面（#446 / ADR 0005 分叉律）：github 形态项目携带，
       * 缺省 = local/hosted 现行为（daemon 回落 FIXED_TAGS 单标签 + 占位
       * 回填指令，文本逐字节不变）。vocab = 项目标签集镜像的 name 列（claim
       * 时现取，不缓存第二真值；标签数量上限的分叉落点在 server setTaskMeta
       * 校验分支与工具面 tags 数组形，不进本载荷）；titleFinal = 标题已是
       * 真值（issue 来源），daemon 不注入回填指令且 server 拒绝 title 覆写。
       * 纯增可选字段无版本墙：旧 daemon 忽略 = 现行为。 */
      meta: z
        .object({
          titleFinal: z.boolean(),
          vocab: z.array(z.object({ name: z.string() })),
        })
        .optional(),
    })
    .optional(),
  /** worker 步项目面；chief 步 = 探索基座（可缺省 = 裸目录回合）。 */
  project: z
    .object({
      id: recordId,
      name: z.string(),
      /** repo 绑定位（M3b worktree 契约接线，02 §3/§5.5 + spec 12 local 形态）：
       * cloneUrl = 托管 `<origin>/git/<teamId>/<repoName>`（02 §5.8
       * gitHostDomain 槽本地代位）、GitHub https 派生、或 local 形态的用户仓库
       * 绝对路径（server 端 validateLocalRepoPath 规范化值——daemon 镜像 clone
       * 源与 ff-only 落地面同吃该路径，git clone 对本地路径默认走硬链接）；
       * null = 项目未绑 repo（工作区退化为裸目录）。 */
      repo: z
        .object({
          // 词表单源 = PROJECT_REPO_KINDS（records/project.ts；新 kind 落地
          // 即随 wire，免三处散射编辑）。
          kind: z.enum(PROJECT_REPO_KINDS),
          cloneUrl: z.string(),
          /** github 形态同机加速位（ADR 0017 / #1213）：项目行 localPath
           * 非空时携带。daemon 物化时双条件判定（路径存在 + 该路径 origin
           * 归一化后与 cloneUrl 同仓），不过则静默回落 GitHub clone——
           * 路径活在执行机，server 侧不预判。local 形态不携带（cloneUrl
           * 即路径本身）。 */
          localPath: z.string().optional(),
        })
        .nullable(),
    })
    .optional(),
  /** 执行 Agent（worker 步 = assignment 按步类取槽，02 §4.2/r5 §5；chief 步 =
   * 绑定 Agent，模型 = 绑定 Agent 模型 r5 §3.1）；null = 未指派（不可执行，
   * server 侧不派发 [设计]）。 */
  agent: z
    .object({
      id: recordId,
      displayName: z.string(),
      description: z.string().nullable(),
      provider: z.string().nullable(),
      modelId: z.string().nullable(),
      thinkingLevel: z.string().nullable(),
      /** 该 Agent 记忆条目注入 systemPrompt（02 §4.4 读路径最小形；注入形
       * [推断] 保留，04 附录 A）。 */
      memories: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
      /** 授权白名单（#1169 起正名，原 skills 字段拆出的授权半边）：null =
       * 不限制（全量可读，创建缺省——[] 旧行已随迁移转 null）；数组 = 白名单
       * （#917 deny 吃它，名单外 Read 硬挡）；[] = 显式全拒（有意选择，不再
       * 是意外缺省）。worker 步恒携带（null 或数组）；chief 步不携带（信任面
       * 全量直通）。旧 daemon 忽略本字段 = 其缺省律全量直通——混版本窗口里
       * 老 daemon 对白名单行不设挡（窗口期接受，server+daemon 同步部署即收）。 */
      skillsAllowlist: z.array(z.string()).nullable().optional(),
      /** 默认携带技能（#1169 携带半边，单值）：worker 步恒携带（null = 未设）；
       * daemon 据此把非空值排进 #1116 注入绑定序首位（自动携带语义）。chief
       * 步不携带（chief 目录恒全量，无绑定序）。 */
      defaultSkill: z.string().nullable().optional(),
      /** #1106 派发技能注入选择（worker 步恒携带含空数组）：本步任务 brief
       * 实际注入的技能 id 集（= 服务端按任务文本对授予集规则选出的子集；
       * [] = 已计算零命中——零注入不是故障；缺省 = 旧 server 未做选择，
       * 目录注入回落 skillsAllowlist 白名单全量）。ids ⊆ skillsAllowlist
       * （授权上限不变——denied 判定仍吃 allowlist 全量，本字段只收窄目录
       * 注入面）。纯增可选字段：旧 daemon 忽略 = 现行为，无版本墙。 */
      injectedSkills: z.array(z.string()).optional(),
      /** 权限开关已开集（XMON-77）：词表 = AGENT_TOOL_SWITCHES 六档（XMON-84
       * 用户拍板 B 恢复全六档），执法落点 = daemon 收尾闸（merge fail-fast +
       * push 软拒）与 server requestMerge 闸——只消费 合并分支/推送分支 两
       * 执法档，四无本体档照常透传（无消费方，本体另立规划票）。worker 步恒
       * 携带——含空数组（[] = 全关，least-privilege；缺省保留给老 server =
       * fail-open 版本墙，两态不得混淆）。chief 步不携带（chief 步不开
       * worktree、无 git 收尾——两开关无语义）。读侧宽：存量行残值原样透传，
       * daemon 只认已知档。无版本墙：纯增可选字段，旧 daemon 忽略 = 现行为
       * （推送不受限）。 */
      tools: z.array(z.string()).optional(),
    })
    .nullable(),
  /** chief 步块（r5 §3.1：Chief 回合 = pi 会话 + 服务端 relay 工具；细节
   * [设计]——wire 未采）。 */
  chief: z
    .object({
      /** ≡ conversationId 去 `chief-` 前缀后的线程 id（chief-<uuid> 同值）。 */
      threadId: recordId,
      /** server 合成 system prompt（charter + 团队资源清单 + 策略指引，
       * 02 §4.3 接口契约「输入：用户自然语言消息 + 团队资源清单」）。 */
      systemPrompt: z.string(),
      /** 本回合触发（user 消息轮 / wake 轮，r5 §3.5）。 */
      trigger: z.enum(['user', 'gate', 'settle', 'failed', 'wake']),
    })
    .optional(),
  /** remoteTools[]（服务端定义、服务端执行；chief 步 = 51 词表全量，
   * protocol/chief-tools.ts；worker 步 = 记忆三件套 WORKER_MEMORY_REMOTE_TOOLS，
   * 02 §4.4/r5 §6「worker 侧同族工具经 remoteTools 下发」。位形一手 = bundle
   * 提取，r5 §3.1）。 */
  remoteTools: z.array(remoteToolDefSchema).optional(),
  /** daemon 本地工具注册依据（XMON-108 R1，XMON-85 规划「权限决策单点在
   * server」）：server 在 claim 时算好的词集，daemon 照此注册 LocalToolDef
   * （agent-backend.ts）——词缺席 = 工具不注册（fail-closed；与 mcpServers
   * 版本墙不同，这里缺省与空数同义，无混发形状失败模式）。当前两词：
   * remote_shell（AGENT_TOOL_SHELL ∩ machine.shellEnabled 双闸）与
   * create_tag（agent.tools ∋ 创建标签，与机器旗无关——T1/XMON-111 消费，
   * 契约由本票一次定死）。worker 步恒携带含空数组（[] = 无本地工具，
   * least-privilege，skills/tools 同律）；chief 步不携带（chief 无 worktree/
   * 无本地工具语义，跨机 shell 派发显式缓期）。每条命令的真实闸在预检端点
   * （本字段只是注册面），步中关闸不影响在跑会话的下一次预检。纯增可选
   * 字段：旧 daemon 解析即丢弃，无版本墙。 */
  localTools: z.array(z.string()).optional(),
  /** 已授权 MCP slug 列表（spec 13 断约：原 McpEndpoint[] 改 string[]——
   * server 不再解析端点、不再持有任何 MCP 凭证；执行 daemon 读本机
   * `~/.claude.json` 按 slug 自行解析，per-turn 连接、失败降级不阻断，
   * 工具名 `mcp__<slug>__<tool>`，未知 slug daemon 侧跳过。三态受管
   * （#1307，对齐 Multica mcp_config.go）：数组（含 [] = 受管严格空——
   * daemon 据此给 claude-code SDK 上 strictMcpConfig 锁，用户全局 MCP 不进
   * 会话）= 受管集合；缺省 = 继承 runtime 配置，只在版本墙
   * （MCP_MIN_CLI_VERSION，断约时提升）未达时由新 server 发出——旧 daemon
   * 视为无 MCP 运行，不存在混发两种形状的失败模式。 */
  mcpServers: z.array(z.string()).optional(),
});
export type ClaimedStep = z.infer<typeof claimedStepSchema>;

/** localTools 词值单源（XMON-108 R1）：claim 组装（server）与 daemon 注册/
 * 判读（R2/XMON-110、T1/XMON-111）共用，不散射字面量。remote_shell 与
 * MACHINE_CUSTOM_TOOLS 同词（executor.ts：02 §5.6 机器侧自定义工具——
 * 词表占位自此有本体）。 */
export const LOCAL_TOOL_REMOTE_SHELL = 'remote_shell';
export const LOCAL_TOOL_CREATE_TAG = 'create_tag';

/** 响应：{step: null} = 长轮询超时空手（daemon 立即重发，节奏 ≈ hold 时长
 * ≈ 75s，r3 §1.5 实测）。 */
export const machineClaimResponseSchema = z.object({
  step: claimedStepSchema.nullable(),
});
export type MachineClaimResponse = z.infer<typeof machineClaimResponseSchema>;

// —— stream（wake SSE，02 §1.2/§5.4）————————————————————————————————————————

/** machine sync 命令载荷（M7 #319 [设计]，08 册附录 B「分支同步」缺口）：
 * server→daemon 单机定向；daemon 凭此 fetch + checkout 到目标 commit，
 * force 语义 = 丢弃修改 + 删未跟踪文件（保留 .gitignore 内容）。
 * 路径 = 机器本机绝对或 ~ 开头（spec r1 changelog 09-13 文本可改）。
 * cloneUrl + projectId = 新机器无基座仓时匿名 clone 用（08 册附录 B
 * 「目标机器可选任意」语义；GitHub 公开 repo 可走，私有仓需后续 per-machine
 * git 凭证设计 [推断]）。 */
export const machineSyncCommandSchema = z.object({
  syncId: recordId,
  buildId: recordId,
  projectId: recordId,
  /** 目标仓 clone URL（机器基座未存在该 project 时 daemon 据此 clone）；同
   * build 已有 worktree 的机器复用本地，不发此 clone。 */
  cloneUrl: z.string(),
  /** 同步目标目录（机器本机路径；web 默认 `~/<homeDirName>/workspaces/<buildId>`，
   * 用户可改——r1 changelog 09-13 文本）。 */
  directory: z.string(),
  /** ref = 分支名（`pacman/conv-<uuid>`，brand conversationBranch）；
   * commit = 完整 40hex sha（daemon 端 fetch 后 reset --hard 到此 sha，spec
   * `目标提交 <12hex>` r3 §3.9 展示形但 wire 用 40hex 简化对拍）。 */
  ref: z.string(),
  commit: z.string(),
  force: z.boolean(),
});
export type MachineSyncCommand = z.infer<typeof machineSyncCommandSchema>;

/** POST /api/machine/sync-result/{syncId} body（M7 #319 [设计]，08 册附录 B）：
 * daemon 回写结果；状态机 = pending → running → synced | failed。
 * running = daemon 接管已开始（web 结果卡「正在同步…」过渡态）；
 * synced = checkout 完成；failed = 错误 + errorMessage。 */
export const machineSyncResultBodySchema = z.object({
  status: z.enum(['running', 'synced', 'failed']),
  errorMessage: z.string().optional(),
});
export type MachineSyncResultBody = z.infer<typeof machineSyncResultBodySchema>;

export const machineSyncResultResponseSchema = machineOkResponseSchema;

/** GET /api/machine/stream 事件（MACHINE_STREAM_EVENT_TYPES 载荷化 [推断]：
 * wake = 有新步可领，低延迟派发；shutdown = 服务端要求下线；steer = 运行中
 * 会话有补充说明待拉取（W3 #278 [设计]——只带 stepId 信号，文本经
 * GET /api/machine/steer 拉取-确认，SSE 载荷不携文本防丢）。
 * sync = 分支对话框「同步到机器」命令（M7 #319，r1 changelog 09-13）：
 * server→daemon 单机定向推送，daemon 经 `machineSyncCommandSchema` 载荷执行
 * 后 POST `/api/machine/sync-result/{syncId}` 回写。 */
export const machineStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wake') }),
  z.object({ type: z.literal('shutdown') }),
  z.object({ type: z.literal('steer'), stepId: recordId }),
  // stop = 用户停止钮中断在跑步（M7 #308 [设计]，steer 同律：只带 stepId
  // 信号，discard 勾选位经 GET /api/machine/stop 拉取-确认）。
  z.object({ type: z.literal('stop'), stepId: recordId }),
  z.object({ type: z.literal('sync'), sync: machineSyncCommandSchema }),
]);
export type MachineStreamEvent = z.infer<typeof machineStreamEventSchema>;

/** GET /api/machine/steer?stepId= 响应（W3 #278 [设计]）：{content} = 拉取即
 * 确认（服务端 pending 随即清）；{content:null} = 无待取/非本机在跑步/
 * pending 定向旧步（已丢弃）。 */
export const machineSteerResponseSchema = z.object({
  content: z.string().nullable(),
});
export type MachineSteerResponse = z.infer<typeof machineSteerResponseSchema>;

/** GET /api/machine/stop?stepId= 响应（M7 #308 [设计]，steer 拉取-确认同形）：
 * {discard} = 拉取即确认（服务端 pending 随即清；discard = 丢弃本轮修改勾选位，
 * true → daemon rewind worktree 到步起点）；{discard:null} = 无待取/非本机
 * 在跑步/pending 定向旧步（已丢弃）。 */
export const machineStopResponseSchema = z.object({
  discard: z.boolean().nullable(),
});
export type MachineStopResponse = z.infer<typeof machineStopResponseSchema>;

// —— 步骤 journal 端点（02 §5.4 词表）———————————————————————————————————————

/** POST /api/machine/heartbeat/{stepId}——续活；响应 {ok:true} [推断]。 */
export const machineHeartbeatResponseSchema = machineOkResponseSchema;

/** POST /api/machine/tool/{stepId} 第三形 [设计]（M5 live streaming 复刻
 * 增量）：pi `text_delta` 事件的节流批量转发（daemon 250ms 窗口聚合）。
 * 服务端仅瞬态转发到 conversation stream（02 §1.2 会话流），不落库——
 * 终稿文本经 upload-urls transcript.json 兜底（02 §1.3 数据所有权不变）。 */
export const machineTranscriptDeltaBodySchema = z.object({
  kind: z.literal('transcript_delta'),
  text: z.string(),
});
export type MachineTranscriptDeltaBody = z.infer<typeof machineTranscriptDeltaBodySchema>;

/** POST /api/machine/tool/{stepId} 第四形 [设计]（#905 步活动相位）：daemon
 * 从既有 StepEvent 流派生的「在做什么」信号（相位变化 / 新事件到达时节流
 * 重发）。服务端盖 {stepId, at} 后瞬态转发到 conversation stream 的 activity
 * 事件，不落库——终稿 transcript 仍是内容正本（02 §1.3 数据所有权不变；
 * 相位词表与安全判定 = records/step.ts stepActivitySchema + docs/verify/905）。 */
export const machineActivityBodySchema = z.object({
  kind: z.literal('activity'),
  activity: stepActivityReportSchema,
});
export type MachineActivityBody = z.infer<typeof machineActivityBodySchema>;

/** POST /api/machine/tool/{stepId} 第五形 [设计]（#955 段实时落库，ADR 0011
 *  D1/D2）：daemon 在**写入端**把模型连续输出按「一段连续同类型增量」封成
 *  transcript 行后即时上报。服务端与 live 工具行同律——ownedStep 校验后
 *  **先落库再广播**（`upsertMessage`/`upsertChiefRow`），与终稿 upload-urls
 *  按同 id 幂等去重（`onConflictDoUpdate`）。段 id 与终稿同形
 *  `msg-<stepId>-<seq>`（seq = 封段序号）。旧 daemon 不发本形 = 零回归；
 *  旧 server 收本形按 union 解析失败 400——daemon 侧 fire-and-forget（与第三
 *  形同纪律），步不受影响。 */
export const machineTranscriptRowBodySchema = z.object({
  kind: z.literal('transcript_row'),
  row: transcriptRowSchema,
});
export type MachineTranscriptRowBody = z.infer<typeof machineTranscriptRowBodySchema>;

/** POST /api/machine/tool/{stepId}——同径双形（r5 §3.1 bundle 提取）+ 复刻
 * 增量第三形（transcript delta [设计]，machineTranscriptDeltaBodySchema）+
 * #905 第四形（activity [设计]，machineActivityBodySchema）+ #955 第五形
 * （transcript row [设计]，machineTranscriptRowBodySchema）：
 * ① live transcript 工具行回传（worker 步内建工具）= toolCallRecord，与
 *    upload-urls 终稿按 toolCall id 幂等去重 [设计]；body [推断]（r3 §1.6
 *    端点名 + transcript 工具行证据）。
 * ② remoteTools relay 执行（chief 步服务端工具）= {name, params} → {text}，
 *    位形一手 = bundle `request(serverUrl, /api/machine/tool/<stepId>, …,
 *    {name, params})` + `reply.body.text`（r5 §3.1 raw）。
 * ③ transcript delta = {kind:"transcript_delta", text} → {ok:true}。
 * ④ activity = {kind:"activity", activity} → {ok:true}。
 * 服务端按 body 形状分流（kind 判别位 = delta/activity；有 params 无 id =
 * relay）。旧 server 收第四形按 union 解析失败 400——daemon 侧 fire-and-forget
 * （与 ③ 同纪律），步不受影响。 */
export const machineToolBodySchema = z.union([
  toolCallRecordSchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineActivityBodySchema,
  machineTranscriptRowBodySchema,
]);

/** relay 执行响应（bundle 消费面 `reply.body?.text`）；失败 = {error}(+transient)。 */
export const machineToolResponseSchema = z.union([
  machineOkResponseSchema,
  machineToolRelayResponseSchema,
]);

/** GET /api/machine/token/{stepId}——per-step 凭证下发（02 §5.4/§8：模型
 * key + 托管 repo git 凭证 + 团队密钥取用面，daemon 内存持有不落盘常驻）。
 * 响应形状 [设计]（端点名 + git fetch 无凭证失败旁证，r3 §1.6）。 */
export const machineTokenResponseSchema = z.object({
  /** 该步 Agent 的 provider 配置（apiKey 内存态经 SecretBox 解密下发，02 §8
   * 运行时层；无 key 网关可留空 = r3 §2 表单语义）。 */
  provider: providerConfigSchema.nullable(),
  /** 本步可取用的团队密钥（名字 → 明文；服务端解析契约 = M2c
   * services/credentials.ts）。明文只出现在本返回值（02 §8 纪律），且**不得**
   * 铺进 agent 进程环境——daemon 持有真值，agent 经本地取用通道显式取用。
   * 按 step kind 收窄：plan/review/chief 步恒空（records/step.ts
   * stepTakesSecrets）。 */
  secrets: z.record(z.string(), z.string()),
  /** 托管 repo git 凭证（02 §3/§5.4：per-step 注入；接线随 git 面）。 */
  git: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .nullable(),
});
export type MachineTokenResponse = z.infer<typeof machineTokenResponseSchema>;

/** POST /api/machine/upload-urls/{stepId}——预签名产物上传（r3 §1.6 观测
 * 存在）；self-host 无对象存储 = server 自出一一次性 PUT URL [设计]。 */
export const machineUploadUrlsBodySchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().min(0).optional(),
    }),
  ),
});
export const machineUploadUrlsResponseSchema = z.object({
  uploads: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
    }),
  ),
});
export type MachineUploadUrlsResponse = z.infer<typeof machineUploadUrlsResponseSchema>;

/** transcript 上传件（PUT upload url 的 body）[设计]：终稿消息行集，id 幂等
 * （工具行 id = toolCall id，与 tool/{stepId} live 回传去重）。 */
export const transcriptUploadSchema = z.object({
  stepId: recordId,
  messages: z.array(
    z.object({
      id: z.string(),
      role: messageRoleSchema,
      content: z.unknown(),
      createdAt: epochMs,
    }),
  ),
});
export type TranscriptUpload = z.infer<typeof transcriptUploadSchema>;

/** findingsError（#700 B-C13）长度上限：daemon 组装侧截断在 500 字符内，
 * 本值 = schema 面第二道闸（同 SHELL_OUTPUT_CHAR_LIMIT 之律，防 bug
 * daemon 单条打爆 DB）。 */
export const FINDINGS_ERROR_CHAR_LIMIT = 2_000;

/** #1261 配额熔断结构化信号（quotaBlock 形态）：daemon 对 quota/capacity
 * 分桶命中的步收尾携带。kind 两值 = 分类桶的前两档（quota = 额度空 /
 * capacity = 限流——恢复语义分道：限流带 Retry-After 短窗，额度等充值）。
 * providerId = 「哪一路 relay」（`<providerId>/<modelId>` 串的 provider 段，
 * 板面显示面）。reason = 信号原文（截断 500 字符，诊断回查）。 */
export const quotaBlockSchema = z.object({
  kind: z.enum(['quota', 'capacity']),
  providerId: z.string(),
  label: z.string().optional(),
  reason: z.string().max(500),
  retryAfterMs: z.number().int().positive().optional(),
});
export type QuotaBlock = z.infer<typeof quotaBlockSchema>;

/** POST /api/machine/done/{stepId}——步骤收尾 body [推断]（02 §5.4 端点名；
 * status 词 = 步级失败无自动重跑语义的最小三值，02 §4.2）。
 * M7 #330：审核步终态可携带 findings（reviewVerdict 形态，shared 单源）——
 * daemon 在 agent 终轮文本里解析 JSON 结构，server 侧 zod 校验后 emit
 * REVIEW_VERDICT_KIND 消息行 + 触发 blocking 自动修订回路；非 review 步
 * = 该字段不携带（DAEMON 不解析非 review 类 agent 输出，规避假阳）。 */
export const machineDoneBodySchema = z.object({
  status: z.enum(['success', 'failed', 'stopped']),
  errorMessage: z.string().optional(),
  /** pi 会话标识（continue session 复用面：合并轮/重规划轮，02 §4.2）。 */
  sessionId: z.string().optional(),
  /** per-model 用量（token_usage 记账，02 §6.2/r3 §3.8）。 */
  usage: z.array(modelUsageSchema).optional(),
  /** review 列位双键之一（02 §4.1/r5 §8）。 */
  hasChanges: z.boolean().optional(),
  /** 工作分支偏离（#1195）：daemon 步收尾发现 HEAD 停在契约分支之外的具名
   * 分支时携带（expected = 会话分支，actual = 实际 HEAD 分支；detached HEAD /
   * 查询失败不携带）。消费面 = server 产物闸 2：hasChanges=false 时失败原因
   * 点名分支偏离而非误导性「构建零改动」；hasChanges=true 时不参与判定
   * （产物并集面已认领交付，偏离可见性归 transcript 行与 PR 面板）。 */
  workBranchDrift: z.object({ expected: z.string().min(1), actual: z.string().min(1) }).optional(),
  /** 步收尾时 conv 分支 HEAD sha [设计]（M3b）：per-step checkpoint 数据源
   * （「恢复到此处」r3 §3.5/02 §4.2）+ 合并步 fast-forward 落地键
   * （「目标提交 <12hex>」r3 §3.9 面板同族）。 */
  commit: z.string().optional(),
  /** AI 审核步 findings（M7 #330，r8 §3.1）：仅 review 步携带，daemon 解析
   * agent 终轮 JSON 输出后置入；server 落库 + 判 blocking 触发自动修订。
   * 形状 = records/review.ts reviewVerdictSchema（conclusion + findings[]）。 */
  findings: reviewVerdictSchema.optional(),
  /** AI 审核步 verdict 提取失败原因（#700 B-C13）：review 步 daemon 未能从
   * transcript 取出合法 verdict 时随 done 携带（findings 缺位；两字段互斥，
   * 同现 = 新 daemon 对旧 server 的无害冗余，findings 优先）。server 据此
   * 把 verdict 消息兜底拆成两态：「判定提取失败」+ extractionError 原因上
   * 浮（web 审核面可分辨提取器失败），两字段皆缺（旧 daemon 无信号）才落
   * 「审核未返回结论」。非 review 步不携带。长度上限 = schema 面第二道闸
   * （daemon 侧已截断，防 bug daemon 单条打爆 DB）。 */
  findingsError: z.string().max(FINDINGS_ERROR_CHAR_LIMIT).optional(),
  /** PR 回填（#704 / B-C16，Multica link-back 只读方向）：github 形态步收尾
   * 时 daemon 只读探测 conv 分支上的 PR（机器 gh / per-step token / 匿名三
   * 梯，单次有界），探测命中才携带——无 PR / 探测失败 = 缺席（面板分支名在、
   * PR 槽留空，不造数据、不重试）。server 落 build.prUrl/prNumber 并发布。 */
  prUrl: z.string().optional(),
  prNumber: z.number().int().optional(),
  /** 变更投影上报（#704 失败方式 5：非 hosted 形态投影真值源 = daemon 步
   * 收尾上报）：conv 分支相对 origin/<default> 的 unified diff 原文。daemon
   * 侧受 CHANGES_DIFF_MAX_BYTES 上限（超限缺席——投影回落空集而非半截假象）；
   * server parseUnifiedDiff 解析后落 build.changes 列，readBuildChanges 非
   * hosted 分支消费。hosted 形态真值源仍是 server bare repo，daemon 不上报
   * （双真值源漂移面不引入）。 */
  changesDiff: z.string().optional(),
  /** 验证步 verdict（#1250 / ADR 0018 层 1）：仅 verify 步携带，daemon 解析
   *  agent 终轮 JSON 输出后置入；server 落 VERIFY_VERDICT_KIND 消息行。
   *  形状 = records/verify.ts verifyVerdictSchema（passed + conclusion +
   *  evidence[]）。非 verify 步不携带（findings 的 review 律——解析面按步类
   *  开，规避假阳）。 */
  verifyVerdict: verifyVerdictSchema.optional(),
  /** 验证步 verdict 提取失败原因（#1250，findingsError 同律）：verify 步
   *  daemon 未能从 transcript 取出合法 verdict 时随 done 携带（verifyVerdict
   *  缺位）。server 据此落「验证判定提取失败」兜底消息，不静默吞错。长度
   *  上限同 findingsError（schema 面第二道闸）。 */
  verifyVerdictError: z.string().max(FINDINGS_ERROR_CHAR_LIMIT).optional(),
  /** #1261 配额熔断信号：daemon 识别 quota/capacity（分类单源 =
   * shared/task-failure.ts）后随 done 携带——server 据此挂起「等额度」
   * （step waiting_quota + 通知 + 探测续跑），而非走 failed 漏斗判死。
   * status 仍为 'failed'（旧 server zod strip 掉本字段 = 普通失败收尾，
   * 混版本零破坏；同 findingsError 的无害冗余律）。空流/非配额错误不携带
   * （分类面不猜——不可见即污染可观测性）。 */
  quotaBlock: quotaBlockSchema.optional(),
});
export type MachineDoneBody = z.infer<typeof machineDoneBodySchema>;
export const machineDoneResponseSchema = machineOkResponseSchema;

/** changesDiff 上报字节上限（#704）：daemon 与 server 双侧同吃——daemon 超
 * 限不上报，server 收到超限载荷丢弃（两道闸都不打爆 done 通道与 DB）。取值
 * 对齐 diff 全文闸门 DIFF_FILE_MAX_BYTES 量级（1 MiB 的一半），单步 diff 超
 * 此值时投影按「未知」回落空集，PR 面板仍有 GitHub 链接兜底。 */
export const CHANGES_DIFF_MAX_BYTES = 512 * 1024;

// —— machine shell 预检/回写（XMON-108 R1 [设计]，MACHINE_WIRE_EXTENSIONS
//    登记位）—————————————————————————————————————————————————————————————

/** 预检 body 命令长度上限：命令行字符串进审计行（daemon 发什么记什么，
 * server 不截断命令——截断后的命令在审计上就不是它跑过的命令）。超限 = 400
 * （异常形，daemon 侧按预检失败处理，不当「未授权」回报 agent）。 */
export const SHELL_COMMAND_CHAR_LIMIT = 10_000;

/** 回写 output 长度上限：daemon 截断（带截断标记，R2 面）后仍不得超本值
 * ——schema 面第二道闸（防 bug/越权 daemon 单条命令打爆 DB）。同律适用
 * errorMessage。 */
export const SHELL_OUTPUT_CHAR_LIMIT = 100_000;

/** POST /api/machine/shell/{stepId} body（daemon 执行前预检）：command =
 * 将要 `bash -lc` 的命令原文——审计行先于放行落库（未授权命令从未跑过），
 * 故命令必须随预检上行。 */
export const machineShellPrecheckBodySchema = z.object({
  command: z.string().min(1).max(SHELL_COMMAND_CHAR_LIMIT),
});
export type MachineShellPrecheckBody = z.infer<typeof machineShellPrecheckBodySchema>;

/** 预检响应：2xx ⇔ allowed（拒绝 = HTTP 403 {error}，requestMerge 403 先例
 * 同形——daemon 按 non-2xx 取 error 文本回报 agent，密钥通道「未授权」同律）。
 * runId = 审计行 id（结果回写键），仅放行时下发。 */
export const machineShellPrecheckResponseSchema = z.object({
  allowed: z.literal(true),
  runId: recordId,
});
export type MachineShellPrecheckResponse = z.infer<typeof machineShellPrecheckResponseSchema>;

/** POST /api/machine/shell/{runId}/result body（daemon 执行后回写）：
 * done = 进程跑完（exitCode 任意值均合法——退出码是命令结果，非执行失败；
 * 可缺省 = daemon 拿不到退出码的形态）；failed = 执行未完成（spawn 失败/
 * 超时杀进程组，超时原因走 errorMessage，R2 面约定）。output = 截断后的
 * 命令输出。终态（done/failed）只写一次；重复回写（网络重试丢响应）=
 * 幂等 200 不改行（branch-sync transitionBranchSync 同律）。 */
export const machineShellResultBodySchema = z.object({
  status: z.enum(['done', 'failed']),
  exitCode: z.number().int().optional(),
  output: z.string().max(SHELL_OUTPUT_CHAR_LIMIT).optional(),
  errorMessage: z.string().max(2_000).optional(),
});
export type MachineShellResultBody = z.infer<typeof machineShellResultBodySchema>;

export const machineShellResultResponseSchema = machineOkResponseSchema;

/** GET /api/machine/skills/{stepId} 响应（#920 清单 + 按需拉，
 * MACHINE_WIRE_EXTENSIONS 登记位 [设计]）：每技能 = record 三字段 +
 * dirName（盘位目录名）+ 文件清单（path 相对技能目录、posix 分隔；
 * sizeBytes = 盘上字节数；sha256 = 内容 hash）。文件本体经
 * GET /api/machine/skills/{stepId}/file 按需拉取——daemon 只拉本地缺失或
 * hash 不同的文件，单请求预算与库总量解耦（旧「一次 GET 塞全量全文」的
 * 512KB/2MB 整包字节闸即 #920 根因：真实技能库 18MB 必超、分发从未成功）。
 * selection 区分出包语义：chief 步 = 'all'（信任面全量现扫），worker 步 =
 * 'whitelist'（agent.skillsAllowlist 白名单交集）或不限制 agent 的 'all'
 * （skillsAllowlist=null → 全量现扫，#1169）；空清单时 daemon 据此点名语境。
 * 完整性 = 逐文件 sha256 + sizeBytes 双校验（materializeTeamSkills）。 */
export const machineSkillsManifestResponseSchema = z.object({
  selection: z.enum(['all', 'whitelist']),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      dirName: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          sizeBytes: z.number().int().min(0),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      ),
    }),
  ),
});
export type MachineSkillsManifestResponse = z.infer<typeof machineSkillsManifestResponseSchema>;

/** GET /api/machine/attachment/{stepId}/{attachmentId} 响应（#730 [设计]
 * MACHINE_WIRE_EXTENSIONS 登记位）：daemon 侧图片交付的下载面——ownedStep
 * 校验（本机步）+ 附件 team 归属校验（跨 team 404）+ ready 状态闸（pending/
 * failed = 409 原因带状态词）。base64 载荷与既有工具面 readAttachmentMeta
 * 同形（10MiB cap = 内存预算上界，同律）。 */
export const machineAttachmentResponseSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  contentBase64: z.string(),
});
export type MachineAttachmentResponse = z.infer<typeof machineAttachmentResponseSchema>;

/** 词表外 [设计] 附加端点（wire diff 白名单化用，04 §1/§3 divergence 登记
 * 机制同族）：upload-urls 预签名的落地点——self-host 无对象存储，server 自出
 * 一次性 PUT URL。非协议面外扩：13 端点词表（MACHINE_ENDPOINTS）不改形状，
 * 本表逐条带登记理由；server 路由面对拍测试单源消费。 */
export const MACHINE_WIRE_EXTENSIONS = [
  {
    method: 'POST',
    path: '/api/machine/enroll/confirm',
    reason: '[设计] W4 #285 浏览器授权流完成面（授权页用户确认；capability=enrollId）',
  },
  {
    method: 'GET',
    path: '/api/machine/steer',
    reason: '[设计] W3 steer 拉取-确认（06 册 D9；claimed 步单槽 pending，?stepId=）',
  },
  {
    method: 'GET',
    path: '/api/machine/stop',
    reason: '[设计] M7 #308 stop 拉取-确认（停止钮单槽 pending，?stepId=；steer 同律）',
  },
  {
    method: 'POST',
    path: '/api/machine/ask/{stepId}',
    reason:
      '[设计] #1049 结构化问答阻塞通道（ask_user 升级；requestId 幂等 + hold 长轮询 ~70s 到期回 pending；响应 machineAskResponseSchema）',
  },
  {
    method: 'GET',
    path: '/api/machine/skills/{stepId}',
    reason:
      '[设计] XMON-109 S1 技能分发清单（spec 14 daemon 注入契约的 S2 消费位；#920 改清单 + 按需拉：selection all/whitelist + 逐文件 sizeBytes/sha256；响应 machineSkillsManifestResponseSchema）',
  },
  {
    method: 'GET',
    path: '/api/machine/skills/{stepId}/file',
    reason:
      '[设计] #920 技能单文件按需拉取（?dirName=&path=；raw bytes application/octet-stream；清单外/白名单外/逃逸形一律 404 不泄存在性）',
  },
  {
    method: 'GET',
    path: '/api/machine/attachment/{stepId}/{attachmentId}',
    reason:
      '[设计] #730 daemon 侧图片附件下载（ownedStep + team 归属 + ready 闸；base64 载荷响应 machineAttachmentResponseSchema）',
  },
  {
    method: 'PUT',
    path: '/api/machine/upload/{uploadId}',
    reason: '[设计] upload-urls 预签名落地（self-host 无对象存储）；一次性 uploadId',
  },
  {
    method: 'POST',
    path: '/api/machine/sync-result/{syncId}',
    reason:
      '[设计] M7 #319 分支对话框「同步到机器」daemon 回写结果（08 册附录 B；状态机 pending→running→synced/failed）',
  },
  {
    method: 'POST',
    path: '/api/machine/shell/{stepId}',
    reason:
      '[设计] XMON-108 R1 机器 shell 每调用预检（双开关复核 + 审计行先于放行 + runId 下发；拒绝 = 403）',
  },
  {
    method: 'POST',
    path: '/api/machine/shell/{runId}/result',
    reason:
      '[设计] XMON-108 R1 daemon 回写 shell 执行结果（exitCode/截断输出；终态 done/failed 只写一次）',
  },
] as const;

/** 机器面 wire 对拍表（04 §3：端点路径/动词/请求/响应形状逐字段进 CI）。
 * 路径单源 = MACHINE_ENDPOINTS（machine-api.ts）；本表 = 动词 + schema 面，
 * `{stepId}` 归一同 02 §6.1 记法。 */
export const MACHINE_WIRE = [
  {
    method: 'POST',
    path: '/api/machine/enroll',
    request: machineEnrollBodySchema,
    response: machineEnrollResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/enroll/start',
    request: machineEnrollStartBodySchema,
    response: machineEnrollStartResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/enroll/poll',
    request: machineEnrollPollBodySchema,
    response: machineEnrollPollResponseSchema,
  },
  { method: 'GET', path: '/api/machine/me', response: machineMeResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/presence',
    request: machinePresenceBodySchema,
    response: machineOkResponseSchema,
  },
  { method: 'POST', path: '/api/machine/recover', response: machineRecoverResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/tasks/claim',
    request: machineClaimBodySchema,
    response: machineClaimResponseSchema,
  },
  { method: 'GET', path: '/api/machine/stream', response: machineStreamEventSchema },
  {
    method: 'POST',
    path: '/api/machine/heartbeat/{stepId}',
    response: machineHeartbeatResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/tool/{stepId}',
    request: machineToolBodySchema,
    response: machineToolResponseSchema,
  },
  { method: 'GET', path: '/api/machine/token/{stepId}', response: machineTokenResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/upload-urls/{stepId}',
    request: machineUploadUrlsBodySchema,
    response: machineUploadUrlsResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/done/{stepId}',
    request: machineDoneBodySchema,
    response: machineDoneResponseSchema,
  },
] as const;
