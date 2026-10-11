// step 单会话执行（03 M3a：claim → pi 会话 → transcript 回传落库）。
// 生命周期日志行序 canon = 02 §5.7（`step <id> for conv <uuid> (n running)`
// → `using model <provider>/<modelId>` → workspace 准备 → `new session <convId>`
// / `continue session <convId>` → `finished (m running)`；`pushed <convBranch>`
// 行属 git 面，归 M3b）。
// journal 状态机（02 §5.4 recover 细节 [推断] = 04 附录 A 自定等价物）：
// claimed → running → awaiting-upload →（done | failed）；中断残留由
// machine-loop recover 面对账续跑。

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  AgentTokenUsage,
  ClaimedStep,
  CommitIdentity,
  DeliveredImage,
  LocalToolDef,
  MachineAskBody,
  MachineDoneBody,
  PreparedWorkspace,
  ProviderConfig,
  SessionOpts,
  TranscriptUpload,
  WorktreeOps,
} from '@pacman/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  CHANGES_DIFF_MAX_BYTES,
  CONTINUE_PROMPTS,
  classifySkillFact,
  composeTaskPromptWithInstruction,
  FIXED_TAGS,
  isBackendRuntimeId,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  PLAN_FILE_NAME,
  parseReviewPromptMeta,
  REMOTE_TOOL_RETRY_DELAYS_MS,
  RESUME_FRESH_SESSION_NOTE,
  type ReviewGate,
  STREAM_TIMEOUTS_MS,
  skillCallName,
  stepTakesSecrets,
  transcriptPromptRowId,
  transcriptResumeNoteRowId,
} from '@pacman/shared';
import { createActivityTracker } from './activity.js';
import { SessionNotResumableError } from './backend/errors.js';
import { notInConfigLine, resolveMcpEndpoints } from './backend/mcp-config.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import { type BriefHandle, caseInsensitiveFsFor, cleanupBrief, writeBrief } from './brief-file.js';
import {
  type ClaudeCodeAuthProbe,
  claudeCodeAuthFailureMessage,
  probeClaudeCodeAuth,
} from './claude-code-auth.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { githubRepoRefOf, probeGithubPr } from './github-probe.js';
import { type StepJournal, type StepJournalEntry, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { isTransientUploadError, type MachineApi } from './machine-client.js';
import { extractReviewVerdict } from './review-findings.js';
import { buildSecretTool } from './secret-channel.js';
import { type SealedSegment, SegmentBuffer, segmentContent } from './segment.js';
import { buildRemoteShellTool } from './shell-channel.js';
import type { StatePaths } from './state.js';
import { resolveStepImages } from './step-attachments.js';
import { buildCreateTagTool } from './tag-tool.js';
import { materializeTeamSkills } from './team-skills.js';

/** 停止请求（M7 #308）：discard = 确认弹层「丢弃本轮修改」勾选位——
 * true 时收尾 rewind worktree 到步起点 checkpoint（r9 §3.3）。 */
export interface StopRequest {
  discard: boolean;
}

export interface RunStepDeps {
  client: MachineApi;
  journal: StepJournal;
  /** per-step 后端解析（spec 17 A3 唯一分叉点）：入参 = claim 载荷的
   * agent.provider 原值（null / custom provider id / runtime 身份），
   * runtime 身份（∈ BACKEND_RUNTIME_IDS）→ claude-code 后端，否则 → pi。
   * machine-loop 注入（懒初始化 registry）；单测注入固定值。 */
  backendFor: (agentProviderId: string | null | undefined) => AgentBackend;
  logger: DaemonLogger;
  paths: StatePaths;
  workspacesDir: string;
  /** 本机 MCP config 路径（spec 13/#368：claim slug 列表在此解析成执行
   * 端点；machine-loop 从 config.mcpConfigPath 注入）。 */
  mcpConfigPath: string;
  /** worktree 契约面（02 §5.5；machine-loop 注入共享实例——projectLock 跨步
   * 串行化需要单例）。缺省且步带 repo 绑定 = 配置错误，按 failed 收尾。 */
  workspace?: WorktreeOps;
  /** 在跑 session 句柄注册表（W3 #279 steer 投递面）：machine-loop 持有，
   * runStep 装卸（handle 创建即注册、各收尾路径注销），machine-loop 的
   * deliverSteer 按 stepId 消费。缺省 = 无 steer 面（单测形态）。 */
  sessionHandles?: Map<string, AgentSessionHandle>;
  /** 停止请求旗标（M7 #308 stop 投递面）：machine-loop deliverStop 拉取-
   * 确认后置位，runStep 事件流结束后消费判 stopped 收尾。缺省 = 无 stop
   * 面（单测形态）。 */
  stopRequests?: Map<string, StopRequest>;
  /** heartbeat 节奏 [设计]（r3 未采具体值；presence 同族 ~30s）。 */
  heartbeatIntervalMs?: number;
  /** 本机机器名（#867 T6：缺凭据失败文案的「哪台机器」位；缺省 os.hostname()）。 */
  machineName?: string;
  /** claude-code 凭据预检（#867 T6；缺省 = 真探针 `claude auth status`，
   * machine-loop 不覆写，单测注入固定三态）。 */
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  now?: () => number;
}

export interface RunStepOptions {
  /** recover 续跑：已有 journal 条目（continue session 解析用）。 */
  resume?: { sessionId: string | null; prompt: string | null };
  /** 已认领的运行数（canon 行 `(n running)` 的 n）。 */
  running?: number;
  /** #1148 步级 env 注入（worker 步端口基座 PACMAN_PORT_BASE；machine-loop
   * 按槽位构造）——透传 SessionOpts.env（backend 注入 agent 进程命令环境）。
   * chief 步不携带（不占槽）。 */
  env?: Record<string, string>;
  /** 零进展 auto_retry 预算覆盖（#708 测试注入；缺省 = RETRY_STORM_MAX）。 */
  retryStormMax?: number;
  /** 流超时三臂覆盖（测试注入毫秒级；缺省 = 02 §5.6 r3 三值）。 */
  streamTimeouts?: { first: number; idle: number; body: number };
  /** 步级流时长上界覆盖（测试注入；缺省 = env PACMAN_STREAM_DURATION_CAP_MS
   * 或 STREAM_DURATION_CAP_DEFAULT_MS）。 */
  streamDurationCapMs?: number;
}

/** auto_retry 有界生命周期预算（#708 失败方式 2）——单源与理据正本见 backend/pi-retry.ts
 *  （#926：与 pi 会话 retry.maxRetries 同源派生，不再各处硬编码）。runner 侧行为：连续零进展
 *  重试超预算 → 停会话、根因直报、failed 收尾；每轮发数钉死 = 1 + RETRY_STORM_MAX（首轮 +
 *  预算内重试）。在此 re-export 供既有消费面（runner 内部 + 测试）沿用 '../src/runner.js' 入口。 */
export { RETRY_STORM_MAX };

/** 超时收尸文案与根因组合（#708 失败方式 1）：终态错误优先级 = 真实终态
 * 错误 > 超时文案；两者并存时组合成文（票面例「stream timeout；根因: 400 …」），
 * 不静默丢根因。根因只认结构化错误面（pi 错误对象消息——失败方式 4，不做
 * 字符串猜测）。纯函数；#699 的分臂文案（streamTimeoutMessage）产出后经
 * 本函数与根因组合，两票在同一收尾点汇流。 */
export function combineTimeoutWithRootCause(timeoutText: string, rootCause: string | null): string {
  return rootCause !== null ? `${timeoutText}；根因: ${rootCause}` : timeoutText;
}

/** 步级流时长绝对上界默认值（#699 失败方式 3）：body 臂改事件重置后，步
 * 总时长的唯一不事件化护栏——兜住「日志噪声 / 费用失控」的完全无上界步。
 * 3600s = 真实任务常态（>9 分钟的规划/审核步）之上、费用失控之下。 */
export const STREAM_DURATION_CAP_DEFAULT_MS = 3_600_000;

/** 上界 env 旋钮（#699：可配绝对上界）；非法/非正值回落默认值——0 不是
 * 「拆墙」出口，墙保持是墙。 */
export const STREAM_DURATION_CAP_ENV = 'PACMAN_STREAM_DURATION_CAP_MS';

function envDurationCapMs(env: NodeJS.ProcessEnv): number | null {
  const raw = env[STREAM_DURATION_CAP_ENV];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** 流超时触发臂（#699 失败方式 4）：first = 首事件期限、idle = 事件间空闲、
 * body = 流 body 预算、duration = 步级绝对上界。 */
export type StreamTimeoutArm = 'first' | 'idle' | 'body' | 'duration';

/** 超时收尾文案（#699 失败方式 4）：指名触发臂与各自数值——build.errorMessage
 * 携带本文案，相位面看到的是真凶，不是笼统的 stream timeout。 */
export function streamTimeoutMessage(
  arm: StreamTimeoutArm,
  timeouts: { first: number; idle: number; body: number; durationCap: number },
): string {
  const value =
    arm === 'first'
      ? timeouts.first
      : arm === 'idle'
        ? timeouts.idle
        : arm === 'body'
          ? timeouts.body
          : timeouts.durationCap;
  const label = arm === 'duration' ? 'cap' : arm;
  return `stream timeout (arm=${arm}, ${label}=${value}ms)`;
}

/** 任务文本（M3a 骨架 [设计]：title + spec 原文，文本单源 = shared
 * buildTaskPromptText——web transcript 过滤侧按同一合成式识别本行，#612；
 * plan.md 产出/git 面归 M3b，驳回 feedback / 合并指令等续轮 prompt 由调用方
 * 经 resume.prompt 传入）。chief 步无 todo → 用 server 合成的 instruction
 * （用户消息/wake 事实）。#720：new session + instruction 在位（失败重启轮，
 * claim 载荷透出 step.prompt）→ 组合串投递（任务文本 + 指令，形状单源 =
 * shared composeTaskPromptWithInstruction，裁决正本 = issue #720 裁决评论）
 * ——此前 instruction 只落 DB 行给 UI 看，用户填的返工理由 agent 从来看不到。
 * 指令缺席或空白 = 纯任务文本（build 步现行行为，负例：不注入空指令）；
 * 投递机制沿 #703/#719 的形状（instruction 在位即投递），不为 new session
 * 造第二套。#1025：plan 步指令缺席（首轮规划）→ 注入 plan.md 契约指令
 * （shared buildPlanFirstRoundInstruction 单源）——此前契约只存在于纠错
 * 提示词（补写轮/重规划/审核打回/重启），首轮 agent 只拿到 title+spec，
 * 写不写全凭模型自觉（#892 实测 28 build / 0 行 plan.md 的结构性根因）；
 * 纠错轮 instruction 自带契约句，走组合分支不叠注。 */
export function buildTaskPrompt(claimed: ClaimedStep): string {
  const todo = claimed.todo;
  if (!todo) return claimed.instruction ?? '';
  const taskText = buildTaskPromptText(todo.title, todo.spec);
  // 缺席归一（zod optional：无该字段 = undefined ≠ null）。
  const instruction = claimed.instruction ?? null;
  if (instruction !== null && instruction.trim() !== '') {
    return composeTaskPromptWithInstruction(taskText, instruction);
  }
  if (claimed.step.kind === 'plan') {
    return composeTaskPromptWithInstruction(taskText, buildPlanFirstRoundInstruction());
  }
  return taskText;
}

// continue session 续轮指令 = shared CONTINUE_PROMPTS 单源（#612 起 web
// transcript 过滤侧消费同一词表——合成指令不再冒名用户气泡）。语义备注：
// chief 续轮 = wake 事实走 instruction，表内 chief 值不用（占位保全键）；
// review（M7 #312）首轮由 server instruction 注入（含 plan.md 全文 + 用户
// focus），continue 路径不被使用——审核步是额外 agent 步，不接续到主 conv
// 会话（#511 起 server 侧恒下发 session.action='new'，runner 侧 review 走
// instruction 分支，双保险）。

/** 任务元信息注入的项目形态面（#446 / ADR 0005 分叉律；claim 载荷
 * todo.meta 同形投影）：github 形态携带——词表 = 项目标签集镜像（仓库
 * label 同步行，server claim 时现取），多枚可贴；缺省 = local/hosted 现
 * 行为（FIXED_TAGS 单标签 + 占位回填，文本逐字节不变）。 */
export interface TaskMetaForm {
  /** 项目标签集镜像的 name 列（claim 载荷 todo.meta.vocab 同形子集；
   * titleFinal 的短路面在 taskMetaOpts，不进文本合成）。 */
  vocab: readonly { name: string }[];
}

/** 任务元信息回填指令（spec 15 #394 / ADR 0002 D3 + #446 / ADR 0005）：
 * worker 步带 todo 语境时注入 systemPrompt。meta 缺省 = local/hosted 形态：
 * 词表与含义 = shared FIXED_TAGS 单源（改一处全链路生效）、至多 1 个。
 * meta 携带 = github 形态：词表 = 镜像行 name 列表（含义就在名字里，仓库
 * 真值不加注释）、tags 多枚可贴；空词表 = 项目尚无镜像行，明说无标签可贴
 * （不渲染空列表误导 agent）。回填失败不阻断 build（relay 拒绝/传输失败
 * 只是少一次元信息更新，占位标题继续服役）。currentTitle = 当前占位标题
 * （agent 对照参照物）。 */
export function composeTaskMetaInstruction(currentTitle: string, meta?: TaskMetaForm): string {
  if (meta === undefined) {
    const vocab = FIXED_TAGS.map((t) => `- ${t.name}：${t.description}`).join('\n');
    return `## 任务元信息\n本任务当前标题是占位截断：「${currentTitle}」。正式开工前，先调用一次 \`set_task_meta\` 工具回填元信息：\`title\` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）；\`tag\` = 从下面的固定词表选至多 1 个最贴切的类别，判不出就不传 \`tag\`：\n${vocab}`;
  }
  const tagInstruction =
    meta.vocab.length > 0
      ? `\`tags\` = 从下面的项目标签词表选贴切的类别（可多选，判不出就不传 \`tags\`）：\n${meta.vocab
          .map((t) => `- ${t.name}`)
          .join('\n')}`
      : '本项目当前没有可用标签，不传 `tags`。';
  return `## 任务元信息\n本任务当前标题是占位截断：「${currentTitle}」。正式开工前，先调用一次 \`set_task_meta\` 工具回填元信息：\`title\` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）；${tagInstruction}`;
}

/** todo 语境 → taskMeta 注入位（#446 / ADR 0005 D5）：meta.titleFinal =
 * issue 来源标题已真值、标签已导入 → 整段元信息指令不注入（回填反而覆盖
 * 真值）；否则 currentTitle + 形态 meta 原样透传（meta 缺省 = local 词表
 * 现行为）。chief 步无 todo → undefined。 */
function taskMetaOpts(
  todo: ClaimedStep['todo'],
): { taskMeta: { currentTitle: string; meta?: TaskMetaForm } } | undefined {
  if (!todo) return undefined;
  if (todo.meta?.titleFinal === true) return undefined;
  return {
    taskMeta: {
      currentTitle: todo.title,
      ...(todo.meta !== undefined ? { meta: todo.meta } : {}),
    },
  };
}

/** worker 步 systemPrompt = 职责文本 + 记忆注入（02 §4.4 读路径最小形；每步
 * 开跑注入该 Agent 记忆条目——注入形 [推断] 保留，触到即验证回写 04 附录 A）
 * + 任务元信息回填指令（spec 15 #394，todo 语境步开启；taskMeta.meta =
 * github 形态词表位，#446）。 */
export function composeWorkerSystemPrompt(
  description: string | null | undefined,
  memories: readonly { title: string; content: string }[] | undefined,
  opts?: { taskMeta?: { currentTitle: string; meta?: TaskMetaForm } },
): string | undefined {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (memories && memories.length > 0) {
    parts.push(`## 记忆\n${memories.map((m) => `- ${m.title}：${m.content}`).join('\n')}`);
  }
  if (opts?.taskMeta) {
    parts.push(composeTaskMetaInstruction(opts.taskMeta.currentTitle, opts.taskMeta.meta));
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/** hasChanges 判定 [推断骨架]（02 §4.1/r5 §8 列位双键；git diff 面归 M3b，
 * 当前 = transcript 含写类工具行）。匹配大小写归一：pi 工具名 edit/write/bash、
 * claude-code 后端透传 SDK 原名 Edit/Write/Bash（#703 闸 2 真值面——不归一会
 * 把 claude-code 无 repo 步的改动判成零）。 */
const CHANGE_TOOLS = new Set(['edit', 'write', 'bash']);

/** live transcript 文本增量转发节流窗口 [设计]（M5 live streaming；官方节奏
 * 不可观测——窗口取「肉眼成流、请求不成洪」的折中）。 */
const TRANSCRIPT_DELTA_FLUSH_MS = 250;

async function withRetries<T>(
  fn: () => Promise<T>,
  delaysMs: readonly number[],
  logger: DaemonLogger,
  label: string,
): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i <= delaysMs.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = delaysMs[i - 1];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // 重试预算耗尽：原因上浮日志（不再静默吞错）。
  logger.step(
    `${label} retry exhausted: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
  return null;
}

export async function runStep(
  deps: RunStepDeps,
  claimed: ClaimedStep,
  opts: RunStepOptions = {},
): Promise<void> {
  const { client, journal, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const stepId = claimed.step.id;
  const convId = claimed.conversationId;
  const running = opts.running ?? 1;
  logger.raw(`step ${stepId} for conv ${convId} (${running} running)`);

  // 步活动相位上报（#905）：黑盒窗口（工作区准备 / 会话开启 / 模型思考 /
  // 工具执行）里 daemon 侧本就有事件到达，此前往 UI 一个都不转发。tracker
  // 无定时器（重发由真实流事件驱动，静默期零上报 = 「卡住」诚实可辨，
  // #471）；fire-and-forget——旧 server 对第四形 400 只警告一次，步不受影响。
  let activityRelayWarned = false;
  const activity = createActivityTracker({
    send: (report) => {
      client.activity?.(stepId, report)?.catch((err: unknown) => {
        if (activityRelayWarned) return;
        activityRelayWarned = true;
        logger.step(
          `activity relay failed (suppressed until next step): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    },
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });
  activity.setPhase('preparing');

  // chief 步（回合 = 机器 step，r5 §3.1）：任务文本 = server 合成的 instruction
  // （用户消息 / wake 事实），无 todo 语境；remoteTools relay + systemPrompt 走
  // chief 块。worker 步：title+spec 或续轮指令。review 步（#511）= server 合成
  // 的审核材料（meta + 输出契约 + 方案全文 + 变更），同 chief 走 instruction。
  const isChief = claimed.step.kind === 'chief';
  const isReview = claimed.step.kind === 'review';
  // 关口（#511）：step 表无相位列，prompt 的 meta 头即是它的持久载体。缺省
  // （无该字段的存量 prompt）= confirm 语义——不开检出、材料不含变更。
  const reviewGate: ReviewGate =
    (isReview ? parseReviewPromptMeta(claimed.instruction ?? null)?.gate : undefined) ?? 'confirm';
  const prompt =
    opts.resume?.prompt ??
    (isChief || isReview
      ? (claimed.instruction ?? '')
      : claimed.session.action === 'continue' && claimed.session.sessionId
        ? // #703 续轮指令投递：claim 载荷 instruction 在位（补写轮 #113 /
          // 驳回重规划 r5 §4 / 失败重启反馈）→ 真的进会话——此前一律发
          // CONTINUE_PROMPTS 占位句，补写轮拿不到「写 plan.md」指令（B-C10
          // 两轮全空同源）。缺省回落词表（合并轮/确认后执行轮等无指令续轮）。
          (claimed.instruction ?? CONTINUE_PROMPTS[claimed.step.kind])
        : buildTaskPrompt(claimed));

  // journal：claimed（recover 面即时落盘，02 §5.4）。
  journal.claim({
    stepId,
    buildId: claimed.step.buildId,
    kind: claimed.step.kind,
    conversationId: convId,
    sessionAction: claimed.session.action,
    sessionId: opts.resume?.sessionId ?? claimed.session.sessionId,
    prompt,
    claimed,
  });

  // —— #730 图片附件解析下载（prompt 面）：整行 `![name](attachment:key)`
  // token → 内联像素交付。边界（票面）：chief 步不经本机制（chief instruction
  // 无附件入口）；review 步材料同 string 缝，解析对无 token 文本零触碰。
  // transcript/journal 侧恒原始文本（上方已落/将落）——web 渲染面 chip 不因
  // 展开丢；会话消费展开文本 + images。resolver 兜底 catch：解析器自身故障
  // 降级为原文交付（图片缺位但步不炸——下载失败的可视面已在 resolver 内）。
  let deliveryPrompt = prompt;
  let promptImages: DeliveredImage[] | undefined;
  if (!isChief && prompt !== null) {
    try {
      const resolved = await resolveStepImages({
        text: prompt,
        stepId,
        client,
        materializeDir: deps.paths.stepAttachmentsDir,
        log: (line) => logger.step(line),
      });
      deliveryPrompt = resolved.text;
      if (resolved.images.length > 0) promptImages = [...resolved.images];
    } catch (err) {
      logger.step(
        `attachment resolve failed (delivering raw text): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // per-step 凭证下发（02 §5.4/§8：内存持有，不落盘常驻；push_credential
  // 对照 = credentials.ts）。runtime 身份步（spec 17 A4：agent.provider ∈
  // BACKEND_RUNTIME_IDS）零凭据——认证机器本地（claude 登录或
  // ANTHROPIC_API_KEY），daemon 无可注入面；provider 槽 = inert 占位（满足
  // SessionOpts.provider 必填形状，claude-code 后端不消费）。runtime 分支
  // 权威短路 creds.provider：未升级 server 的 mixed-version 窗口里老 side 仍
  // fabricate 伪 api_key 配置，此处不透传伪语义。非 runtime 步逐字节保持
  // 原行为（creds.provider → agent.provider 回退）。
  const tokenRes = await client.token(stepId);
  const creds = pushCredential(tokenRes);
  const agent = claimed.agent;
  const runtimeId = isBackendRuntimeId(agent?.provider) ? agent.provider : null;
  // let（#654）：回落闸翻 compat 旋钮时重赋值（sessionOpts.provider 同步）。
  let provider: ProviderConfig | null =
    runtimeId !== null
      ? { kind: 'api_key', providerId: runtimeId }
      : (creds.provider ??
        (agent?.provider ? { kind: 'api_key', providerId: agent.provider } : null));
  // 守卫合并判据：runtime 步 provider 恒为 inert 占位（非 null），非 runtime
  // 步要求 creds/agent 兜底命中——`!provider` 单判据即覆盖两分支，且让 TS 收窄
  // 供 sessionOpts.provider（必填槽）。
  if (!agent?.modelId || !provider) {
    clearCredentials(creds);
    await failStep(
      deps,
      stepId,
      runtimeId !== null ? `${runtimeId} step has no model id` : 'no agent/model on claimed step',
    );
    return;
  }
  // 合并权限闸（XMON-77）：合并步收尾 = git merge + conv 分支 push（三形态
  // repo 落地都以推送为前置），Agent 必须同时持「合并分支」「推送分支」。闸在
  // 会话/工作区之前——无授权的合并不烧模型回合。tools 携带才判（claim 恒携
  // 含空数组）；缺省 = 老 server 版本墙 fail-open。
  const agentTools = agent.tools;
  if (claimed.step.kind === 'merge' && agentTools !== undefined) {
    const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentTools.includes(t));
    if (missing.length > 0) {
      clearCredentials(creds);
      await failStep(
        deps,
        stepId,
        `Agent 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），合并步拒绝执行`,
      );
      return;
    }
  }
  // —— #867 T6 跨机凭据预检（machine-execution-plane §4-9）：runtime 身份步
  // 认证 = 机器本地（A4 零凭据通道），daemon 无可注入面——机器没登录时 CLI
  // 把「Not logged in」当普通回答回给会话，result 帧 subtype 仍是 success。
  // 在开工作区/开会话之前探一次：明确未登录 → 步前显式失败（点名哪台机器 +
  // 缺哪类凭据 + 怎么补），不烧检出也不烧模型回合。探针说不清（CLI 不在
  // PATH / 超时 / 输出不可解析）不拦步——预检的假阳性会拦掉本可跑的任务，
  // 代价高于漏放，故 fail-open 落诊断行，运行期兜底见 backend/claude-code 的
  // result 分支（is_error 显式失败）。——
  if (runtimeId !== null) {
    const auth = await (deps.claudeCodeAuthProbe ?? probeClaudeCodeAuth)();
    if (auth.state === 'not-logged-in') {
      clearCredentials(creds);
      await failStep(deps, stepId, claudeCodeAuthFailureMessage(deps.machineName ?? hostname()));
      return;
    }
    if (auth.state === 'unknown') {
      logger.step(`claude-code auth probe inconclusive: ${auth.reason} (continuing)`);
    }
  }
  // canon 行（r3 §1.5）：runtime 步 = `claude-code/<modelId>`（inert 占位的
  // providerId 与 agent.provider 同值）；非 runtime 步不变。canon 行在
  // backendFor 解析后（失败方式 6：解析入参钉 agent.provider 原值）。
  const backend = deps.backendFor(agent?.provider);
  const modelKey = `${provider?.providerId ?? agent.provider}/${agent.modelId}`;
  logger.raw(`using model ${modelKey}`);

  // workspace 准备（02 §5.5 worktree 契约：基座 clone + `worktree add -b`；
  // 项目未绑 repo = 裸任务目录退化形 [设计]，M3a 兼容）。chief 步 = 只读探索，
  // 不开 worktree（不产可合并改动；仓库读经 remoteTools docs/projects relay，
  // 黑盒逼近 04 §1 A4）→ 裸任务目录。review 步（M7 #312 / #511）= 审核关口
  // 开**只读检出**：给它产物分支的检出，它才能回答「这段代码跑起来对不对」
  // ——只给 diff 文本只能回答「看起来对不对」。确认关口无产物可读 → 裸任务
  // 目录（不开工作区）。
  // repo 三形态同吃 worktree 契约（spec 12 G2-T2，契约零改动）：hosted =
  // http 远端 + per-step key；github = https 远端 + per-step x-access-token
  // （server 从 github_connection 下发）；local = cloneUrl 即用户仓库绝对路径
  // （git clone 本地路径默认硬链接，近零成本；凭证 null）。
  logger.workspace('准备工作区...');
  let ws: PreparedWorkspace | null = null;
  const checkout = isReview && reviewGate === 'review';
  const repo = isChief || (isReview && !checkout) ? null : (claimed.project?.repo ?? null);
  if (repo !== null) {
    if (!deps.workspace) {
      clearCredentials(creds);
      await failStep(deps, stepId, 'workspace ops unavailable for repo-bound step');
      return;
    }
    try {
      ws = await deps.workspace.prepare({
        projectId: claimed.project?.id ?? '',
        conversationId: convId,
        cloneUrl: repo.cloneUrl,
        workspacesRoot: deps.workspacesDir,
        credentials: creds.git,
      });
    } catch (err) {
      clearCredentials(creds);
      await failStep(deps, stepId, err instanceof Error ? err.message : String(err));
      return;
    }
  }
  const cwd = ws?.cwd ?? join(deps.workspacesDir, convId);
  if (!ws) mkdirSync(cwd, { recursive: true });

  // 步起点 head（M7 #308：停止 + 丢弃本轮修改的 rewind 目标 checkpoint——
  // prepare 后即时捕获，pi 会话期间的提交/脏树都在其上层）。
  let headAtStart: string | null = null;
  if (ws !== null && deps.workspace) {
    try {
      headAtStart = await deps.workspace.headCommit(ws.cwd);
    } catch {
      headAtStart = null; // 空基座等退化形：无可回退点，discard 降级为不清理
    }
  }

  // systemPrompt：chief = server 合成（charter + 资源清单 + 策略指引 + 记忆，
  // 02 §4.3）；worker = 职责文本 + 记忆注入（02 §4.4 读路径最小形，注入形 [推断]）
  // + 任务元信息注入。todo.meta.titleFinal（#446 / ADR 0005 D5）= issue 来源
  // 标题已真值、标签已导入——整段元信息指令短路不注入（回填反而会覆盖真值）。
  const systemPrompt =
    isChief && claimed.chief
      ? claimed.chief.systemPrompt
      : composeWorkerSystemPrompt(agent.description, agent.memories, taskMetaOpts(claimed.todo));
  // remoteTools：chief 步 = 49 词表全量；worker 步 = 记忆三件套 + 附件读
  // （02 §4.4/r5 §6 worker 写路径经 remoteTools relay；M4b 起服务端对 worker
  // 步同样下发；#310/r9 §3.1 worker attachment 工具 = spec `attachment:`
  // token 解析路径）。
  const remoteTools = claimed.remoteTools;
  // MCP per-turn 连接面（spec 13 slug 化）：claim 携带勾选 slug 列表，本机
  // config 解析实际端点（凭证值只活在执行机，从不跨 wire）；未知 slug /
  // 坏条目跳过 + 降级行（[mcp] <slug>: not in local config … 族）。每回合
  // 打出实际加载集与来源文件——多机各读各 config 的跑偏一眼可见（spec 13
  // premortem 护栏二）。
  const mcpSlugs = claimed.mcpServers ?? [];
  const mcpEndpoints =
    mcpSlugs.length > 0
      ? resolveMcpEndpoints(deps.mcpConfigPath, mcpSlugs, {
          onMissing: (slug) => logger.mcp(notInConfigLine(slug)),
        })
      : [];
  if (mcpSlugs.length > 0) {
    logger.mcp(
      `loaded from ${deps.mcpConfigPath}: ${
        mcpEndpoints.length > 0 ? mcpEndpoints.map((e) => e.slug).join(', ') : '(none)'
      }`,
    );
  }
  // 团队技能物化（#920 清单 + 按需拉；原 XMON-112 S2，spec 14 增补）：按步
  // 拉清单 → 只传本地缺失或 hash 不同的文件 → 内容寻址缓存目录。通道失败
  // （server 不可达 / 4xx / 5xx / 非法清单 / 完整性校验不符）= 步按 failed
  // 收尾、根因直报——旧 fail-open「仅本机技能」降级退役（#920 本体：整包
  // 字节闸 43 次静默失败无人察觉，远端机器技能面恒空）。空清单（server 无
  // 可分发技能 / 白名单空）= 配置事实非故障：显式日志行 + 本机技能，会话
  // 不阻断。
  let teamSkillsDir: string | null = null;
  try {
    const manifest = await client.skillsManifest(stepId);
    teamSkillsDir = await materializeTeamSkills({
      cacheRoot: deps.paths.teamSkillsCacheDir,
      manifest,
      fetchFile: (dirName, path) => client.skillFile(stepId, dirName, path),
      log: (msg) => logger.skills(msg),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.skills(`team-skills-failed: ${reason}`);
    await failStep(deps, stepId, `team skills distribution failed: ${reason}`);
    return;
  }
  // 团队密钥取用通道（02 §8 运行时层）：明文不经进程环境，只有真正需要密钥
  // 的步 kind 注册本地工具（records/step.ts stepTakesSecrets——规划/审核/总管
  // 探索步连工具面都没有）。授权面为空也注册：agent 取不到时拿到的是「未授权」
  // 这条明确原因，而不是一个说不清的缺值。
  const secretTool = stepTakesSecrets(claimed.step.kind)
    ? buildSecretTool({
        creds,
        stepId,
        agentId: agent?.id ?? null,
        onAudit: (line) => logger.step(line),
      })
    : null;
  // 远程 shell 执行通道（XMON-110 R2）：注册面 = claim localTools（server 算好
  // 双闸「agent 远程 shell ∩ machine.shellEnabled」下发；worker 恒携带含 []、
  // chief 不携带 = 不注册，fail-closed）。词缺席 = 开关关，agent 工具面不出现
  // 该词（密钥通道按 kind 裁剪同律）；每条命令的真实闸在 server 预检端点
  // （POST /api/machine/shell/{stepId}，审计行先于放行），本进程无策略。
  const remoteShellTool = (claimed.localTools ?? []).includes(LOCAL_TOOL_REMOTE_SHELL)
    ? buildRemoteShellTool({
        wire: client,
        stepId,
        cwd,
        onAudit: (line) => logger.step(line),
      })
    : null;
  // 步身份 [设计]（r3 未采 committer 词表）：Agent 名 + 机器位。两处消费同源
  // ——create_tag 的 tagger 与收尾 commitAll 的提交者署名一致；annotated tag
  // 没有 git 可用的兜底身份（无全局 user.name/user.email 的机器上直接挂 128），
  // 故必须显式注入。
  const stepIdentity: CommitIdentity = {
    name: claimed.agent?.displayName ?? 'pacman-agent',
    email: `${claimed.step.machineId ?? 'machine'}@pacman.local`,
  };
  // create_tag 注册面（XMON-111 T1）：claim localTools 词集是唯一判据（server
  // claimLocalTools 判定单源，daemon 不自判权限）；词缺席/缺省 = 不注册
  // （fail-closed）。repo null 步词在也注册：execute 返回「无仓库工作树」明确
  // 原因（secret-channel 同律）。凭证 = 本步 creds.git（local 形态 null）。
  const createTagTool = (claimed.localTools ?? []).includes(LOCAL_TOOL_CREATE_TAG)
    ? buildCreateTagTool({ repoDir: ws?.cwd ?? null, cred: creds.git, identity: stepIdentity })
    : null;
  const localToolDefs = [secretTool, remoteShellTool, createTagTool].filter(
    (t): t is LocalToolDef => t !== null,
  );
  // —— #1049 问答阻塞通道（ask_user 拦截面；两后端共用）———————————————
  // ask_user 不走 relayTool（10s 超时载不动「挂到人答为止」）——专用
  // client.askUser 循环（hold 长轮询 + requestId 幂等）。等答期间无流事件，
  // idle/body/duration 三臂看门狗由本循环 30s 重臂（人答延迟是合法等待，
  // 不是死流）；askAbort 是唯一退出面（看门狗触发/流收尾即 abort，等答
  // 随 poll 退场，步照常收尾——server 侧终态钩子随后收口卡片）。
  const askAbort = new AbortController();
  let askKeepAlive: (() => void) | null = null;
  const runAskChannel = async (params: Record<string, unknown>): Promise<string> => {
    if (client.askUser === undefined) throw new Error('ask channel unavailable');
    const requestId = `ask-${randomUUID()}`;
    const keepAlive = setInterval(() => askKeepAlive?.(), 30_000);
    keepAlive.unref?.();
    try {
      // 注意绑定：client.askUser 必须作为方法调用（this.fetchImpl）——剥出来
      // 当裸函数调用会丢 this（实测 TypeError: reading 'fetchImpl'）。
      const response = await client.askUser(
        stepId,
        {
          requestId,
          questions: (params.questions ?? []) as MachineAskBody['questions'],
        },
        { signal: askAbort.signal },
      );
      return JSON.stringify(response);
    } catch (err) {
      // 等待被收线（停止/看门狗/传输终错）→ 不抛断回合：cancelled 文本回给
      // 模型（它收束回合），收尾路径照常走。
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({
        status: 'cancelled',
        requestId,
        answers: null,
        reason: `ask channel aborted: ${msg}`,
      });
    } finally {
      clearInterval(keepAlive);
    }
  };
  // 工具面按步全量透传（#647/T4）：claude-code 后端把 host 注入工具
  // （remoteTools relay + localTools 本地执行）包成 in-process MCP server、
  // McpEndpoint 映射 SDK 原生 config——T1 期的 runtimeDrop 降级（worker/review
  // runtime 步丢三面 + 降级行）至此退役。pi 步零变化：三面透传本就是 pi 的
  // 既有行为。
  // #1169 defaultSkill → #1116 注入绑定序首位：injectedSkills 在位时把
  // defaultSkill 提到集首并去重（不在集内也补进——携带语义不因选择算法零
  // 命中而丢失）；injectedSkills 缺省（旧 server）不造集（回落 allowlist
  // 全量，defaultSkill 在其内）。chief 步 claim 不带这两字段，恒走缺省。
  const injectedForSession =
    agent.injectedSkills === undefined || agent.defaultSkill == null
      ? agent.injectedSkills
      : [agent.defaultSkill, ...agent.injectedSkills.filter((id) => id !== agent.defaultSkill)];
  const sessionOpts: SessionOpts = {
    provider,
    modelId: agent.modelId,
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    // 简报通道在位（#958）= 简报落 worktree 上下文文件（见下方写盘点），
    // systemPrompt 通道必须**清空**——两条通道同时开着，模型会看到两份重复清单。
    ...(systemPrompt && backend.brief === undefined ? { systemPrompt } : {}),
    cwd,
    ...(deliveryPrompt !== null ? { prompt: deliveryPrompt } : {}),
    ...(promptImages !== undefined ? { promptImages } : {}),
    ...(localToolDefs.length > 0 ? { localTools: localToolDefs } : {}),
    ...(remoteTools && remoteTools.length > 0
      ? {
          remoteTools,
          // relay 执行（r5 §3.1 bundle：execute → POST tool/<stepId> {name,params}
          // → {text}；replaySafe 读工具带重试预算 + 10s 超时；ask_user 拦截
          // 走专用问答通道（#1049，见上方 runAskChannel）——pi customTool 与
          // claude-code in-process MCP 工具两消费面同径。client.askUser 缺席
          // （单测桩）回落 relayTool 旧径。
          executeRemoteTool: (name, params) => {
            if (name === 'ask_user' && client.askUser) return runAskChannel(params);
            const def = remoteTools.find((t) => t.name === name);
            return client.relayTool(stepId, name, params, {
              ...(def?.replaySafe ? { replaySafe: true } : {}),
            });
          },
        }
      : {}),
    ...(mcpEndpoints.length > 0 ? { mcpServers: mcpEndpoints } : {}),
    // 授权白名单（#372→#1169 拆字段正名）：worker/review 步 = claim 载荷
    // agent.skillsAllowlist——数组（含 [] = 显式全拒，deny 规则吃它）原样透传；
    // **null（不限制）与缺省（旧 server 未携带）都不传**（backend 面全量直通
    // ——null 被误读成全拒即本票主修位，两态不在此塌缩）；chief 步不传
    // （信任面全量 catalog）。过滤落点 = backend catalog 构建（backend/pi.ts）。
    ...(isChief || agent.skillsAllowlist == null ? {} : { skillsAllowlist: agent.skillsAllowlist }),
    // #1106 派发技能注入选择 + #1169 defaultSkill 绑定序首位：claim 载荷
    // agent.injectedSkills（server 按任务文本对授予集规则选出，ids ⊆
    // skillsAllowlist）在位（含 []）= 目录注入按本集收窄；defaultSkill 非空
    // 时排本集首位并去重（自动携带语义——#1116 注入排序面，不让位给 id 字典
    // 序）；[] = 已计算零命中（零注入不是故障）。chief 步不携带；旧 server
    // 未携带 injectedSkills = 不造集（目录注入回落 allowlist 全量，零回归）。
    // deny 面（#917）不受重排影响——授权上限只看 skillsAllowlist。
    ...(isChief || injectedForSession === undefined ? {} : { injectedSkills: injectedForSession }),
    // 团队技能物化目录（XMON-112 S2）：backend 把它排在本机 skillsDir 之前
    // 扫描（同名冲突团队条目胜，pi first-wins）；null = 纯本机（零回归）。
    ...(teamSkillsDir !== null ? { teamSkillsDir } : {}),
    // 只读回合（#511）：审核者不下发 edit/write——写入在工具面即被拒，且它
    // 对检出造成的任何写入在收尾被丢弃（见下「审核步收尾」）。
    ...(isReview ? { readOnly: true } : {}),
    // #1148 步级 env（端口基座）：machine-loop 按槽位构造，跨缝透传 backend。
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  };

  // continue 解析键：journal 快照（recover 面）优先，其次 claim 载荷携带的
  // server 侧 sessionId（02 §5.7 合并轮/续轮复用同 conv 会话）。
  const continueId =
    claimed.session.action === 'continue'
      ? (opts.resume?.sessionId ?? claimed.session.sessionId)
      : null;

  const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
  if (prompt !== null) {
    transcript.upsert({
      id: transcriptPromptRowId(stepId),
      role: 'user',
      content: prompt,
      createdAt: now(),
    });
  }
  // —— #1149 环境钩子投影：prepare 的 hooks 槽（跑过才记）→ transcript
  // system 行（用户在步日志里看得见 setup/resume 做了什么；web 侧走既有
  // 纯文本 system→note 渲染，零 web 改动）。缺失 = 零行（无钩子仓 transcript
  // 与现状逐字节一致——验收红线）。setup 失败不进本面（prepare 已抛错，
  // 步走 failed 收尾，错误文案经 done.failed.errorMessage 上浮）。
  for (const hook of ws?.hooks ?? []) {
    const head =
      hook.status === 'ok'
        ? `.agents/${hook.name} hook ok (${hook.ms}ms)`
        : hook.status === 'timeout'
          ? `.agents/${hook.name} hook timed out after ${Math.round(hook.ms / 1000)}s — process group killed`
          : `.agents/${hook.name} hook failed (exit ${hook.exitCode})`;
    const truncated =
      hook.totalChars > hook.output.length
        ? `\n… output truncated (${hook.totalChars - hook.output.length} more chars)`
        : '';
    const body = hook.output.trim() === '' ? '' : `\n${hook.output.trimEnd()}${truncated}`;
    transcript.upsert({
      id: `hook-${hook.name}-${stepId}`,
      role: 'system',
      content: `${head}${body}`,
      createdAt: now(),
    });
  }

  // —— #931 返工轮的 git 半边：fresh session 步（restart 复用 PR build 的
  // 首步；plan 交接缺失强制轮同判据族）在 reused worktree 上回退到分支头——
  // 上一失败轮的未提交残渣（失败步不 commit，残渣只可能来自半途失败）不带入
  // 新会话轮（「只复用分支、上下文真空」的完整语义：会话真空之外工作区也
  // 回到分支已提交态，返工从原 PR 的 HEAD 继续）。review 步有自身的收尾回退
  // 护栏（下方 checkout rewind），不进本面；fresh worktree（孤儿回收后重建）
  // 本就来自 origin/<branch>，无需回退。——
  if (
    ws !== null &&
    deps.workspace &&
    claimed.session.action === 'new' &&
    !isReview &&
    ws.reused &&
    headAtStart !== null
  ) {
    try {
      await deps.workspace.restoreCheckpoint(ws.cwd, headAtStart);
      logger.workspace('返工新会话：工作区回退到分支头');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.step(`fresh-session worktree reset failed: ${reason}`);
      transcript.upsert({
        id: `fresh-reset-${stepId}`,
        role: 'system',
        content: `新会话轮未能回退工作区到分支头（${reason}）——上一轮未提交的改动可能带入本轮`,
        createdAt: now(),
      });
    }
  }

  // —— 简报落盘（#958 闸 1/2，spec 24）——
  // 写进 worktree 里引擎**原生会读**的上下文文件（pi: AGENTS.md 系；
  // claude-code: CLAUDE.md），靠 CLI 自己的记忆机制加载，systemPrompt 通道对
  // 这类后端已在上方清空。两个位置约束：
  // ① 落点必须在上面那段返工回退**之后**——它会 `reset --hard` + `clean -fd`，
  //    在其之前写的东西会被删掉；
  // ② 提到下面的 pass 循环**之外**——compat 回落第二轮看到的是同一份盘上文件，
  //    不必重写（写本身仍幂等，因为崩溃恢复会在可能含上个进程残留的 worktree
  //    上重入本函数）。
  // 写失败即 fail-closed：全搬之后没有回退通道，「带着空简报开会话」比这一步
  // 失败更糟（形状照上方 claude-code 凭据预检）。
  let briefHandle: BriefHandle | null = null;
  let briefCleanupFailed = false;
  /** 擦除简报（幂等）。写后每个出口都要走一次——漏一个就是「残留被下一步的
   * `git add -A` 扫进提交推到用户分支」的延迟污染：本步失败会跳过本步提交，
   * 文件留在 worktree，而下一次复用同一 worktree 的步（典型是合并轮，走
   * continue、**不触发**返工回退）会把它一起提交。 */
  const cleanupBriefOnce = (): void => {
    if (briefHandle === null) return;
    const h = briefHandle;
    briefHandle = null;
    try {
      logger.step(`brief ${cleanupBrief(h)} (${h.file})`);
    } catch (err) {
      briefCleanupFailed = true;
      const reason = err instanceof Error ? err.message : String(err);
      logger.step(`brief cleanup failed: ${reason}`);
      transcript.upsert({
        id: `brief-cleanup-${stepId}`,
        role: 'system',
        content: `运行简报未能从工作区擦除（${reason}，文件 ${h.file}）——本轮不提交不推送，以免它被当作改动带进分支`,
        createdAt: now(),
      });
    }
  };
  if (backend.brief !== undefined) {
    try {
      briefHandle = writeBrief({
        cwd,
        backendId: backend.brief.backendId,
        content: backend.brief.composeBody(sessionOpts, systemPrompt),
        caseInsensitiveFs: caseInsensitiveFsFor(process.platform),
      });
      logger.step(`brief written: ${briefHandle.file} (${briefHandle.mode})`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.step(`brief write failed: ${reason}`);
      cleanupBriefOnce();
      clearCredentials(creds);
      await failStep(deps, stepId, `运行简报写入失败（${reason}）`);
      return;
    }
  }

  // heartbeat 续活（失败不打断执行——与 presence 同纪律 [推断]）。
  const heartbeat = setInterval(() => {
    client.heartbeat(stepId).catch(() => {});
  }, deps.heartbeatIntervalMs ?? 30_000);
  if (heartbeat.unref) heartbeat.unref();

  let usage: AgentTokenUsage = [];
  let lastError: string | null = null;
  // 最近一次模型错误事件（#654）：auto_retry_start 清 lastError 不清它——流
  // 超时收尸场景（同形 400 重试烧到 540s 墙）lastError 是超时文案，回落判
  // 定仍要看得到底层错误签名。
  let lastModelError: string | null = null;
  let messageSeq = 0;
  let sawChangeTool = false;
  // 自然完成判定（M7 #308）：done 事件在位 = 会话自然收尾，stop 旗标迟到
  // 不改判（停止与自然完成的竞态以完成为准）。
  let sawDone = false;
  // 零进展判定（#654 回落护栏）：模型输出事件（text_delta / assistant
  // message_end / toolcall_end）在位 = 有进展——重放会重复执行工具与重复
  // 落 transcript 行，只允许零进展轮回落重试。错误终局行（message_end 携
  // stopReason=error，pi 结构化错误面）不算进展（#708）：否则真 400 的
  // message_end 先行落 transcript 就把回落闸永久闭死。
  let sawProgress = false;
  // auto_retry 有界生命周期（#708 失败方式 2）：连续零进展 auto_retry 计数
  // （进展事件清零）；超过预算 → 掐断会话（病态空转不再打外部 API）。
  let zeroProgressRetries = 0;
  let retryStorm = false;
  const retryStormMax = opts.retryStormMax ?? RETRY_STORM_MAX;
  // 流超时护栏（02 §5.6 三值 + #699 语义修订）：三臂全部「事件到达即重置」
  // ——first = 首事件期限、idle = 事件间空闲、body = 流 body 预算（#654 先
  // 把重置粒度从步推进到轮，#699 推进到事件，对齐 pi 在树参考实现的
  // first/idle 事件重置语义）。事件重置救的是活跃流（失败方式 1）；真死流
  // 由 idle 臂收（失败方式 2），步级总时长由不事件化的 duration cap 收
  // （失败方式 3）。超时 = 中断会话并按 failed 收尾，文案指名触发臂与数值
  // （失败方式 4）。
  const streamTimeouts = {
    first: opts.streamTimeouts?.first ?? STREAM_TIMEOUTS_MS.streamFirstEvent,
    idle: opts.streamTimeouts?.idle ?? STREAM_TIMEOUTS_MS.streamIdle,
    body: opts.streamTimeouts?.body ?? STREAM_TIMEOUTS_MS.streamBodyTimeout,
  };
  const streamDurationCapMs =
    opts.streamDurationCapMs ?? envDurationCapMs(process.env) ?? STREAM_DURATION_CAP_DEFAULT_MS;
  let timedOut = false;
  let timeoutArm: StreamTimeoutArm | null = null;
  let watchdog: NodeJS.Timeout | null = null;
  let bodyTimeout: NodeJS.Timeout | null = null;
  let durationCap: NodeJS.Timeout | null = null;
  const tripTimeout = (arm: StreamTimeoutArm) => {
    timedOut = true;
    timeoutArm = arm;
    askAbort.abort(); // #1049：等答循环随看门狗退场（不占线）
    void handle.stop();
  };
  const armWatchdog = (ms: number, arm: 'first' | 'idle') => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => tripTimeout(arm), ms);
    watchdog.unref?.();
  };
  // body 总时长护栏（#654 按轮独立装设 + #699 事件到达即重置）：回落轮重置
  // 预算、每个流事件再重置——零进展轮烧掉的同形重试空转不饿死回落轮，活跃
  // 长步不死于固定墙。事件重置下安静流先撞更紧的 idle 预算，body 仍独立指名
  // 在案（数值独立可配；将来 idle 重置面收窄时它仍是兜底）。
  const armBodyTimeout = () => {
    if (bodyTimeout) clearTimeout(bodyTimeout);
    bodyTimeout = setTimeout(() => tripTimeout('body'), streamTimeouts.body);
    bodyTimeout.unref?.();
  };
  // 步级绝对上界（#699 失败方式 3）：不随事件重置、不随回落轮重置（单步一
  // 份预算）；超界即收——「事件流活跃但完全无上界」的日志/费用失控墙。
  // #1049 例外：问答等待期不算「步在跑」——等答期间由 ask 循环 30s 重臂
  // 三臂（人答延迟是合法等待，费用墙量的是模型在干活的时间）。
  const armDurationCap = () => {
    if (durationCap) clearTimeout(durationCap);
    durationCap = setTimeout(() => tripTimeout('duration'), streamDurationCapMs);
    durationCap.unref?.();
  };
  askKeepAlive = () => {
    armWatchdog(streamTimeouts.idle, 'idle');
    armBodyTimeout();
    armDurationCap();
  };
  // —— 段（#955 / ADR 0011）———————————————————————————————————————————————
  // 把模型的连续输出按「一段连续同类型增量」封成 transcript 行：封出即落
  // journal（终稿 upload-urls 读的就是这份）+ 实时上报（server 先落库再广播，
  // 第五形）。封口触点在事件循环里：类型变化 / 工具到达 / 消息结束 / 步收尾。
  // 与 deltaBuf 的关系：deltaBuf = 直播打字面的增量（第三形，瞬态），
  // SegmentBuffer = 同一份文本的落行视图；两者吃同一个 `ev.text`，无独立漂移源。
  const segments = new SegmentBuffer();
  let sealedInMessage = false;
  let lastRowCreatedAt = 0;
  /** 行时刻强制单调：同毫秒并列会让 chiefThreadMessages 的 createdAt 排序不稳，
   *  段序会跟着抖。 */
  const rowCreatedAt = (): number => {
    lastRowCreatedAt = Math.max(now(), lastRowCreatedAt + 1);
    return lastRowCreatedAt;
  };
  // live transcript 文本增量转发（M5 live streaming）：pi text_delta 按
  // TRANSCRIPT_DELTA_FLUSH_MS 窗口聚合批量 POST（tool/{stepId} 第三形
  // [设计]）；fire-and-forget——失败仅日志，终稿经 transcript 上传兜底。
  let deltaBuf = '';
  let deltaTimer: NodeJS.Timeout | null = null;
  /** 落地当前增量并 **await**。封段前必调：web 的 handoff 按缓冲长度对齐，
   *  增量还没到就先发段行，那一截会在打字行里再显示一遍（双份）。 */
  const flushDeltasNow = async (): Promise<void> => {
    if (deltaTimer !== null) {
      clearTimeout(deltaTimer);
      deltaTimer = null;
    }
    const text = deltaBuf;
    deltaBuf = '';
    if (text === '') return;
    try {
      await client.transcriptDelta(stepId, text);
    } catch (err: unknown) {
      logger.step(
        `transcript delta relay failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const flushDeltas = (): void => {
    void flushDeltasNow();
  };
  /** 封段 → journal + 实时上报。顺序硬性：先 await 增量落地，再发段行。 */
  const emitSegment = async (seg: SealedSegment): Promise<void> => {
    await flushDeltasNow();
    sealedInMessage = true;
    messageSeq += 1;
    const row = {
      id: `msg-${stepId}-${messageSeq}`,
      role: 'assistant' as const,
      content: segmentContent(seg),
      createdAt: rowCreatedAt(),
    };
    transcript.upsert(row);
    try {
      await client.transcriptRow?.(stepId, row);
    } catch (err: unknown) {
      // 上报失败不打断步——终稿 upload-urls 兜底（与工具行同纪律）。
      logger.step(`segment row relay failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  /** 封出当前未封段并落行；无内容 = no-op。 */
  const sealSegment = async (): Promise<void> => {
    const seg = segments.seal();
    if (seg !== null) await emitSegment(seg);
  };
  /** 无增量后端的兜底：按 message content 的块序封段（tool_use 跳过——工具
   *  自有行）。只在「本消息期间一个段都没封出来」时调用，否则与增量面双份。 */
  const sealFromContent = async (content: unknown): Promise<void> => {
    // 三种载荷形都吃（与 web 的 textOfContent / review-findings 的 contentToText
    // 同归一）：纯字符串、单体块、块数组。窄成数组会让「字符串形 assistant 行」
    // 整条丢失——审核步的 verdict（#519 形状）就是纯 JSON 字符串。
    const blocks = Array.isArray(content) ? content : [content];
    for (const block of blocks) {
      if (typeof block === 'string') {
        const sealedText = segments.append('text', block);
        if (sealedText !== null) await emitSegment(sealedText);
        continue;
      }
      if (block === null || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; thinking?: string };
      const sealed =
        b.type === 'thinking' && typeof b.thinking === 'string'
          ? segments.replace('thinking', b.thinking)
          : b.type === 'text' && typeof b.text === 'string'
            ? segments.append('text', b.text)
            : null;
      if (sealed !== null) await emitSegment(sealed);
    }
    await sealSegment();
  };
  // —— 会话轮（#654 协议 400 步内回落，Multica client.go「按错误回落」同
  // 律）：第一轮零进展且终局错误命中自适配签名 → backend 翻 compat 旋钮 →
  // 重开一轮（单次预算：第二起失败 / 有进展 / 无可翻即按现状收尾）。——
  let handle: AgentSessionHandle;
  let resumed = Boolean(continueId);
  // 会话开面（两轮共用）：continue 优先 + 会话文件未落盘的冷重试回退
  // （02 §5.7 崩溃竞态 [设计]）；回落轮沿同开面续会话——误差轮不追加历史，
  // pi 重试机制本就摘除错误轮，续开即从误差前状态继续。
  const openSession = (): Promise<AgentSessionHandle> => {
    resumed = Boolean(continueId);
    if (continueId === null) return backend.createSession(sessionOpts);
    return backend.continueSession(continueId, sessionOpts).catch((err: unknown) => {
      if (!(err instanceof SessionNotResumableError)) throw err;
      logger.step(`continue session unavailable (${continueId}) — falling back to new session`);
      resumed = false;
      // #862 T1 跨机续跑显式标记：续接失败的事实点在 daemon（server 只知
      // continue 载荷下发，不知对端有无会话文件）。注记进 transcript 终稿
      // system 行（shared 单源 canon；web 既有纯文本 system→note 路渲染），
      // id deterministic per step，重传覆盖不叠行。
      transcript.upsert({
        id: transcriptResumeNoteRowId(stepId),
        role: 'system',
        content: RESUME_FRESH_SESSION_NOTE,
        createdAt: now(),
      });
      return backend.createSession(sessionOpts);
    });
  };
  for (let pass = 0; ; pass++) {
    if (pass > 0) {
      // 回落轮状态复位（零进展护栏保证 messageSeq/sawChangeTool/增量缓冲在
      // 第一轮本就未动）。duration cap 不在此复位——它是步级预算（#699）。
      lastError = null;
      lastModelError = null;
      sawDone = false;
      sawProgress = false;
      timedOut = false;
      timeoutArm = null;
      zeroProgressRetries = 0;
      retryStorm = false;
      usage = [];
    }
    activity.setPhase('starting');
    try {
      handle = await openSession();
    } catch (err) {
      clearInterval(heartbeat);
      flushDeltas();
      cleanupBriefOnce();
      clearCredentials(creds);
      await failStep(deps, stepId, err instanceof Error ? err.message : String(err));
      return;
    }
    logger.raw(resumed ? `continue session ${convId}` : `new session ${convId}`);
    // 会话持久化索引即时落 journal（崩溃 recover 的 continue 解析键）。
    journal.update(stepId, { state: 'running', sessionId: handle.sessionId });
    // steer 投递面注册（W3 #279）：在跑期间 deliverSteer 可达；各收尾路径注销。
    deps.sessionHandles?.set(stepId, handle);
    armWatchdog(streamTimeouts.first, 'first');
    armBodyTimeout();
    if (pass === 0) armDurationCap();
    try {
      for await (const ev of handle.events) {
        armWatchdog(streamTimeouts.idle, 'idle');
        // body 预算与 idle 同拍按事件重置（#699 失败方式 1 的核心）。
        armBodyTimeout();
        // 活动相位（#905）：任何流事件都是 liveness——与看门狗同点记账，
        // 驱动「最近信号」的节流重发；相位切换在各 case 里。
        activity.noteEvent();
        switch (ev.type) {
          case 'text_delta': {
            sawProgress = true;
            zeroProgressRetries = 0;
            activity.setPhase('responding');
            deltaBuf += ev.text;
            if (deltaTimer === null) {
              deltaTimer = setTimeout(flushDeltas, TRANSCRIPT_DELTA_FLUSH_MS);
              deltaTimer.unref?.();
            }
            // #955：正文段同源进缓冲；类型切换时把上一段交出并落行。
            const sealedText = segments.append('text', ev.text);
            if (sealedText !== null) await emitSegment(sealedText);
            break;
          }
          case 'thinking_delta': {
            // #905 的相位面不变（思考内容不上 activity wire）；#955 起内容按
            // 段落行——思考与正文同律，只是它有「增量」与「块终全文」两个来源。
            activity.setPhase('thinking');
            const sealedThinking = segments.append('thinking', ev.text);
            if (sealedThinking !== null) await emitSegment(sealedThinking);
            break;
          }
          case 'thinking': {
            // 块终全文 = **权威替换**（增量已累积过，再 append 会让该段翻倍）。
            activity.setPhase('thinking');
            const sealedFull = segments.replace('thinking', ev.text);
            if (sealedFull !== null) await emitSegment(sealedFull);
            break;
          }
          case 'toolcall_end': {
            sawProgress = true;
            zeroProgressRetries = 0;
            if (ev.call.name && CHANGE_TOOLS.has(ev.call.name.toLowerCase())) {
              sawChangeTool = true;
            }
            // #955：工具到达先封段——文本段行必须排在它之后的工具行**之前**
            // （否则流式期工具会显示在自己前导文本的上方，轮末再跳一次）。
            await sealSegment();
            // #905 两段发射（pi/claude-code 同律）：无 result = 调用块流完、
            // 工具开始执行（此前这半被丢，工具执行期 UI 静默）；带 result =
            // 执行终态。相位面据此显示「正在执行工具：<名>」。
            // #918 技能入口调用的显示名换成 `skill: <名>`（分类单源 shared/
            // skill-facts）——头标签不展开也读得出「此刻在读哪个技能」。
            if (ev.call.result === undefined) {
              const skillName = skillCallName(ev.call);
              activity.toolStarted(
                ev.call.id,
                skillName !== null ? `skill: ${skillName}` : ev.call.name || 'tool',
              );
            } else {
              activity.toolEnded(ev.call.id);
              // #918 终态技能事实（读取完成才是事实；denied = isError，含
              // #917 两后端的硬挡）：累计进本步 skills 清单立即上报——被挡下
              // 的事件同线可见（闸的价值就在于看得见）。
              const skillFact = classifySkillFact(ev.call);
              if (skillFact !== null) activity.noteSkill(skillFact);
            }
            transcript.upsert({
              id: ev.call.id,
              role: 'assistant',
              content: { kind: 'toolcall', call: ev.call },
              createdAt: rowCreatedAt(),
            });
            if (ev.call.result === undefined) {
              // #955 起**开始半也发一行**：进行中的工具要在流式期可见（带秒数）。
              // 开始半不挂重试——结束半必发、同 id 覆盖，开始半丢了不影响终态。
              await client.tool(stepId, ev.call).catch((err: unknown) => {
                logger.step(
                  `tool start relay failed for ${ev.call.id}: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
            } else {
              // live 回传（重试预算 = REMOTE_TOOL_RETRY_DELAYS_MS [500,2000]ms，
              // r5 §3.1；终败仅日志——终稿 transcript 经 upload-urls 兜底）。
              const ok = await withRetries(
                () => client.tool(stepId, ev.call),
                REMOTE_TOOL_RETRY_DELAYS_MS,
                logger,
                `tool relay ${ev.call.id}`,
              );
              if (ok === null)
                logger.step(
                  `tool relay failed for ${ev.call.id} (transcript upload will carry it)`,
                );
            }
            break;
          }
          case 'message_end': {
            // user 行不重复落（任务文本行 user-<stepId> 已在缓冲；pi 回声同文）。
            if (ev.message.role === 'user') break;
            // per-message usage 追溯行（#927）：pi 报的 usage（含 cost）随
            // assistant 消息逐条落行——「落库成本 ← 哪次请求算出来的」的
            // 运行时对账面（daemon.log）。无 usage 的行（system 回声 /
            // claude-code 面）静默，行序即消息序。
            const messageUsage = ev.message.usage as
              | {
                  input?: number;
                  output?: number;
                  cacheRead?: number;
                  cacheWrite?: number;
                  cost?: { total?: number };
                }
              | undefined;
            if (ev.message.role === 'assistant' && messageUsage !== undefined) {
              logger.step(
                `message usage: ${modelKey} input=${messageUsage.input ?? 0} output=${messageUsage.output ?? 0} cacheRead=${messageUsage.cacheRead ?? 0} cacheWrite=${messageUsage.cacheWrite ?? 0}${
                  messageUsage.cost !== undefined ? ` cost=${messageUsage.cost.total ?? 0}` : ''
                }`,
              );
            }
            // 进展 = 模型输出行（#654 语义「assistant message_end」原义）：
            // 仅 assistant 非错误终局行计数。system 行（pi 会话开面的
            // system prompt 回声，每会话必发）不是模型输出——计入进展会把
            // #654 零进展回落闸在真流上永久闭死（#708 verify 栈实测坐实）；
            // 错误终局行（stopReason=error，pi 的 400 形）同理不是进展。
            if (ev.message.role === 'assistant' && ev.message.stopReason !== 'error') {
              sawProgress = true;
              zeroProgressRetries = 0;
            }
            if (ev.message.role !== 'assistant') {
              // 非 assistant 行照旧整行落库（无段语义：system prompt 回声等）。
              messageSeq += 1;
              transcript.upsert({
                id: `msg-${stepId}-${messageSeq}`,
                role: ev.message.role,
                content: ev.message.content,
                createdAt: rowCreatedAt(),
              });
              break;
            }
            // #955：assistant 行不再整条落库——先封出尾部残留段。整条消息期间
            // 一个段都没封出来（不吐增量的 provider）才按 content 块兜底，否则
            // 与增量面双份。
            const hadRows = sealedInMessage;
            sealedInMessage = false;
            const trailing = segments.seal();
            if (hadRows || trailing !== null) {
              if (trailing !== null) await emitSegment(trailing);
            } else {
              await sealFromContent(ev.message.content);
            }
            break;
          }
          case 'error':
            lastError = ev.error.message;
            lastModelError = ev.error.message;
            logger.step(`error: ${ev.error.message} (retryable=${ev.error.retryable})`);
            break;
          case 'auto_retry_start':
            lastError = null; // pi 流级自动重试吸收前错（02 §4.2）
            // 有界生命周期（#708 失败方式 2）：连续零进展重试超预算 = 病态空转
            // （pi 预算被某种机制重置、同形错误无限重发打外部 API）→ 掐断会话；
            // 收尾按 failed 根因直报（回落闸在下轮判据仍可用）。
            zeroProgressRetries += 1;
            if (zeroProgressRetries > retryStormMax) {
              retryStorm = true;
              logger.step(
                `retry storm: ${zeroProgressRetries} consecutive zero-progress auto-retries (max ${retryStormMax}) — stopping session`,
              );
              void handle.stop();
            }
            logger.step(`auto_retry_start attempt=${ev.attempt}`);
            // #905「为什么久」：重试轮是分钟级静默的常见根因，此前只进日志。
            activity.setPhase('retrying', { attempt: ev.attempt });
            break;
          case 'auto_retry_end':
            activity.setPhase('awaiting_model');
            break;
          case 'compaction_start':
            logger.step('compaction_start');
            activity.setPhase('compacting');
            break;
          case 'compaction_end':
            activity.setPhase('awaiting_model');
            break;
          case 'done':
            sawDone = true;
            usage = ev.usage;
            break;
          default:
            break;
        }
      }
    } catch (err) {
      clearInterval(heartbeat);
      if (watchdog) clearTimeout(watchdog);
      if (bodyTimeout) clearTimeout(bodyTimeout);
      if (durationCap) clearTimeout(durationCap);
      flushDeltas();
      cleanupBriefOnce();
      clearCredentials(creds);
      await failStep(deps, stepId, err instanceof Error ? err.message : String(err));
      return;
    }
    // —— #654 回落闸（判据取轮内原值，先于下方超时文案覆盖 lastError）：
    // 零进展 + 终局失败（超时收尸 / storm 掐断但底层模型错误在位 / 终局
    // error 行）+ 签名命中且旋钮可翻 → 翻旋钮重开一轮。停止钮经
    // handle.stop() 收尾不带 error，天然不进此闸。
    // #708：不看 sawDone——真 pi 失败流必以 done 收尾（#926 起 = agent_settled
    // → done 映射，settled 在 _runAgentPrompt 的 finally 恒发，错误流也带；#654
    // 脚本流只喂 error 漏测此点，真 400 会被 sawDone 闭死闸门）；sawProgress
    // 已排除错误终局行（见事件分支）。——
    if (pass === 0 && !sawProgress) {
      const failureText = lastModelError ?? lastError;
      if (
        failureText !== null &&
        (lastError !== null ||
          (timedOut && lastModelError !== null) ||
          (retryStorm && lastModelError !== null))
      ) {
        const amended: ProviderConfig | null =
          backend.adaptProviderCompat?.(provider, failureText) ?? null;
        if (amended !== null) {
          provider = amended;
          sessionOpts.provider = amended;
          logger.step(
            `protocol fallback: provider ${amended.providerId} compat adapted (${JSON.stringify(
              amended.compat,
            )}), retrying session once`,
          );
          deps.sessionHandles?.delete(stepId);
          continue;
        }
      }
    }
    break;
  }
  // #955：收尾封出残留段——终稿 upload-urls 读的就是这份 journal。
  await sealSegment();
  flushDeltas();
  clearInterval(heartbeat);
  if (watchdog) clearTimeout(watchdog);
  if (bodyTimeout) clearTimeout(bodyTimeout);
  if (durationCap) clearTimeout(durationCap);
  // #1049：流收尾即收线问答等待（等答的 tool 调用随 poll 退场；卡片由
  // server 侧终态钩子收口——步收尾序列先于 done 上报，不抢先取消）。
  askAbort.abort();
  // —— #708 失败方式 1：终态错误优先级 = 真实终态错误 > 超时收尸文案。
  // 超时收尸与底层错误并存（storm 场景：auto_retry 吸收前错、lastError 被
  // 清）时组合成文（「stream timeout …；根因: 400 …」），不静默丢根因；
  // 根因取结构化错误面（error 事件携带的 pi 错误对象消息——失败方式 4）。
  if (timedOut && timeoutArm !== null) {
    lastError = combineTimeoutWithRootCause(
      streamTimeoutMessage(timeoutArm, {
        ...streamTimeouts,
        durationCap: streamDurationCapMs,
      }),
      lastError ?? lastModelError,
    );
  } else if (retryStorm && lastError === null && lastModelError !== null) {
    // storm 掐断收尾（失败方式 2 立即可见失败）：根因直报，不被超时文案
    // 覆盖也不等墙。pi 自身预算退场（连接错 1→2→3 形）不走此臂——终局
    // error 行已在 lastError。
    lastError = lastModelError;
  }
  // —— 停止钮中断判定（M7 #308）：旗标 = machine-loop deliverStop 拉取-确认
  // 后置位；sawDone 优先 = stop 与自然完成竞态归完成（success 不改判）。
  // 判定先于 #698 no-op 闸：停止中断的事件流也是零事件零终局形态，闸不得
  // 给 stopped 收尾挂 no-op 错误文案。——
  const stopReq = deps.stopRequests?.get(stepId);
  if (stopReq !== undefined) deps.stopRequests?.delete(stepId);
  const stopped = stopReq !== undefined && !sawDone;
  if (stopReq !== undefined && sawDone) logger.step('stop arrived after completion — ignored');
  // —— #698 静默 no-op 闸：零进展 + 零错误 + 无 done 的轮 = 会话面空转收尾
  // （backend 事件流自然耗尽而无终局——claude-code pump 生成器耗尽形：终局
  // 事件缺席时直接 queue.end()）。按 failed 收尾并点名形态：零进展轮不可能
  // 是合法完成（任何模型产出都算进展），原先按 success 吞掉 = 「界面已开工、
  // 实际什么都没发生、无任何错误面」的静默 no-op。timedOut / stopped 各有
  // 更具体的收尾语义（超时看门狗文案 / stopped 状态），不进本闸；sawDone
  // 在位 = 会话自报自然完成，归完成语义不动。user-role 回声（输入侧
  // message_end）不算进展——事件面非空不构成「会话真跑过」。
  if (!timedOut && !stopped && !sawProgress && !sawDone && lastError === null) {
    lastError =
      'agent session ended with zero progress and no terminal outcome (silent no-op round)';
    logger.step('zero-event round: session stream exhausted without progress, done, or error');
  }
  // abort 吞掉终局 done 事件（backend/pi.ts stopping 位——停止钮与流超时
  // watchdog 共用 handle.stop()）→ usage 从 handle 累计面兜底（逐消息累积，
  // token 记账不因中断丢失）。
  if (!sawDone) usage = handle.usage();

  // —— 简报擦除的主出口（#958 闸 1）——
  // 位置刻意选在此处：定时器已清、终态错误已归并，而在 `stopped` 分支与两处
  // rewind **之前**、commitAll 之前。与 rewind 的先后其实两可（`reset --hard`
  // 会还原被追加的跟踪文件、`clean -fd` 会删掉创建的文件，之后擦除即空操作），
  // 但擦除在先能让 rewind 当兜底，且与 Multica 的 LIFO「cleanup 先于 Finalize 的
  // add -A」同构。
  cleanupBriefOnce();

  /** worktree 回退到步起点（stop/discard 与审核步只读收尾共用一处护栏）；
   * 返回失败原因，null = 回退成功或不适用（无检出/无起点）。回退失败意味着
   * 本轮写入可能残留——调用方按各自语义报出去，不静默。 */
  const rewindToStepStart = async (): Promise<string | null> => {
    if (ws === null || !deps.workspace || headAtStart === null) return '步起点 commit 不可得';
    try {
      await deps.workspace.restoreCheckpoint(ws.cwd, headAtStart);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  };

  if (stopped) {
    logger.step(`step stopped by user (discard=${stopReq?.discard === true})`);
    // 丢弃本轮修改 = worktree rewind 到步起点 checkpoint（r9 §3.3「方案和
    // 代码回到上一个版本」；方案文档面天然回上版——plan.md 上传在步收尾，
    // 停止即不上传）。不 commit/push：中断步不产交接物，远端分支停在上一步
    // 收尾态（本地 rewind 后即与远端一致，无需 force push）。
    if (stopReq?.discard === true) {
      const failed = await rewindToStepStart();
      if (failed !== null) logger.step(`discard rewind failed: ${failed}`);
    }
  }

  // —— 审核步收尾（#511）：只读是硬的，两层落点——
  //   ① 工具面：edit/write 不下发（SessionOpts.readOnly）——常见写路径直接拒；
  //   ② 检出回退：审核者在检出里跑过的任何写入（含 bash 落盘）一律 rewind 到
  //      步起点——不采集、不合并。这一层是必须的：检出与后续步（合并轮）同
  //      目录复用，遗留脏树会被下一步的 commitAll 顺手扫进合并提交。
  //   bash 仍是它的工具（跑验证命令），故 fs 级只写闸做不到——本票「只读」=
  //   「写入不被采集、不被合并」（票面裁定的可落地形态）。残留边界要说清：
  //   审核者若在 bash 里自己 push（prompt 明令禁止），daemon 拦不住——托管/
  //   github 形态远端要 per-step 凭证（只在 daemon 内存里、只经参数传给 git
  //   原语），裸 push 拿不到凭证；local 形态远端是本地路径，推得动。
  //   回退失败不能只写 daemon 日志：那正是「写入残留 + 下一步顺手提交」的窗口，
  //   落一条 system 行走 transcript 让用户在合并前看得见。
  if (checkout) {
    const failed = await rewindToStepStart();
    if (failed !== null) {
      logger.step(`review rewind failed: ${failed}`);
      transcript.upsert({
        id: `review-rewind-${stepId}`,
        role: 'system',
        content: `审核检出未能回退到本轮起点（${failed}）——本轮审核对工作区的写入可能残留，合并前请确认工作区状态`,
        createdAt: now(),
      });
    }
  }

  // —— git 收尾（02 §5.5：每步结束自动 commit + push 本 conversation 工作
  // 分支；合并步先走 `git merge --no-edit origin/<default>`，r3 §3.6；
  // 停止步跳过——中断步不产交接物；审核步跳过——只读步不产交接物）——
  let headCommit: string | null = null;
  // 审核步不产改动（#511）：它跑 bash 跑验证命令会被 CHANGE_TOOLS 记为「写过」，
  // 但那不是本轮的变更——如实报 false（server 侧同样不计入 todo.hasChanges）。
  let hasChanges = isReview ? false : sawChangeTool; // 未绑 repo 退化形 = transcript 写类工具行 [推断骨架]
  // 简报擦除失败即挡住提交（#958 闸 1）：有仓库的 worktree 里擦不干净不可存活
  // ——提交闸一旦放行，`git add -A` 会把残留扫进提交并推送（Multica daemon.go
  // 的 AbortWithReason 同律）。擦除失败已在 cleanupBriefOnce 里落过 transcript 行。
  if (
    ws !== null &&
    deps.workspace &&
    lastError === null &&
    !stopped &&
    !isReview &&
    !briefCleanupFailed
  ) {
    const git = deps.workspace;
    try {
      const committed = await git.commitAll(
        ws.cwd,
        `${claimed.step.kind}: ${claimed.todo?.title ?? claimed.conversationId}`,
        stepIdentity,
      );
      if (claimed.step.kind === 'merge') {
        const merged = await git.mergeDefaultBranch(ws.cwd, ws.defaultBranch);
        // 合并结果行进 transcript（r3 §3.6 时间线样本「git merge origin/main
        // 结果为 "Already up to date"…」同形）。
        transcript.upsert({
          id: `merge-${stepId}`,
          role: 'system',
          content: `git merge origin/${ws.defaultBranch} 结果为 "${merged.output || 'OK'}"`,
          createdAt: now(),
        });
      }
      // 推送闸（XMON-77）：Agent 未持「推送分支」= 不推——提交留在本地工作
      // 分支（步本身照常 success，拒的是推送不是工作），transcript 落 system
      // 行说明（用户在合并前看得见为何没上去）。tools 携带才判（含空数组 =
      // 全关）；缺省 = 老 server 版本墙 fail-open 现行为。
      const pushDenied =
        claimed.agent?.tools !== undefined && !claimed.agent.tools.includes(AGENT_TOOL_PUSH);
      const pushWarranted =
        committed.committed ||
        claimed.step.kind === 'merge' ||
        (await git.countAhead(ws.cwd, ws.defaultBranch)) > 0;
      if (pushWarranted && pushDenied) {
        transcript.upsert({
          id: `push-skip-${stepId}`,
          role: 'system',
          content: `Agent 未获「${AGENT_TOOL_PUSH}」授权——本轮提交保留在本地工作分支 ${ws.branch}，未推送到远端`,
          createdAt: now(),
        });
        logger.step(`push skipped: agent lacks ${AGENT_TOOL_PUSH} permission`);
      } else if (pushWarranted) {
        await git.push(ws.cwd, ws.branch, creds.git);
        logger.raw(`pushed ${ws.branch}`);
        // —— #958 闸 4 的检测半：推送后查分支里有没有我们的标记 ——
        // 预防做不到：agent 在 bash 里自己 `git add && git commit` 时，标记块在
        // 这一步之前就已进提交；提交闸只管得住 daemon 自己那次提交。只能事后
        // 点名，让「分支历史里带着我们的标记」在合并前可见（形状同审核步回退
        // 失败那条 transcript 行）。支路失败不阻断收尾——检测是附加信号。
        try {
          const leaked = (await git.briefMarkerInRef?.(ws.cwd, ws.branch)) ?? [];
          if (leaked.length > 0) {
            logger.step(`brief marker found in the pushed branch: ${leaked.join(', ')}`);
            transcript.upsert({
              id: `brief-in-history-${stepId}`,
              role: 'system',
              content: `分支 ${ws.branch} 的历史里带着运行简报的标记块（${leaked.join('、')}）——agent 在步内自行提交时 daemon 拦不住。合并前请确认这些文件不该进交付物`,
              createdAt: now(),
            });
          }
        } catch (err) {
          logger.step(
            `brief marker scan failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // local 形态落地（spec 12 G2-T2）：merge 步 push 回用户仓库后
        // `git merge --ff-only <convBranch>` 推进用户当前分支；脏工作区/非 ff
        // → git 自拒 → lastError（failed 收尾，reason 含 git 拒绝原文）——
        // 永不 force、永不动用户工作树。hosted 落地在 server applyMergeLanding
        // （hosted-only 不变）；github v1 done 语义 = conv 分支已推上，不落地。
        if (repo?.kind === 'local' && claimed.step.kind === 'merge') {
          await git.landLocalFastForward(repo.cloneUrl, ws.branch);
        }
      }
      headCommit = committed.head ?? (await git.headCommit(ws.cwd));
      // hasChanges = conv 分支领先默认分支的提交在位（02 §4.1/r5 §8 列位双键；
      // git 真值面取代 M3a transcript 推断骨架）。
      hasChanges = (await git.countAhead(ws.cwd, ws.defaultBranch)) > 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // 简报擦除失败即便没有别的错也要按 failed 收尾（#958 闸 1）：本轮没提交没推送，
  // 报 success 会让用户以为交接物已产出。transcript 行已在 cleanupBriefOnce 里落过。
  if (briefCleanupFailed && lastError === null) {
    lastError = '运行简报未能从工作区擦除——本轮未提交未推送（详见 transcript 的简报行）';
  }

  const status = stopped ? 'stopped' : lastError === null ? 'success' : 'failed';
  if (!stopped && lastError !== null) logger.step(`step failed: ${lastError}`);
  journal.update(stepId, { state: 'awaiting-upload' });

  // —— 交付面只读探测 + 上报（#704 / B-C16）：github 形态步收尾时查 conv 分支
  // 上的 PR（agent 用机器 gh 开的 PR 在服务端本不可见——Multica link-back 同
  // 方向：只读发现，不代操作）；非 hosted 形态步收尾上报 conv 分支真 diff
  // （服务端无该形态的本地存储，投影真值源 = 本上报）。两者都只在成功、
  // 非停止、非只读（review）步算——失败/中断步不产交付面事实；探测/计算失败
  // = 缺席（面板分支名在、PR 槽留空，不失败不重试——失败方式 ④）。——
  let prProbe: { number: number; url: string } | null = null;
  let changesDiff: string | null = null;
  if (ws !== null && repo !== null && lastError === null && !stopped && !isReview) {
    const ghRef = repo.kind === 'github' ? githubRepoRefOf(repo.cloneUrl) : null;
    if (ghRef !== null) {
      prProbe = await probeGithubPr({
        owner: ghRef.owner,
        repo: ghRef.repo,
        branch: ws.branch,
        // per-step token（github_connection 下发时）；未连接 = null → 匿名梯
        // （公开仓可达）。机器 gh 梯在前——agent 开 PR 用的就是它。
        token: creds.git?.password ?? null,
      }).catch((err: unknown) => {
        logger.step(
          `pr probe failed: ${err instanceof Error ? err.message : String(err)} (panel will show branch without PR)`,
        );
        return null;
      });
      if (prProbe !== null) logger.step(`pr probe: #${prProbe.number} for ${ws.branch}`);
    }
    if (repo.kind !== 'hosted' && deps.workspace?.diffAgainstDefault) {
      const diff = await deps.workspace.diffAgainstDefault(ws.cwd, ws.defaultBranch);
      // 上限闸（server 侧同闸）：超限缺席——投影回落空集，PR 面板 GitHub
      // 链接兜底；不带半截假象。
      changesDiff = diff.length <= CHANGES_DIFF_MAX_BYTES ? diff : null;
      if (changesDiff === null && diff.length > 0) {
        logger.step(
          `changes diff ${diff.length}B over ${CHANGES_DIFF_MAX_BYTES}B cap — projection falls back to empty`,
        );
      }
    }
  }

  // —— 终稿快照 + 回传（02 §1.3 数据所有权；plan 即文件、版本 = 文件版本，
  // 02 §4.2/r5 §4）。
  // #1026 快照先行：doneBody + plan 内容在上传前落 journal——「PUT 成功 /
  // done 失败」与上传失败的恢复面（recover 快路径）拿这份补报，不再重跑
  // agent 轮（此前恢复 = 整会话重跑：白烧一轮 agent + 同内容重复版本）。
  const messages = transcript.messages();
  let planContent: string | null = null;
  if (claimed.step.kind === 'plan' && !stopped) {
    // #703 闸 1 真值面：产物契约不随 repo 形态变化——cwd = worktree 检出或
    // 无 repo 裸任务目录（此前仅 worktree 收集，无 repo withPlan 恒无方案，
    // 闸会把它们全拦死）。空白文件不算产物（空方案 = 无方案）。
    const planPath = join(cwd, PLAN_FILE_NAME);
    if (existsSync(planPath)) {
      const content = readFileSync(planPath, 'utf8');
      if (content.trim() !== '') {
        planContent = content;
      }
    }
  }
  // AI 审核步 findings（M7 #330，r8 §3.1；#700）：仅 review 步提取——其它
  // 步类无该输出契约，不提取避免假阳。提取成功 → findings；提取失败 →
  // findingsError 携带原因（server 侧 verdict 消息区分「判定提取失败」与
  // 旧 daemon 无信号的「审核未返回结论」兜底）；两态均无 blocking 可判、
  // 均不触发修订。（#1026：随 doneBody 持久化，快路径补报不再重提取。）
  const reviewExtraction =
    claimed.step.kind === 'review' ? extractReviewVerdict(transcript.messages()) : null;
  const doneBody: MachineDoneBody = {
    status,
    ...(lastError !== null ? { errorMessage: lastError } : {}),
    sessionId: handle.sessionId,
    usage: [...usage],
    hasChanges,
    // per-step checkpoint（done 回传 commit：「恢复到此处」数据源 + 合并步
    // fast-forward 落地键，r3 §3.5/§3.9 [设计]）。
    ...(headCommit !== null ? { commit: headCommit } : {}),
    ...(reviewExtraction?.status === 'ok' ? { findings: reviewExtraction.verdict } : {}),
    ...(reviewExtraction?.status === 'failed' ? { findingsError: reviewExtraction.reason } : {}),
    // 交付面回填（#704）：探测命中才带（无 PR / 失败 = 缺席）；diff 上报
    // 恒带算得值（含空串——「已上报且零改动」与「未上报」在 server 侧分列）。
    ...(prProbe !== null ? { prUrl: prProbe.url, prNumber: prProbe.number } : {}),
    ...(changesDiff !== null ? { changesDiff } : {}),
  };
  journal.update(stepId, { state: 'awaiting-upload', doneBody, planContent });
  try {
    await putFinalArtifacts(client, logger, stepId, messages, planContent);
  } catch (err) {
    // 回传失败 = journal 残留 awaiting-upload，recover 快路径重传（#1026）。
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    deps.sessionHandles?.delete(stepId); // journal 残留 recover 面重传，handle 不再 steer
    deps.stopRequests?.delete(stepId);
    return;
  }

  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    deps.sessionHandles?.delete(stepId); // journal 残留 recover 补报，handle 不再 steer
    deps.stopRequests?.delete(stepId);
    return; // journal 残留，recover 面补报
  }
  clearCredentials(creds);
  journal.remove(stepId);
  deps.sessionHandles?.delete(stepId);
  deps.stopRequests?.delete(stepId);
  logger.raw(`finished (${running - 1} running)`);
}

// —— 终稿回传共享面（runStep 收尾 + #1026 recover 快路径）———————————————————

/** #1028 重试预算：PUT 瞬态失败（404/5xx/网络）重取 URL 重传的轮数上限；
 * 耗尽 = journal 残留走 recover 面（daemon 重启时快路径补报）。轮间退避
 * 覆盖 server 滚动重启窗（部署重启通常秒级回到可用）。 */
const UPLOAD_RETRY_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 1_000;

/** 终稿回传文件清单（transcript.json + plan.md，收尾与快路径同构）。 */
function finalUploadFiles(
  messages: TranscriptUpload['messages'],
  planContent: string | null,
): { name: string; size?: number }[] {
  const files: { name: string; size?: number }[] = [
    { name: 'transcript.json', size: JSON.stringify(messages).length },
  ];
  if (planContent !== null) files.push({ name: PLAN_FILE_NAME, size: planContent.length });
  return files;
}

/** 终稿回传（transcript.json + plan.md）：预签名 URL 每轮重取——URL 只活在
 * server 进程内存（#1028），重启即 404；重取即愈 = 恢复不依赖进程内存。
 * 瞬态失败（isTransientUploadError）有界重试；语义 4xx（#1027 拒绝腿等）
 * 直接上抛（重试永不成功）。transcript 行 id 幂等、plan 上传按「步+内容」
 * 幂等（server 侧 #1026）——整轮重传不产生重复面。 */
async function putFinalArtifacts(
  client: MachineApi,
  logger: DaemonLogger,
  stepId: string,
  messages: TranscriptUpload['messages'],
  planContent: string | null,
): Promise<void> {
  const files = finalUploadFiles(messages, planContent);
  for (let attempt = 1; ; attempt++) {
    try {
      const { uploads } = await client.uploadUrls(stepId, files);
      for (const upload of uploads) {
        if (upload.name === PLAN_FILE_NAME) {
          if (planContent !== null) {
            await client.putUpload(upload.url, upload.headers, planContent, 'text/markdown');
          }
        } else if (upload.name === 'transcript.json') {
          await client.putUpload(upload.url, upload.headers, { stepId, messages });
        }
      }
      return;
    } catch (err) {
      if (attempt >= UPLOAD_RETRY_ATTEMPTS || !isTransientUploadError(err)) throw err;
      logger.step(
        `upload attempt ${attempt} failed (${
          err instanceof Error ? err.message : String(err)
        }) — re-requesting presigned urls`,
      );
      await new Promise((r) => setTimeout(r, UPLOAD_RETRY_DELAY_MS));
    }
  }
}

/** #1026 recover 快路径：awaiting-upload 残留步的补报——不重跑 agent 轮。
 * 素材 = journal 终稿快照（doneBody + planContent）+ outbox transcript 缓冲
 * （TranscriptBuffer 构造即重读落盘文件）。上传/done 失败 = journal 残留
 * 保留（与 runStep 收尾失败路径同律，下次重启再试）。URL 每轮重取，旧 URL
 * 404（server 期间重启过）同样被重取吸收（#1028）。machine-loop 的 recover
 * 派发 gate = `state === 'awaiting-upload' && doneBody != null`；快照缺失
 * （旧格式条目/快照前崩溃）派发方走整步重跑原路径。 */
export async function resumePendingUpload(
  deps: Pick<
    RunStepDeps,
    'client' | 'journal' | 'logger' | 'paths' | 'sessionHandles' | 'stopRequests'
  >,
  entry: StepJournalEntry,
  opts: { running?: number } = {},
): Promise<void> {
  const { client, journal, logger } = deps;
  const stepId = entry.stepId;
  const doneBody = entry.doneBody;
  if (doneBody == null) return; // 快照缺失守卫（派发 gate 不该放行到这里）
  const running = opts.running ?? 1;
  logger.recover(`step ${stepId} awaiting upload — replaying final report (no agent round)`);
  const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
  const messages = transcript.messages();
  const planContent = entry.planContent ?? null;
  try {
    await putFinalArtifacts(client, logger, stepId, messages, planContent);
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    return; // journal 残留保留，下次重启再试
  }
  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    return; // journal 残留保留，下次重启再试
  }
  journal.remove(stepId);
  deps.sessionHandles?.delete(stepId);
  deps.stopRequests?.delete(stepId);
  logger.raw(`finished (${running - 1} running)`); // 02 §5.7 收尾 canon 行
}

async function failStep(deps: RunStepDeps, stepId: string, message: string): Promise<void> {
  deps.sessionHandles?.delete(stepId); // 覆盖 handle 后失败路径（前置失败 = 无键可删）
  deps.stopRequests?.delete(stepId);
  deps.logger.step(`failed: ${message}`);
  try {
    await deps.client.done(stepId, { status: 'failed', errorMessage: message });
    deps.journal.remove(stepId);
  } catch (err) {
    // 离线：journal 保持 claimed/running（pending 面），recover 对账重报
    // （02 §5.4）；原因上浮日志。
    deps.logger.step(
      `done(failed) report unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
