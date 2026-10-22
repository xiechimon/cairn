// 机器面服务层（02 §5 canonical，wire schema 单源 = shared machine-wire.ts）。
// - enroll：api-key 非交互注册（02 §5.2 路径二）；重注册复用同一 machineId
//   （r3 §1.2 实测，按 key/team 认机器 [推断]）。
// - claim：长轮询领取（~75s 节奏，r3 §1.5）+ wake 即时唤醒；step 队列 server
//   持有、机器 claim 三类步（02 §4.2/A6）。
// - journal：heartbeat/tool/done/token（02 §5.4 词表）。
// verb 面（#1134 拆分）：产物上传 = machine-uploads.ts、远程 shell =
//   machine-shell.ts、问答/relay 工具 = machine-relay.ts（journal 内核
//   ownedStep / publishStepStatus / upsertMessage / upsertChiefRow /
//   agentForStep 自本模块导出供其消费）。
// 载荷细形 r3 未采处 = [推断]/[设计]（04 §3 不判负口径），补采后回写 02 §11。

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  ClaimedStep,
  ClaudeCodeReport,
  GitCredentials,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachineDoneBody,
  MachineSkillsManifestResponse,
  MachineTokenResponse,
  ProviderConfig,
  SecretBox,
  StepActivityReport,
  StepRecord,
  ToolCallRecord,
  TranscriptRow,
  UserRecord,
} from '@pacman/shared';
import {
  AGENT_TOOL_SHELL,
  AGENT_TOOL_TAG,
  appendMergedPrGuard,
  assertSkillInjection,
  buildMergedPrGuardInstruction,
  buildMergedPrGuardNote,
  buildSecondPrWarningNote,
  buildTaskPromptText,
  CHANGES_DIFF_MAX_BYTES,
  CHIEF_REMOTE_TOOLS,
  CHIEF_TURN_ERROR_KIND,
  classifyStepFailure,
  formatSkillRouteSection,
  GITHUB_ACCESS_TOKEN_USERNAME,
  isBackendRuntimeId,
  isChiefConversationId,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  MCP_MIN_CLI_VERSION,
  machineRecordSchema,
  mergedPrGuardNoteRowId,
  parseReportedCapabilities,
  SKILL_INJECTION_CHECK_KIND,
  type SkillInjectionFacts,
  type SkillInjectionRecord,
  secondPrWarningNoteRowId,
  selectSkillsForTask,
  skillFactsFromContents,
  suggestSkillsForMessage,
  WORKER_REMOTE_TOOLS,
  WORKER_REMOTE_TOOLS_GITHUB,
} from '@pacman/shared';
import { and, asc, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  agent,
  agentMemory,
  apiKey,
  build,
  chief,
  chiefMessage,
  chiefThread,
  machine,
  message,
  steerPending,
  step,
  stopPending,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { conflict, HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { hashCredential } from '../lib/hash.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { newMachineToken } from '../lib/keys.js';
import { readAttachmentMeta } from './attachments.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  failStepWithEvents,
  mergedPrElsewhere,
  NotFoundError,
  toBuildRecord,
} from './builds.js';
import {
  chiefClaimContext,
  finishChiefTurn,
  notifyChiefTurn,
  parseChiefTrigger,
  upsertChiefMessage,
} from './chief.js';
import { cancelPendingQuestions } from './chief-questions.js';
import type { StepCredentialBundle } from './credentials.js';
import {
  issueStepGitCredential,
  resolveChiefStepCredentials,
  resolveStepCredentials,
  revokeStepGitCredential,
} from './credentials.js';
import {
  agentForStep as agentForStepEligibility,
  agentRunningCount,
  capabilityGatePasses,
  machineRunningCount,
  recommendMachineConcurrency,
  runtimeGatePasses,
  unassignedStepReason,
} from './dispatch-eligibility.js';
import { quotaHoldBackoffMs, quotaHoldNote } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import {
  diffTextNamesAFile,
  parseUnifiedDiff,
  projectOfTodo,
  projectRepoRef,
  repoDirFor,
} from './git.js';
import { openGithubToken } from './github-connection.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { markModelDead } from './model-liveness.js';
// #1261 配额挂起面（quotaBlock → waiting_quota，不走 failed 漏斗）。
import { applyQuotaWaitStep } from './quota-wait.js';
import type { LocalSkill } from './skills.js';
import { listSkillFiles, readSkillFileBytes, scanLocalSkills } from './skills.js';
import { listProjectTagVocab } from './tags.js';
import { setTodoPhase } from './todos.js';

/** chief 步 conv id 判别（单源 = shared isChiefConversationId；thread id 形
 * `chief-<uuid>`，无 build 行，r5 §3.1）。 */
export function isChiefConversation(id: string): boolean {
  return isChiefConversationId(id);
}

export interface MachineDeps {
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  /** at-rest 加密缝（per-step 凭证解密下发，02 §8；M2c SecretBox）。 */
  box: SecretBox;
  /** 通知收件人（completeStep → setTodoPhase 通知漏斗，02 §9.1/M2c）。 */
  user: UserRecord;
  /** 托管 bare repo 存储根（merge 步 fast-forward 落地，02 §4.2/A6）。 */
  reposDir: string;
  /** 附件存储根（#310 chief attachment 工具读面）。 */
  attachmentsDir: string;
  /** 技能根目录（spec 13 #367：chief systemPrompt 资源清单 + skills relay
   * 读工具 = 本地现扫）。 */
  skillsDir: string;
  /** 本机 MCP config 读路径（spec 13/#368；executeChiefTool deps 透传——
   * 缺省 = 工具侧回落 ~/.claude.json，生产接线恒随 ctx 携带）。 */
  mcpConfigPath?: string;
  /** conversation stream 通道（M5 live streaming：transcript 行/文本增量/
   * 步状态即时推送，02 §1.2 会话流）；缺省 = 无会话流面（单测形态）。 */
  convHub?: ConversationStreamHub;
  /** GitHub 出站注入位（#452 写向：set_task_meta 标题回写 + chief create_todo
   * 自建 issue 透传；AppContext.githubFetch 同族，缺省 globalThis.fetch，
   * 测试注入 mock——零真实出站）。 */
  githubFetch?: FetchLike;
}

/** 步状态位透出会话流（journal 状态 [内部] 列 → step 事件 [设计]）。verb 面
 * 拆分模块（machine-uploads.ts 等）同消费，journal 内核导出面。 */
export function publishStepStatus(deps: MachineDeps, stepId: string): void {
  if (!deps.convHub) return;
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) return;
  deps.convHub.publishStep(row.buildId, {
    id: row.id,
    buildId: row.buildId,
    kind: row.kind,
    machineId: row.machineId,
    createdAt: row.createdAt,
    status: row.status,
    checkpointCommit: row.checkpointCommit,
    skillInjection: row.skillInjection ?? null,
  });
}

/** #1106 worker 步的派发技能注入选择：授予集内按任务文本（title+spec，
 * daemon buildTaskPromptText 同源单源）做规则选择。hits=[] = 已计算零命中
 * （零注入不是故障，不保底全量）；扫描失败容错律（scanLocalSkills 空集）
 * → 描述侧信息缺失，授予 id 照旧参与点名，不炸派发。选择结果随 claim 原子
 * 落 step 行（详情面回查正本），ids 经 claim 载荷 agent.injectedSkills 透传。
 * chief 步不经本面（信任面全量 catalog，#372）。 */
function workerSkillInjection(
  deps: MachineDeps,
  agentRow: { defaultSkill: string | null; skillsAllowlist: readonly string[] | null },
  todoRow: { title: string; spec: string },
): SkillInjectionRecord {
  // 候选基 = 授予集正本（票面「目录 = 用户为项目授予的技能集」）：授予集跨
  // server 团队库与 daemon 本机库两分布面，server 现扫只覆盖前者——未扫到的
  // 授予 id（本机库技能）以 id/名参与点名规则（domain 规则只有 id 文本信号，
  // 天然弱），描述侧信息以现扫为上限；daemon 收窄按 ids 求交，本机没有的
  // 授予 id 自然不进目录（正本 = 选择记录，落面 = 机器事实）。零命中照旧
  // 零注入——授予边界不变，本函数不编造未授予条目。
  // #1169：skillsAllowlist=null（不限制）→ 候选基 = 全量现扫（不是零候选——
  // null 不再被读成全拒）；defaultSkill 不进选择规则（携带语义在 daemon 侧
  // 排注入绑定序首位，#1116 面），此处无它的失败方式。
  const scanned = new Map(scanLocalSkills(deps.skillsDir).map((s) => [s.id, s]));
  const granted =
    agentRow.skillsAllowlist === null
      ? [...scanned.keys()]
      : [...new Set(agentRow.skillsAllowlist)];
  const candidates = granted.map((id) => {
    const s = scanned.get(id);
    return s === undefined
      ? { id, name: id, description: null }
      : { id: s.id, name: s.name, description: s.description };
  });
  const hits = selectSkillsForTask(buildTaskPromptText(todoRow.title, todoRow.spec), candidates);
  return { hits };
}

/** steer 拉取-确认（W3 #278，GET /api/machine/steer?stepId=）：本机在跑的步
 * 才可拉取（machineId + claimed 双校验）；pending 定向步不匹配（步已收尾/
 * 换新步）→ 丢弃（spec #277「步结束仍有 pending = 丢弃」）；匹配 → 返回内容
 * 并清（拉取即确认）。 */
export function fetchSteer(
  deps: { db: Db },
  machine: { id: string },
  stepId: string,
): { content: string | null } {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow || stepRow.machineId !== machine.id || stepRow.status !== 'claimed') {
    return { content: null };
  }
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, stepRow.buildId))
    .get();
  if (!pending) return { content: null };
  db.delete(steerPending).where(eq(steerPending.conversationId, stepRow.buildId)).run();
  if (pending.stepId !== stepId) {
    return { content: null };
  }
  return { content: pending.content };
}

/** stop 拉取-确认（M7 #308，GET /api/machine/stop?stepId=）：fetchSteer 同形
 * ——本机在跑步才可拉取（machineId + claimed 双校验）；pending 定向步不匹配
 * （步已收尾/换新步）→ 丢弃；匹配 → 返回 discard 位并清（拉取即确认）。 */
export function fetchStop(
  deps: { db: Db },
  machine: { id: string },
  stepId: string,
): { discard: boolean | null } {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow || stepRow.machineId !== machine.id || stepRow.status !== 'claimed') {
    return { discard: null };
  }
  const pending = db
    .select()
    .from(stopPending)
    .where(eq(stopPending.conversationId, stepRow.buildId))
    .get();
  if (!pending) return { discard: null };
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  if (pending.stepId !== stepId) {
    return { discard: null };
  }
  return { discard: pending.discard };
}

// —— 认证（02 §8：存哈希比对）———————————————————————————————————————————————

export function findMachineByToken(db: Db, token: string) {
  return db
    .select()
    .from(machine)
    .where(eq(machine.tokenHash, hashCredential(token)))
    .get();
}

export function findApiKeyByPlain(db: Db, plain: string) {
  return db
    .select()
    .from(apiKey)
    .where(eq(apiKey.keyHash, hashCredential(plain)))
    .get();
}

// —— enroll（02 §5.2）———————————————————————————————————————————————————————

/** machine 行 → wire record 投影单源（routes.ts GET/PATCH 与 routes-machine.ts
 * me 双消费；字段增删只改这里 + shared schema）。 */
/** #1108 机器记录的 runningSteps 派生：该机 claimed 步数。#1148 起**只数
 *  非 chief 步**（chief 不占并发槽——容量闸、机器页 `执行中 n/N`、排队
 *  waitingFor 快照三处同源同数：满载 worker + chief 在跑时 n 不超 N，chief
 *  步不受闸也不进计数）。 */
export { machineRunningCount } from './dispatch-eligibility.js';

export function toMachineRecord(row: typeof machine.$inferSelect, runningSteps?: number) {
  const recommendation = recommendMachineConcurrency(row.capabilities?.hardware);
  return machineRecordSchema.parse({
    id: row.id,
    name: row.name,
    teamId: row.teamId,
    online: row.online,
    latestCliVersion: row.latestCliVersion,
    kind: row.kind,
    enabledRuntimes: row.enabledRuntimes,
    shellEnabled: row.shellEnabled,
    // #1108：并发上限（DB 真值）+ 在跑计数（读侧派生，调用方传——缺席 =
    // 不渲染并发面的读端（如老调用面），maxConcurrent 恒随行）。
    // #1241：来源与推荐值随行。
    maxConcurrent: row.maxConcurrent,
    maxConcurrentOverridden: row.maxConcurrentOverridden,
    recommendedConcurrent: recommendation.value,
    concurrencyRange: recommendation.range,
    concurrencySource: row.maxConcurrentOverridden ? 'manual' : recommendation.source,
    ...(runningSteps !== undefined ? { runningSteps } : {}),
    // #1251：能力清单三态随行（清单 / null = 从未上报 / 列缺省不成立——
    // server 恒发全块，nullish 形只留给老 server 响应的解析兼容）。
    capabilities: row.capabilities,
  });
}

/** #1251 capabilities 字段的 server 侧收严（心跳红线 02 §5.4 的服务端半边）：
 *  wire 位是 z.unknown（坏形状不 400 心跳）。parseReportedCapabilities：
 *  整包不合法 = 丢弃该字段保留旧值；hardware 单独坏 = 收下 mcp/skills。
 *  缺席 = 不动。任何一支都不影响 presence/enroll 的成功响应。 */
function parseCapabilitiesField(raw: unknown): MachineCapabilities | undefined {
  if (raw === undefined) return undefined;
  return parseReportedCapabilities(raw);
}

/** 这拍上报并上旧指纹：本拍没带 hardware 时留着上一拍的，避免一次探测失败
 *  把已测到的推荐值打回估算。 */
function mergeReportedCapabilities(
  previous: MachineCapabilities | null,
  reported: MachineCapabilities,
): MachineCapabilities {
  if (reported.hardware === undefined && previous?.hardware !== undefined) {
    return { ...reported, hardware: previous.hardware };
  }
  return reported;
}

/** 心跳/注册写点：未覆盖时把推荐值落 maxConcurrent。覆盖中的行不改 maxConcurrent。 */
function reportedConcurrencyPatch(
  row: {
    maxConcurrentOverridden: boolean;
    capabilities: MachineCapabilities | null;
  },
  reported: MachineCapabilities,
): {
  capabilities: MachineCapabilities;
  maxConcurrent?: number;
} {
  const capabilities = mergeReportedCapabilities(row.capabilities, reported);
  const recommendation = recommendMachineConcurrency(capabilities.hardware);
  return {
    capabilities,
    ...(!row.maxConcurrentOverridden ? { maxConcurrent: recommendation.value } : {}),
  };
}

/** #1241 启动回填（mon 裁定）：未覆盖行（含 0043 回填里恰为旧默认 3 的存量行）
 *  一律跟当前推荐值——有硬件指纹按公式重算，无指纹保持保守默认 3（估算）。
 *  手动覆盖行一概不动。幂等：值已等于推荐值的行不写；返回改动行数。
 *  也兜住公式调整（如 floor→round）后离线机的旧值，不必等下一拍心跳。 */
export function backfillMachineConcurrency(db: Db): number {
  const rows = db
    .select({
      id: machine.id,
      maxConcurrent: machine.maxConcurrent,
      capabilities: machine.capabilities,
    })
    .from(machine)
    .where(eq(machine.maxConcurrentOverridden, false))
    .all();
  let changed = 0;
  for (const row of rows) {
    const { value } = recommendMachineConcurrency(row.capabilities?.hardware);
    if (row.maxConcurrent === value) continue;
    db.update(machine).set({ maxConcurrent: value }).where(eq(machine.id, row.id)).run();
    changed += 1;
  }
  return changed;
}

/** PATCH /api/machines/{id} 的并发半边（#1241）。数字 = 覆盖并持久；
 *  null = 清除覆盖，按当前指纹重算（无指纹 = 保守默认）。 */
export function machineConcurrencyPatch(
  row: typeof machine.$inferSelect,
  maxConcurrent: number | null,
): {
  maxConcurrent: number;
  maxConcurrentOverridden: boolean;
} {
  if (maxConcurrent === null) {
    const recommendation = recommendMachineConcurrency(row.capabilities?.hardware);
    return { maxConcurrent: recommendation.value, maxConcurrentOverridden: false };
  }
  return { maxConcurrent, maxConcurrentOverridden: true };
}

/** 本机匹配键（spec 11 A8/A9，#357）：daemon `--name` 默认 hostname（r3
 * §1.1），server 侧以自身 os.hostname() 判本机——票面「loopback enroll 同律」
 * 的判定键即 hostname 匹配（同机经 LAN IP 连回也命中；不按连接来源 IP 判，
 * 免绑定形态误伤）。代价 = 异机同名误判 local，票面规则接受。命中返回
 * (teamId, name) 既有行，否则 undefined。 */
function localMachineRow(db: Db, teamId: string, name: string) {
  if (name !== hostname()) return undefined;
  return db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.name, name)))
    .get();
}

/** server 启动 seed 本机行（spec 11 A8，index.ts 调），三级定位保证
 * 「本机行至多一行」（验收 #357 + feature map 改名 gotcha）：
 * 1. kind='local' 既有行（含显式 --name 改名后 name 漂移离 hostname 的行）
 *    → 直接复用，不动 name（用户改名意图优先）；
 * 2. hostname 同名行（enroll 先于 seed 落库的窗口）→ 补 kind='local'；
 * 3. 未建 → insert 无凭证 placeholder（tokenHash null；daemon enroll 按
 *    同律复用并补凭证）。
 * idempotent：二次启动不建 duplicate。 */
export function seedLocalMachine(db: Db, teamId: string): void {
  const local = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), eq(machine.kind, 'local')))
    .get();
  if (local) return;
  const byName = localMachineRow(db, teamId, hostname());
  if (byName) {
    db.update(machine).set({ kind: 'local' }).where(eq(machine.id, byName.id)).run();
    return;
  }
  db.insert(machine)
    .values({
      id: newRecordId(),
      teamId,
      name: hostname(),
      online: false,
      tokenHash: null,
      apiKeyId: null,
      latestCliVersion: null,
      kind: 'local',
      // #682：runtime 开关缺省 ['pi']——bootstrap 不空转（claim 真闸下 [] 全关
      // = 新装机一步都领不到）；claude-code 是显式 opt-in（凭据本来就要各机
      // 登录）。存量 [] 行由 0022 migration 回填同值。
      enabledRuntimes: ['pi'],
    })
    .run();
}

export function enrollMachine(
  deps: MachineDeps,
  input: {
    keyId: string;
    teamId: string;
    name: string;
    cliVersion?: string;
    serverUrl: string;
    claudeCode?: ClaudeCodeReport;
    /** #1251 能力清单（wire 宽松位原样进——收严在 parseCapabilitiesField，
     *  坏形状丢弃不阻注册）。 */
    capabilities?: unknown;
  },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  const token = newMachineToken();
  const isLocal = input.name === hostname();
  const capabilities = parseCapabilitiesField(input.capabilities);
  // 重注册复用同一 machineId（r3 §1.2：logout 后重注册 machineId 不变）；
  // 本机律（spec 11 A9）优先认领 seed placeholder 行——loopback enroll 不与
  // 启动 seed 建 duplicate。
  const existing =
    db
      .select()
      .from(machine)
      .where(and(eq(machine.apiKeyId, input.keyId), eq(machine.teamId, input.teamId)))
      .get() ?? (isLocal ? localMachineRow(db, input.teamId, input.name) : undefined);
  if (existing) {
    db.update(machine)
      .set({
        tokenHash: token.hash,
        name: input.name,
        apiKeyId: input.keyId,
        ...(input.cliVersion !== undefined ? { latestCliVersion: input.cliVersion } : {}),
        ...(isLocal ? { kind: 'local' as const } : {}),
        ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
        ...(capabilities !== undefined ? reportedConcurrencyPatch(existing, capabilities) : {}),
      })
      .where(eq(machine.id, existing.id))
      .run();
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  db.insert(machine)
    .values({
      id: machineId,
      teamId: input.teamId,
      name: input.name,
      online: false,
      tokenHash: token.hash,
      apiKeyId: input.keyId,
      latestCliVersion: input.cliVersion ?? null,
      kind: isLocal ? 'local' : 'remote',
      enabledRuntimes: ['pi'],
      ...(input.claudeCode !== undefined ? { claudeCodeReport: input.claudeCode } : {}),
      ...(capabilities !== undefined
        ? reportedConcurrencyPatch(
            { maxConcurrentOverridden: false, capabilities: null },
            capabilities,
          )
        : {}),
    })
    .run();
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

/** 浏览器授权流建机（#285，02 §5.2 路径一完成面）：无 apiKey——授权页用户
 * 确认（capability = enrollId 单次）即建新机；key 路径的复用键 = apiKeyId 在
 * 此缺席，本机律（spec 11 A9）仍认 seed placeholder 行。machine.json 形状
 * 返回（poll authorized 态同载荷）。 */
export function authorizeEnrollmentMachine(
  deps: MachineDeps,
  input: { teamId: string; name: string; serverUrl: string },
): { machineId: string; token: string; teamId: string; serverUrl: string } {
  const { db } = deps;
  const token = newMachineToken();
  const isLocal = input.name === hostname();
  const existing = isLocal ? localMachineRow(db, input.teamId, input.name) : undefined;
  if (existing) {
    db.update(machine)
      .set({ tokenHash: token.hash, kind: 'local' })
      .where(eq(machine.id, existing.id))
      .run();
    return {
      machineId: existing.id,
      token: token.plain,
      teamId: input.teamId,
      serverUrl: input.serverUrl,
    };
  }
  const machineId = newRecordId();
  db.insert(machine)
    .values({
      id: machineId,
      teamId: input.teamId,
      name: input.name,
      online: false,
      tokenHash: token.hash,
      apiKeyId: null,
      latestCliVersion: null,
      kind: isLocal ? 'local' : 'remote',
      enabledRuntimes: ['pi'],
    })
    .run();
  return { machineId, token: token.plain, teamId: input.teamId, serverUrl: input.serverUrl };
}

// —— presence（02 §5.4：心跳并行失败、进程不退出——server 侧无状态可失败）——————

export function markPresence(
  deps: MachineDeps,
  machineId: string,
  body: { cliVersion?: string; claudeCode?: ClaudeCodeReport; capabilities?: unknown },
): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row) throw new NotFoundError(`machine ${machineId}`);
  const becameOnline = !row.online;
  // #1251：capabilities 字段级收严（心跳红线——坏字段丢弃保留旧值，
  // 永不打出本函数之外的失败）。#1241：同一拍把推荐并发写上未覆盖的行。
  const capabilities = parseCapabilitiesField(body.capabilities);
  db.update(machine)
    .set({
      online: true,
      // #1136：陈旧判定的真值源——每拍覆写（sweepStaleMachines 见下方）。
      lastSeenAt: nowMs(),
      ...(body.cliVersion !== undefined ? { latestCliVersion: body.cliVersion } : {}),
      ...(body.claudeCode !== undefined ? { claudeCodeReport: body.claudeCode } : {}),
      ...(capabilities !== undefined ? reportedConcurrencyPatch(row, capabilities) : {}),
    })
    .where(eq(machine.id, machineId))
    .run();
  if (becameOnline) {
    // team stream machine_presence 事件（02 §1.2 {type,machineId,online}）。
    hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online: true }));
  }
}

/** 窄位形（db + hub）：SSE abort（routes-machine 全量 deps）与陈旧扫掠
 * （scheduler 的 BuildDeps）两调用方都只消费这两位。 */
export function markOffline(deps: Pick<MachineDeps, 'db' | 'hub'>, machineId: string): void {
  const { db, hub } = deps;
  const row = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!row?.online) return;
  db.update(machine).set({ online: false }).where(eq(machine.id, machineId)).run();
  hub.publish(row.teamId, () => ({ type: 'machine_presence', machineId, online: false }));
}

// —— #1136 机器行陈旧判定（静默死机的第二真值源）—————————————————————————

/** 在线机器的 lastSeenAt 陈旧阈值。推导（票 #1136 阈值纪律 + Multica 同款
 * 口径 r10 §5.2）：健康机器的 lastSeenAt 最坏年龄 = presence 节拍 30s +
 * 网络抖动/事件循环停顿；再叠 tick 检测延迟不影响年龄只影响检出时刻。
 * 150s ≈ 5× 节拍，且与 Multica `RuntimeClaimFreshnessSeconds`（150s，
 * task.go:189，含 105s 最坏年龄推导注释）同数——proven 形状不自造新节奏。
 * 误杀比漏杀贵：闪断翻 offline 会让会话亲和闸放行换机（丢会话，
 * tryClaim 的 ownerRow.online 判定），这里给足余量；检出延迟 =
 * 阈值 + ≤1 tick（15s）≈ 3 分钟量级，与 Multica 文档口径（「约 3 分钟」）
 * 一致。别拍 30s——那是把节拍当故障。 */
export const MACHINE_STALE_OFFLINE_MS = 150_000;

/** 陈旧扫掠：在线且 lastSeenAt 超 MACHINE_STALE_OFFLINE_MS 未更新的机器 →
 * markOffline（与 SSE abort 同一漏斗，事件面/幂等共享）。scheduler tick 驱动
 * （与三个步扫尾同拍，先于它们跑——同 tick 翻 offline，步的离线判据立即可
 * 见；调度侧不传 tick 的合成 now——见 scheduler.ts 的钟面注释）。纪律（票
 * #1136 风险面）：
 * - **只翻 online、不动步**：挂起/释放/扫尾（#862/#1257 家族）以
 *   machine.online 为前提、各有自己的判据，本 sweep 只负责让前提为真，
 *   不越权释放。
 * - **lastSeenAt NULL 不判**（升级前存量行）：无数据不翻，下一拍 presence
 *   （≤30s）补齐——升级部署零误杀窗口。
 * - **闪断恢复窗口 = 阈值本身**：健康 presence 永不过阈（30s ≪ 150s），翻
 *   回在线走 markPresence 既有 becameOnline 路径，不新增事件形态；阈值内
 *   的网络抖动静默吸收（offline/online 事件只对真 ≥150s 中断发出）。
 * - 静默死机（断电/分区/拔线，无 FIN）正是 SSE abort 抓不住的形态——本
 *   sweep 是 online 翻转的第二真值源，#861「步永久 claimed」的最后残余
 *   入口。多实例同库各自扫：markOffline 幂等（再读再判），重复事件对 UI
 *   无害（同态幂等）。 */
export function sweepStaleMachines(
  deps: Pick<MachineDeps, 'db' | 'hub'>,
  now: number = nowMs(),
): void {
  const { db } = deps;
  const stale = db
    .select({ id: machine.id })
    .from(machine)
    .where(
      and(
        eq(machine.online, true),
        isNotNull(machine.lastSeenAt),
        lt(machine.lastSeenAt, now - MACHINE_STALE_OFFLINE_MS),
      ),
    )
    .all();
  for (const row of stale) {
    markOffline(deps, row.id);
  }
}

// —— recover（02 §5.4 步 journal 恢复的 server 侧真值）————————————————————————

export function recoverSteps(deps: MachineDeps, machineId: string): StepRecord[] {
  return deps.db
    .select()
    .from(step)
    .where(and(eq(step.machineId, machineId), eq(step.status, 'claimed')))
    .orderBy(asc(step.createdAt))
    .all()
    .map(toStepRecord);
}

function toStepRecord(r: typeof step.$inferSelect): StepRecord {
  return {
    id: r.id,
    buildId: r.buildId,
    kind: r.kind,
    machineId: r.machineId,
    createdAt: r.createdAt,
  };
}

// —— claim（长轮询 + 并发门 + 三类步，02 §4.2/§5.4）—————————————————————————

interface ClaimCandidate {
  stepRow: typeof step.$inferSelect;
  buildRow: typeof build.$inferSelect;
  todoRow: typeof todo.$inferSelect;
}

function claimCandidates(deps: MachineDeps, _machineId: string, teamId: string): ClaimCandidate[] {
  const rows = deps.db
    .select({ stepRow: step, buildRow: build, todoRow: todo })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        eq(step.status, 'pending'),
        eq(todo.teamId, teamId),
        // #1257 额度挂起退避：holdUntil 未到不可领（到期 = 下一次重领即
        // 探测额度是否恢复）。null = 未挂起。（#1259 钉选过滤已退役——
        // 候选的机器可见性改由 agent 归属机判定，见下方 per-candidate 闸。）
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  return rows;
}

/** chief 步候选（step.buildId = `chief-<threadId>`，join chief_thread 取
 *  teamId；无 build/todo 行——Chief 回合 = 机器 step，r5 §3.1）。#1260：
 *  chief = 名册里的普通 agent——去处 = 绑定 Agent 的归属机
 *  （agent.machineId；chief 会话文件是执行机本地资产，归属固定 = 会话恒
 *  可续）；未绑定 Agent / Agent 未设归属机 = 无候选（任何机器不可领，
 *  sweep 负责可见失败）。候选携带 chiefRow/agentRow——buildChiefClaim 与
 *  agent 并发闸不再回库重查。 */
function claimChiefCandidates(deps: MachineDeps, machineId: string, teamId: string) {
  return deps.db
    .select({ stepRow: step, threadRow: chiefThread, chiefRow: chief, agentRow: agent })
    .from(step)
    .innerJoin(chiefThread, eq(step.buildId, chiefThread.id))
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(agent, eq(chief.agentId, agent.id))
    .where(
      and(
        eq(step.status, 'pending'),
        eq(step.kind, 'chief'),
        eq(chiefThread.teamId, teamId),
        // #1260：候选只对本机可见 ⇔ 本机 = 绑定 Agent 的归属机（chief 钉选
        // 过滤随 #1259 退役，归属机单源判定）。
        eq(agent.machineId, machineId),
        // #1257 额度挂起退避（worker 候选同律）。
        or(isNull(step.holdUntil), lte(step.holdUntil, sql`${nowMs()}`)),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
}

export function agentForStep(
  deps: MachineDeps,
  todoRow: typeof todo.$inferSelect,
  kind: StepRecord['kind'],
  prompt: string | null = null,
) {
  // #881 起判定原语下沉 dispatch-eligibility（claim 与 sweep 单源），此处仅
  // 适配 MachineDeps → db 形参。verb 面拆分模块（machine-shell.ts）同消费。
  return agentForStepEligibility(deps.db, todoRow, kind, prompt);
}

/** executor 最低版本门（02 §7.1 版本墙形状；数值 = 复刻版本线 MCP_MIN_CLI_VERSION
 * [设计]）：机器自报 cliVersion 低于门 = claim 不携带 mcpServers（老 executor
 * 无薄桥，携带即死载荷）。未知版本（老注册行）= 不携带（保守 [设计]）。 */
export function meetsMcpVersionGate(latestCliVersion: string | null): boolean {
  if (!latestCliVersion) return false;
  const parse = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(latestCliVersion), parse(MCP_MIN_CLI_VERSION)];
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** claim 载荷 mcpServers（spec 13/#368 slug 化断约；#1307 三态受管）：勾选
 * slug 原样透传——server 不再解析端点、不再接触任何 MCP 凭证；解析权在执行
 * daemon（各读各机 `~/.claude.json`，stdio 命令在真正的执行机上起，未知 slug
 * daemon 侧跳过 + 降级行）。三态（对齐 Multica mcp_config.go）：数组（含
 * [] = 受管严格空——daemon 据此给 SDK 上 strictMcpConfig 锁，用户全局 MCP
 * 不进会话；空集塌回缺省即 #1307 主修位的继承泄漏）= 受管集合；缺省 =
 * 继承，只在版本门未达时出现——旧 daemon 无三态消费面，携带即死载荷
 * （版本墙提升后旧 daemon 收不到该字段，视为无 MCP 运行，不混发形状）。 */
function claimMcpSlugs(
  latestCliVersion: string | null,
  agentSlugs: readonly string[],
): string[] | undefined {
  if (!meetsMcpVersionGate(latestCliVersion)) return undefined;
  return [...agentSlugs];
}

/** claim 载荷 localTools（XMON-108 R1）：daemon 本机工具注册面，两词各判一次、
 * 判定单源在此——
 * - remote_shell = agent 层「远程 shell」开关 ∩ machine.shellEnabled 双闸齐开
 *   （词值 = shared LOCAL_TOOL_REMOTE_SHELL）。claim 期只管注册；步中每条命令
 *   真实闸在预检端点复核双闸（machine-shell.ts precheckShellCommand，机器开
 *   关秒级热加载由此兑现——claim 时快照不作数）。
 * - create_tag = agent 层「创建标签」开关即可（机器层无对应闸，leader 裁定
 *   #4：词值 = shared LOCAL_TOOL_CREATE_TAG；词面量单源 = AGENT_TOOL_TAG，
 *   T1/XMON-111 落地后此处消费常量）。
 * 结果 fail-closed：任一闸没开即不注册该词。 */
function claimLocalTools(
  machineRow: { shellEnabled: boolean },
  agentTools: readonly string[],
): string[] {
  const tools: string[] = [];
  if (agentTools.includes(AGENT_TOOL_SHELL) && machineRow.shellEnabled) {
    tools.push(LOCAL_TOOL_REMOTE_SHELL);
  }
  if (agentTools.includes(AGENT_TOOL_TAG)) {
    tools.push(LOCAL_TOOL_CREATE_TAG);
  }
  return tools;
}

function buildChiefClaim(
  deps: MachineDeps,
  machineId: string,
  stepRow: typeof step.$inferSelect,
  threadRow: typeof chiefThread.$inferSelect,
  agentRow: typeof agent.$inferSelect,
  machineRow?: typeof machine.$inferSelect,
): ClaimedStep | null {
  // 绑定 Agent 无模型位 = 不可派发（server 侧不派发 [设计]，与门控条 canon
  // 一致；sweep 的未设归属机/闸挡分支负责可见失败）。候选已 join 出
  //  chiefRow/agentRow（claimChiefCandidates），此处零回库。
  if (!agentRow.modelId) return null;
  // #682 enabledRuntimes 真闸（chief 步同律）：绑定 agent 的 runtime 机器
  // 未开 = 该机不可领本回合（候选循环自动试下一条 chief 步）。
  if (!machineRow || !runtimeGatePasses(machineRow, agentRow.provider)) return null;
  // #1251 能力闸（chief 回合同律——绑定 Agent 的能力要求对回合生效；判据
  // 单源 dispatch-eligibility，fail-open 律同 worker 面）。
  if (!capabilityGatePasses(machineRow, agentRow)) return null;
  // #1260 无继承态：模型/思考强度恒 = 绑定 Agent 自身配置（chief 行不再持
  // model/compactionModel/thinkingLevel 覆盖槽）。
  const claimedAt = nowMs();
  const res = deps.db
    .update(step)
    .set({
      status: 'claimed',
      machineId,
      claimedAt,
      lastHeartbeatAt: claimedAt,
      // #1257 挂起位清零（worker claim 同律）。
      holdReason: null,
      holdUntil: null,
    })
    .where(and(eq(step.id, stepRow.id), eq(step.status, 'pending')))
    .run();
  if (res.changes === 0) return null;
  const ctx = chiefClaimContext(deps, threadRow.id);
  // #823 发送后 skill 路由（claim 时 = worker 开工前路由位）：仅用户触发轮检测
  // （wake/系统轮跳过——matcher 另有 [wake: 前缀纵深防御）。节恒为"建议"（agent
  // 先用 skills 工具核对详情，不切合直接忽略）——误触发可逆，普通对话零劫持。
  //
  // 落点 = **instruction（每轮用户消息）**，不是 systemPrompt。路由节按本条
  // 消息的关键词生成，是 per-run 值；写进 system prompt 会让每轮字节都变、
  // 下一轮前缀缓存整体失效（Multica MUL-5377 同坑，见 docs/spec/24）。
  // step.prompt 在库里仍是用户原文逐字不动（下方 enqueue 侧职责），本处只是
  // 把节附在**投递文本**之后。
  const trigger = parseChiefTrigger(stepRow.prompt);
  const systemPrompt = ctx?.systemPrompt ?? '';
  let routeSection = '';
  if (ctx && trigger === 'user') {
    const hint = suggestSkillsForMessage(
      stepRow.prompt ?? '',
      scanLocalSkills(deps.skillsDir).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    );
    if (hint) routeSection = formatSkillRouteSection(hint);
  }
  // 记忆注入（02 §4.4 读路径最小形；注入形 [推断] 保留）：绑定 Agent 记忆条目。
  const memories = deps.db
    .select({ title: agentMemory.title, content: agentMemory.content })
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentRow.id))
    .all();
  // Chief = 特例 Agent（02 §4.3）：绑定 Agent 的 MCP 授权同样进回合载荷。
  const chiefMcp = claimMcpSlugs(machineRow?.latestCliVersion ?? null, agentRow.mcpServers);
  return {
    step: {
      id: stepRow.id,
      buildId: stepRow.buildId,
      kind: 'chief',
      machineId,
      createdAt: stepRow.createdAt,
    },
    conversationId: stepRow.buildId, // ≡ chief-<threadId>（r5 §3.1）
    session: {
      action: threadRow.sessionId !== '' ? 'continue' : 'new',
      sessionId: threadRow.sessionId !== '' ? threadRow.sessionId : null,
    },
    ...(stepRow.prompt !== null
      ? {
          instruction:
            routeSection === '' ? stepRow.prompt : `${stepRow.prompt}\n\n${routeSection}`,
        }
      : {}),
    agent: {
      id: agentRow.id,
      displayName: agentRow.displayName,
      description: agentRow.description,
      provider: agentRow.provider,
      modelId: agentRow.modelId,
      thinkingLevel: agentRow.thinkingLevel,
      memories,
      // skills 白名单不携带（#372）：chief 是信任面，catalog 全量直通不受
      // 绑定 Agent 勾选约束（daemon 侧 isChief 判定双保险）。tools 同律不
      // 携带（XMON-77）：chief 步无 worktree/git 收尾，推送/合并开关无语义。
      // localTools 同律不携带（XMON-108 R1）：chief 无 worktree/shell 执行
      // 面，remote_shell/create_tag 无语义（预检端点对 chief 步 409 拒绝）。
    },
    chief: {
      threadId: threadRow.id,
      systemPrompt,
      trigger,
    },
    remoteTools: [...CHIEF_REMOTE_TOOLS],
    // #1307：[] 也携带（受管严格空）；缺省只留版本门未达形。
    ...(chiefMcp !== undefined ? { mcpServers: chiefMcp } : {}),
  };
}

async function tryClaim(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  origin: string,
  maxWorkers?: number,
): Promise<ClaimedStep | null> {
  const { db } = deps;
  const machineRow = db.select().from(machine).where(eq(machine.id, machineId)).get();
  if (!machineRow) return null;
  // #1108 并发门（maxConcurrent）：本机 claimed 步数达上限 = 步不发，留
  // pending 排队（对归属本机的步即该机队列）。机器释放空位（finishStep
  // 终态 wake）后下一轮 claim 即领。老 daemon（串行循环）恒 1 ≤ N，闸对
  // 其永不触发 = 混版本零回归。#1260：chief 步占槽——machineRunningCount
  // 不再剔除 chief，chief 候选与 worker 候选同闸（chief = 普通 agent，
  // 无并发特权；Multica leader 同律）。
  // #1148 maxWorkers（claim body 自报）：闸取 min(DB, 自报)——daemon 侧
  // env PACMAN_DAEMON_MAX_CONCURRENT 覆盖 DB 的 server 落点；缺省（老
  // daemon）只按机器行。
  const running = machineRunningCount(db, machineId);
  const workerCap = Math.min(
    machineRow.maxConcurrent,
    ...(maxWorkers !== undefined ? [maxWorkers] : []),
  );
  const full = running >= workerCap;
  const workerCands = full ? [] : claimCandidates(deps, machineId, teamId);
  const chiefCands = full ? [] : claimChiefCandidates(deps, machineId, teamId);
  // chief 步与 worker 步共队列，按 createdAt FIFO 交错（chief 派工先于其产生的
  // worker 步入队，天然领先；跨类型仍按 createdAt 保序 [设计]）。
  const earliestWorker = workerCands[0]?.stepRow.createdAt ?? Number.POSITIVE_INFINITY;
  for (const cand of chiefCands) {
    if (cand.stepRow.createdAt > earliestWorker) break; // worker 更早 → 先走 worker
    // #1138 agent 级并发闸（chief 同律，#1260）：绑定 Agent 名下 claimed
    // 步数（含 chief 步，dispatch-eligibility 单源归账）达 maxConcurrentTasks
    // → 跳过本候选（公平排队是合法态，不进失败漏斗）。
    if (
      cand.agentRow.maxConcurrentTasks !== null &&
      agentRunningCount(db, cand.agentRow.id) >= cand.agentRow.maxConcurrentTasks
    ) {
      continue;
    }
    const claimed = buildChiefClaim(
      deps,
      machineId,
      cand.stepRow,
      cand.threadRow,
      cand.agentRow,
      machineRow,
    );
    if (claimed) {
      publishStepStatus(deps, claimed.step.id);
      return claimed;
    }
  }

  for (const cand of workerCands) {
    const agentRow = agentForStep(deps, cand.todoRow, cand.stepRow.kind, cand.stepRow.prompt);
    // #1104 B：无 Agent（assignment 槽空 / 槽指向已删 Agent / review meta 缺
    // agentId）= 永无人可领——按失败收尾（step failed + build.errorMessage 落
    // 根因 + todo → failed 终态 + 事件面，与失联扫尾同一漏斗
    // builds.failStepWithEvents），不再静默跳过。chief 入口的无主派发已由
    // run_builds 400 打回（#1104 A）；此处收 scheduler/REST 等入口漏进来的
    // 无主步。失败只作用于本候选：同批更晚的合法候选照常认领（无队头阻塞）。
    if (agentRow === null) {
      failStepWithEvents(
        deps,
        cand.stepRow,
        unassignedStepReason(cand.todoRow, cand.stepRow.kind, cand.stepRow.prompt),
      );
      continue;
    }
    // Agent 在但无模型位 = 不可领（Agent 可空是 UI 语义，派发需模型位
    // [设计]）。补模型后该步可恢复，不按失败收口——#1104 只收「无 Agent」族。
    if (!agentRow.modelId) continue;
    // #1259 归属机闸：步只投给 agent 的归属机（机器归属单源在 agent 层，
    // 任务层钉选已退役）。null = 未设归属机——任何机器都不可领（留
    // pending 等补设；#1257 挂起语义下由板面 waitingOn chip 透出「等机器」，
    // 补设即自动续领）。
    if (agentRow.machineId !== machineId) continue;
    // #682 enabledRuntimes 真闸：机器未开步所需 runtime = 不可领（步留
    // pending 给能跑的机器——机器开 pi、步跑 claude-code agent = 不投给该机）。
    if (!runtimeGatePasses(machineRow, agentRow.provider)) continue;
    // #1251 能力闸（ADR 0018 决策 4.3，判据单源 dispatch-eligibility）：机器
    // 上报快照不满足 agent.requiredCapabilities = 不可领（步留 pending 给能力
    // 齐的机器；未上报快照 = 未知放行，老 daemon 零回归）。候选级 continue
    // ——#1138 agent 闸同形，被挡候选不队头阻塞同批其它候选。
    if (!capabilityGatePasses(machineRow, agentRow)) continue;
    // #1138 agent 级并发闸（候选级判）：该 Agent 名下 claimed worker 步数达
    // maxConcurrentTasks → 跳过本候选（步留 pending 等该 Agent 释放空位，
    // 不进失败漏斗——公平排队是合法态，与机器闸同语义）。三层分工钉死，
    // 不得互相代位：
    // - 机器闸（上方 running >= workerCap）= 机器面容量，整批收口
    //   （workerCands 置空）；agent 闸 = 公平性分池，单候选粒度——同批
    //   其它 Agent 的候选照领（无队头阻塞，与 #1104 失败收口同款 continue
    //   形）。与机器闸的合成 = min（步须同时过两闸），是两层各自 gate 的
    //   自然结果（与 Multica daemon ∩ agent 双层闸同形，r10 §5.4）——不
    //   发明一处集中取 min 的判定。
    // - 零值语义：maxConcurrentTasks null = 不限（缺省/存量行）——闸恒
    //   开，不设上限的 Agent 行为完全不变（回归红线，测试钉死）。
    if (
      agentRow.maxConcurrentTasks !== null &&
      agentRunningCount(db, agentRow.id) >= agentRow.maxConcurrentTasks
    ) {
      continue;
    }
    // continue session 判定（02 §5.7：合并轮/重规划轮复用同 conv pi 会话）。
    // 判定前移到领取前（#863 T2）；候选步自身 pending ⇒ sessionId 恒空不进
    // 结果集，且判定与领取在同一同步块内（单进程 better-sqlite3），前后移
    // 零语义差。#1259：会话机归属已由 agent 归属机保证（同 agent 恒同机），
    // 原「会话亲和让行」闸随之退役。
    const prior = db
      .select({ sessionId: step.sessionId, machineId: step.machineId })
      .from(step)
      .where(and(eq(step.buildId, cand.stepRow.buildId), sql`${step.sessionId} is not null`))
      .orderBy(asc(step.createdAt))
      .all();
    const priorRow = prior.length > 0 ? (prior[prior.length - 1] ?? null) : null;
    const priorSessionId = priorRow?.sessionId ?? null;
    // #1312：上一轮会话的机器与本步领取机不同（归属机换绑 / 迁移）时告诉
    // daemon。同机不带该字段，claim 形与旧 daemon 逐字段一致。
    const priorMachineId = priorRow?.machineId ?? null;
    const sessionOnOtherMachine =
      priorSessionId !== null && priorMachineId !== null && priorMachineId !== machineId;
    // plan.md 交接缺失的 build 步强制 new session（#113 裁定候选2 兜底）：plan 关
    // 未产交接物时续轮会话里无可指方案（confirm 措辞空转 → agent 反问「哪个方案」，
    // 05 §5 实跑）；new session 令 daemon 以 todo 原始 title+spec 开工（runner
    // buildTaskPrompt），agent 必拿任务内容。plan.md 在 → 续轮不变。
    const planHandoffMissing =
      cand.stepRow.kind === 'build' && cand.buildRow.withPlan && cand.buildRow.planDocId === null;
    // review 步恒开新会话（#511）：审核是额外 agent 步，不接续主 conv 会话——
    // 审核者与被审者常是不同的 Agent/模型，接续会让它继承执行轮的上下文，
    // 且 continue 路径会吃掉服务端注入的审核材料（daemon 侧 CONTINUE_PROMPTS
    // 只有一句占位文案，plan.md 全文/变更/diff 全在 step.prompt 里）。
    // #931 freshSession（返工轮边界）：restart 复用 PR build 的首步恒开新会话
    // ——用户裁定「只复用分支、上下文真空」；续接 prior session 反而会把失败
    // 轮（典型：审核步之死）的会话语境带进返工轮。
    // #1106 派发技能注入选择（worker 步；claim = brief 的组装投递位——与
    // #823 chief 路由同位）：先于原子领取计算（纯函数无副作用，领取竞态
    // 失败至多白算一次扫描），随同一次 claim 写落 step 行——持久记录与
    // claim 载荷因此不可能漂移（「注入了什么」的正本 = 本列）。
    const skillInjection = workerSkillInjection(deps, agentRow, cand.todoRow);
    // #1217 已合并 PR 守卫探测（claim 面主防线）：todo 的首张 PR 已在 GitHub
    // merged 真值合并后，后续 build 的 plan/build 步 claim 在指令面追加「不
    // 要再开 PR」守卫（merge 步本身不开 PR、review 无关，不设防）。探测先于
    // 原子领取——#1106 同位律：领取竞态失败至多白算一次出站（无先前 PR build
    // 时零出站）。守卫命中 → 指令追加 + conv 落生效 note；open / closed-
    // unmerged / 探测不到 = null 不设防（fail-open，判据信 GitHub 真值）。
    const guardPr =
      cand.stepRow.kind === 'plan' || cand.stepRow.kind === 'build'
        ? await mergedPrElsewhere(deps, cand.todoRow.id, cand.stepRow.buildId)
        : null;
    // 原子领取：仅当仍 pending 时置 claimed（单进程 better-sqlite3 同步写）。
    const claimedAt = nowMs();
    const res = db
      .update(step)
      .set({
        status: 'claimed',
        machineId,
        claimedAt,
        lastHeartbeatAt: claimedAt,
        skillInjection,
        // #1257 挂起位清零：领取即不再是挂起态（holdCount 保留——退避档位
        // 在同一挂起系列内递进，重领后再挂起按次数升级）。
        holdReason: null,
        holdUntil: null,
      })
      .where(and(eq(step.id, cand.stepRow.id), eq(step.status, 'pending')))
      .run();
    if (res.changes === 0) continue;
    // 守卫生效即落 conv system note（板面可见——指令被 #612 词表过滤出用户
    // 话语后，可见性由本行承担；deterministic id = 同 build 多步 claim 幂等）。
    if (guardPr !== null) {
      upsertMessage(deps, {
        id: mergedPrGuardNoteRowId(cand.stepRow.buildId),
        conversationId: cand.stepRow.buildId,
        role: 'system',
        content: buildMergedPrGuardNote({
          prNumber: guardPr.prNumber,
          prUrl: guardPr.prUrl,
        }),
        createdAt: nowMs(),
      });
    }
    // claim 即 phase 推进（phase.ts 边集：queued→planning/building，02 §4.2）。
    if (cand.todoRow.phase === 'queued') {
      setTodoPhase(deps, cand.todoRow.id, cand.stepRow.kind === 'plan' ? 'planning' : 'building');
    }
    const session =
      planHandoffMissing ||
      cand.stepRow.kind === 'review' ||
      // #1250：verify 步恒新会话（上注释同律）。
      cand.stepRow.kind === 'verify' ||
      cand.stepRow.freshSession
        ? { action: 'new' as const, sessionId: null }
        : {
            action: priorSessionId ? ('continue' as const) : ('new' as const),
            sessionId: priorSessionId,
            ...(priorMachineId !== null && sessionOnOtherMachine ? { priorMachineId } : {}),
          };
    const projectRow = projectOfTodo(db, cand.todoRow);
    // repo 绑定位（M3b worktree 契约接线，02 §3/§5.5 + spec 12 G2-T2 三形态）：
    // 托管 = `<origin>/git/<teamId>/<repoName>`（本地主机代位）；github = https
    // 派生（执行凭证 = stepToken 从 github_connection 下发）；local = cloneUrl
    // 即用户仓库绝对路径（validateLocalRepoPath 规范化值——daemon 镜像 clone 源
    // 与 ff-only 落地面同吃该路径）。派生单源 = git.projectRepoRef（#511 起
    // 审核步的「有无只读检出」判据同吃它）。
    const repo = projectRepoRef(projectRow, origin);
    // worker 步 remoteTools = 记忆三件套（02 §4.4 写路径 / r5 §6：worker 侧
    // 同族工具经 remoteTools 下发，relay 服务端执行；触发 = spec 指令 + Agent
    // 裁量，宿主不做任务结束蒸馏）。MCP 授权端点随载荷（02 §7.1 per-turn 连接）。
    const workerMcp = claimMcpSlugs(machineRow.latestCliVersion, agentRow.mcpServers);
    // github 形态项目的任务元信息注入面（#446 / ADR 0005 分叉律）：词表 =
    // 项目标签集镜像（claim 时现取 DB 真值，不缓存第二份）；titleFinal =
    // issue 来源标题已真值（daemon 不指示回填）。local/hosted 缺省 meta ——
    // daemon 回落 FIXED_TAGS 现行为，文本逐字节不变。校验真值在 machine-relay.ts
    // setTaskMeta（按项目形态分支），meta 只驱动提示词面。
    const isGithubProject = projectRow?.repoKind === 'github';
    // titleFinal = 仅**导入**任务（'github-issue'，标题真值在 issue 侧，ADR
    // 0005 D5）；自建 issue 任务（'github-issue-self'，#452 / ADR 0006 D3）
    // 标题真值在 pacman 侧——占位标题仍走 agent 回填并写进 issue，恒 false。
    const taskMeta =
      isGithubProject && projectRow
        ? {
            titleFinal: cand.todoRow.sourceKind === 'github-issue',
            vocab: listProjectTagVocab(db, projectRow.id),
          }
        : undefined;
    publishStepStatus(deps, cand.stepRow.id);
    // #1217 守卫指令拼装：原 prompt 在前、守卫以尾行拼接（appendPlanLocationNote
    // 同律——单换行、包含判幂等）；原 prompt null 时守卫独占 instruction（裸守
    // 卫形，#612 词表判 synthetic 退场用户话语面）。
    const instruction =
      guardPr === null
        ? cand.stepRow.prompt
        : cand.stepRow.prompt !== null
          ? appendMergedPrGuard(cand.stepRow.prompt, {
              prNumber: guardPr.prNumber,
              prUrl: guardPr.prUrl,
            })
          : buildMergedPrGuardInstruction({ prNumber: guardPr.prNumber, prUrl: guardPr.prUrl });
    return {
      step: {
        id: cand.stepRow.id,
        buildId: cand.stepRow.buildId,
        kind: cand.stepRow.kind,
        machineId,
        createdAt: cand.stepRow.createdAt,
      },
      conversationId: cand.stepRow.buildId, // buildId ≡ conversationId（CONTEXT.md）
      session,
      ...(instruction !== null ? { instruction } : {}),
      todo: {
        id: cand.todoRow.id,
        seqNum: cand.todoRow.seqNum,
        title: cand.todoRow.title,
        spec: cand.todoRow.spec,
        ...(taskMeta !== undefined ? { meta: taskMeta } : {}),
        // #1406 来源两列：daemon 据此把 GitHub issue 导入任务的文本包进 issue
        // 原文围栏、不在 systemPrompt 里写标题（ADR 0021 D5）。
        sourceKind: cand.todoRow.sourceKind,
        sourceRef: cand.todoRow.sourceRef,
      },
      project: { id: cand.todoRow.projectId, name: projectRow?.name ?? '', repo },
      agent: {
        id: agentRow.id,
        displayName: agentRow.displayName,
        description: agentRow.description,
        provider: agentRow.provider,
        modelId: agentRow.modelId,
        thinkingLevel: agentRow.thinkingLevel,
        // 记忆注入（02 §4.4 读路径最小形，注入形 [推断] 保留）：执行 Agent 记忆，
        // 只取本任务项目的条目与全局条目（projectId 空）——别的项目的经验不进本
        // 项目的 systemPrompt（#1494）。
        memories: db
          .select({ title: agentMemory.title, content: agentMemory.content })
          .from(agentMemory)
          .where(
            and(
              eq(agentMemory.agentId, agentRow.id),
              or(eq(agentMemory.projectId, cand.todoRow.projectId), isNull(agentMemory.projectId)),
            ),
          )
          .all(),
        // #1169 拆字段透传（原 skills 单字段两义分家）：defaultSkill（携带，
        // 单值——daemon 据此排 #1116 注入绑定序首位）+ skillsAllowlist（授权；
        // null = 不限制，[] = 显式全拒，worker 步恒携带 null 或数组，chief 步
        // 不携带——两态不得在 claim 面塌缩）。
        defaultSkill: agentRow.defaultSkill,
        skillsAllowlist: agentRow.skillsAllowlist === null ? null : [...agentRow.skillsAllowlist],
        // #1106 派发技能注入选择（ids ⊆ skillsAllowlist，授权上限不变——#917
        // 硬挡判定仍吃 allowlist 全量）：本步 brief 实际注入的技能集；[] = 已
        // 计算零命中（零注入不是故障，不保底全量）。daemon 侧目录注入按本集
        // 收窄，未进集的授予技能仍可被读取（授予语义不因选择收窄）。
        injectedSkills: skillInjection.hits.map((h) => h.id),
        // 权限开关已开集（XMON-77）：原样透传（执法权在 daemon 收尾闸——只认
        // 已知档，存量残值自然无效）。恒携带含空数组（[] = 全关 = 不推不并；
        // 缺省保留给老 server 形 fail-open，两态不得混淆）。
        tools: [...agentRow.tools],
      },
      remoteTools: [...(isGithubProject ? WORKER_REMOTE_TOOLS_GITHUB : WORKER_REMOTE_TOOLS)],
      // daemon 本机工具注册面（XMON-108 R1）：server 判定的注册词集（判定
      // 单源 = claimLocalTools）。同 tools 律恒携带含空数组（[] = 无本机工具
      // 可注册；缺省保留给老 server 形，两态不得混淆）。注册 ≠ 放行：步中
      // 每条命令经预检端点复核（machine.shellEnabled 每调用重读）。
      localTools: claimLocalTools(machineRow, agentRow.tools),
      // #1307：[] 也携带（受管严格空）；缺省只留版本门未达形。
      ...(workerMcp !== undefined ? { mcpServers: workerMcp } : {}),
    };
  }
  return null;
}

/** 长轮询 claim：先试领；空手则等 wake/超时后再试一次（节奏 ≈ holdMs ≈ 75s，
 * r3 §1.5 实测 ~75–76s；wake = 低延迟派发，02 §5.4）。origin = 请求源
 * （托管 cloneUrl 本地主机代位段，02 §5.8 gitHostDomain 槽）。
 * #1065 僵尸认领：signal = 请求存活态，死请求不领活——hold 中断连（daemon
 * 被杀）由 waitWake 的 abort 监听兜底返回；第二次 tryClaim 前再复查一次
 * （wake 与 abort 竞序里 waitWake 可能已先 settle，出口复查是最后一个可靠拦
 * 点）。步留 pending，活机下一轮照领（认领失败即天然可重试）。 */
export async function claimStep(
  deps: MachineDeps,
  machineId: string,
  teamId: string,
  holdMs: number,
  origin: string,
  signal?: AbortSignal,
  body?: { maxWorkers?: number },
): Promise<ClaimedStep | null> {
  if (signal?.aborted) return null;
  // #1217：wake 基线先于一切 await 取（同步）——tryClaim 异步化（#1217 守卫
  // 探测）后「检查完 → 武装 waitWake」之间出现微任务缝，入队 wake 若落在缝里，
  // 纯 pubsub 会丢事件、claim 睡满 hold；waitWake 携带基线即可补醒。
  const sinceWake = deps.machineHub.wakeSeq(teamId);
  const first = await tryClaim(deps, machineId, teamId, origin, body?.maxWorkers);
  if (first) return first;
  await deps.machineHub.waitWake(teamId, holdMs, signal, sinceWake);
  if (signal?.aborted) return null;
  return tryClaim(deps, machineId, teamId, origin, body?.maxWorkers);
}

// —— journal：heartbeat / tool / token / upload-urls / done（02 §5.4）——————————

export function heartbeatStep(deps: MachineDeps, machineId: string, stepId: string): void {
  // #1488：步行已不存在（卡被重置 / 删除，行随 build 删掉）= 410，与「不归本机」
  // 的 404 分开——daemon 据 410 停掉在跑的会话；404 照常跑（#1483 同机重领时，
  // 被放回的步的这次 run 接着跑新的领取）。
  if (!deps.db.select({ id: step.id }).from(step).where(eq(step.id, stepId)).get()) {
    throw new HttpError(410, `step ${stepId} no longer exists`);
  }
  const row = ownedStep(deps, machineId, stepId);
  deps.db.update(step).set({ lastHeartbeatAt: nowMs() }).where(eq(step.id, row.id)).run();
}

/** 机器步所有权校验（journal 内核导出面：verb 面拆分模块共用同一条判据——
 * 未知步 404、他机步 404「(not yours)」，不做第二份实现）。 */
export function ownedStep(deps: MachineDeps, machineId: string, stepId: string) {
  const row = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!row) throw new NotFoundError(`step ${stepId}`);
  if (row.machineId !== machineId) throw new NotFoundError(`step ${stepId} (not yours)`);
  return row;
}

/** 步 → 团队（#1108 空位释放 wake 的定向键）：worker 步经 build→todo，
 * chief 步经 chief_thread；两路都不中（防御位）= null 不 wake。 */
function stepTeamId(deps: MachineDeps, stepRow: typeof step.$inferSelect): string | null {
  const { db } = deps;
  if (isChiefConversation(stepRow.buildId)) {
    return (
      db
        .select({ teamId: chiefThread.teamId })
        .from(chiefThread)
        .where(eq(chiefThread.id, stepRow.buildId))
        .get()?.teamId ?? null
    );
  }
  const todoRow = db
    .select({ teamId: todo.teamId })
    .from(build)
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(eq(build.id, stepRow.buildId))
    .get();
  return todoRow?.teamId ?? null;
}

/** 工具调用 live 回传（transcript 工具行数据面，r3 §3.5）；与终稿 transcript
 * 上传按 toolCall id 幂等去重 [设计]。chief 步行落 chief_message（线程面）。 */
export function reportTool(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  call: ToolCallRecord,
): void {
  const row = ownedStep(deps, machineId, stepId);
  const messageRow = {
    id: call.id,
    role: 'assistant' as const,
    content: { kind: 'toolcall', call },
    createdAt: call.endedAt ?? nowMs(),
  };
  if (isChiefConversation(row.buildId)) {
    upsertChiefRow(deps, { ...messageRow, threadId: row.buildId });
    return;
  }
  upsertMessage(deps, { ...messageRow, conversationId: row.buildId });
}

/** live transcript 文本增量（machineToolBodySchema 第三形 [设计]）：瞬态
 * 转发到 conversation stream，不落库——终稿经 upload-urls transcript.json
 * 兜底（02 §1.3 数据所有权不变）。 */
export function reportTranscriptDelta(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  deps.convHub?.publishTextDelta(row.buildId, text);
}

/** 思考增量（#1308）：与 reportTranscriptDelta 同纪律，进 thinking_delta，
 *  不落库。 */
export function reportThinkingDelta(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  text: string,
): void {
  const row = ownedStep(deps, machineId, stepId);
  if (text === '') return;
  deps.convHub?.publishThinkingDelta(row.buildId, text);
}

/** 段行实时落库（machineToolBodySchema 第五形 [设计]，#955 / ADR 0011 D2）：
 *  daemon 在写入端封段后上报，本层与 live 工具行同律——ownedStep 校验后
 *  **先落库再广播**（`upsertMessage`/`upsertChiefRow` 内含 publishMessage），
 *  与终稿 upload-urls 按同 id 幂等去重（`onConflictDoUpdate`）。旧 daemon 不
 *  发此形 = 零回归；旧 server 收此形按 union 解析失败 400 = daemon 侧
 *  fire-and-forget，步不受影响（与第三形同纪律）。 */
export function reportTranscriptRow(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  row: TranscriptRow,
): void {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId)) {
    upsertChiefRow(deps, {
      id: row.id,
      threadId: owned.buildId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    });
    return;
  }
  upsertMessage(deps, {
    id: row.id,
    conversationId: owned.buildId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  });
}

/** 步活动相位上报（machineToolBodySchema 第四形 [设计]，#905）：server 盖
 *  {stepId, at=收到时刻} 后瞬态进 conversation stream——`at` 用 server 钟
 *  （与 web 端 step.createdAt 走表同类偏斜，避免引入 daemon 钟第三源）。
 *  不落库；chief 步与 worker 步同径（会话流键 = row.buildId，chief 会话即
 *  threadId，upsertChiefRow 同律）。 */
export function reportActivity(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  report: StepActivityReport,
): void {
  const row = ownedStep(deps, machineId, stepId);
  deps.convHub?.publishActivity(row.buildId, { ...report, stepId, at: nowMs() });
}

/** GET /api/machine/attachment/{stepId}/{attachmentId} 服务层（#730）：daemon
 * 侧图片交付的下载面。三道闸——ownedStep（本机步，非本机 404）→ 附件 team
 * 归属（跨 team 404，requireAttachmentRow 单源）→ ready 状态（pending/failed
 * 409 原因带状态词）。载荷 = readAttachmentMeta 同形（base64 in-memory，
 * 10MiB cap 即内存预算上界）。机器 token 认证由路由中间件（/api/machine/*）
 * 先行完成；teamId 取机器行——机器与附件必须同 team。 */
export function machineAttachmentDownload(
  deps: MachineDeps,
  machineId: string,
  machineTeamId: string,
  stepId: string,
  attachmentId: string,
): MachineAttachmentResponse {
  ownedStep(deps, machineId, stepId); // 非本机步/未知步 = 404
  const meta = readAttachmentMeta(
    { db: deps.db, attachmentsDir: deps.attachmentsDir },
    machineTeamId,
    attachmentId,
  );
  return {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sizeBytes: meta.sizeBytes,
    contentBase64: meta.content,
  };
}

/** 按步技能选择面（清单与文件下发共用单源，#920）：chief 步 = 信任面全量
 * 现扫（#372 同律，不受白名单约束）；worker 步 = agentForStep 解析 Agent 的
 * skillsAllowlist 白名单 ∩ 现扫（死引用静默脱落，filterKnownSkillIds 同律）；
 * **null = 不限制 → 全量现扫**（#1169：selection 报 'all'，不再是空交集——
 * 「不限制」与「勾空全拒」两态由此分流）。 */
function skillsSelection(
  deps: MachineDeps,
  row: ReturnType<typeof ownedStep>,
): { isChief: boolean; unrestricted: boolean; wanted: LocalSkill[] } {
  const scanned = scanLocalSkills(deps.skillsDir);
  if (row.kind === 'chief') return { isChief: true, unrestricted: true, wanted: scanned };
  const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${row.buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  const agentRow = agentForStep(deps, todoRow, row.kind, row.prompt);
  // #1169：null/未设（agentRow 缺位的兜底含 null）= 不限制 → 'all'；
  // 数组（含 []）= 白名单交集 → 'whitelist'（空清单如实空）。
  const allowlist = agentRow?.skillsAllowlist ?? null;
  if (allowlist === null) return { isChief: false, unrestricted: true, wanted: scanned };
  const whitelist = new Set(allowlist);
  return {
    isChief: false,
    unrestricted: false,
    wanted: scanned.filter((s) => whitelist.has(s.id)),
  };
}

/** GET /api/machine/skills/{stepId}（XMON-109 S1 端点，#920 改「清单 +
 * 按需拉」；MACHINE_WIRE_EXTENSIONS 登记 [设计]）：S2 daemon 物化消费契约
 * ——按步出技能文件清单（path/sizeBytes/sha256），文件本体走
 * machineSkillFile 按需拉。不设字节闸：旧「一次 GET 塞全量全文」的
 * 512KB/2MB 整包闸对着真实技能库（104 技能 / 18.4MB）必超——分发通道
 * 从未成功过（#920 根因）；按需拉后单请求预算 = 单文件，完整性由 daemon
 * 逐文件 sha256 + sizeBytes 双校验兜底。 */
export function machineSkillsManifest(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): MachineSkillsManifestResponse {
  const row = ownedStep(deps, machineId, stepId); // 非本步凭证/未知步 = 404
  const { isChief, unrestricted, wanted } = skillsSelection(deps, row);
  const skills: MachineSkillsManifestResponse['skills'] = [];
  for (const skill of wanted) {
    const dir = join(deps.skillsDir, skill.dirName);
    const files: MachineSkillsManifestResponse['skills'][number]['files'] = [];
    for (const path of listSkillFiles(dir)) {
      const bytes = readSkillFileBytes(dir, path); // 链接逃逸/缺位 = null（防御位跳过）
      if (bytes === null) continue;
      files.push({
        path,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    skills.push({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      dirName: skill.dirName,
      files,
    });
  }
  // #1169：不限制 worker（skillsAllowlist=null）与 chief 同报 'all'——全量
  // 出包语义；白名单（含空 []）报 'whitelist'（daemon 据此区分点名语境）。
  return { selection: isChief || unrestricted ? 'all' : 'whitelist', skills };
}

/** GET /api/machine/skills/{stepId}/file?dirName=&path=（#920 按需拉取面，
 * MACHINE_WIRE_EXTENSIONS 登记 [设计]）：下发清单内单文件原始字节。选择面
 * 与清单端点同源（skillsSelection 重算——含 realpath/id 去重与白名单），
 * 文件必须在该技能的 listSkillFiles 清单内：白名单外技能、清单外路径
 * （未知文件/目录/符号链接/`..` 逃逸形）一律 404 不泄存在性，readSkillFile-
 * Bytes 守卫再兜一道（纵深防御）。每请求全扫的成本（104 技能库 ~10ms 量级）
 * 对分发可接受：daemon 内容寻址缓存保证每个内容版本每文件只拉一次。 */
export function machineSkillFile(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  dirName: string,
  filePath: string,
): Buffer {
  const row = ownedStep(deps, machineId, stepId); // 非本步凭证/未知步 = 404
  const { wanted } = skillsSelection(deps, row);
  const skill = wanted.find((s) => s.dirName === dirName);
  if (!skill) throw new NotFoundError(`skill ${dirName}`);
  const dir = join(deps.skillsDir, skill.dirName);
  if (!listSkillFiles(dir).includes(filePath)) throw new NotFoundError(`file ${filePath}`);
  const bytes = readSkillFileBytes(dir, filePath);
  if (bytes === null) throw new NotFoundError(`file ${filePath}`);
  return bytes;
}

type MessageRowInput = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  createdAt: number;
};

/** transcript 行幂等落库 + 会话流即时推送（live 工具行与终稿上传共用；
 * 与终稿按 id 去重 = onConflict upsert [设计]）。journal 内核导出面
 * （machine-uploads.ts 终稿上传同消费）。 */
export function upsertMessage(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { conversationId: string },
): void {
  deps.db
    .insert(message)
    .values(row)
    .onConflictDoUpdate({
      target: message.id,
      set: { role: row.role, content: row.content, createdAt: row.createdAt },
    })
    .run();
  deps.convHub?.publishMessage(row.conversationId, row);
}

/** chief 线程行同形（chief_message 表 + 会话流键 = chief-<threadId>）。
 * journal 内核导出面（machine-uploads.ts 终稿上传同消费）。 */
export function upsertChiefRow(
  deps: { db: Db; convHub?: ConversationStreamHub },
  row: MessageRowInput & { threadId: string },
): void {
  upsertChiefMessage(deps.db, row);
  deps.convHub?.publishMessage(row.threadId, row);
}

/** #1257 额度挂起（done 面分类 quota 的收口）：步回 pending（认领位复位 +
 * sessionId 续接面已在 finishStep 落位，重领走 continue）+ 退避档位按
 * holdCount 递进；可见性 = 会话 system 行（原因原文 + 下次尝试时刻，
 * deterministic id 幂等覆盖——多次挂起更新同一行，不叠行）；事件面 =
 * step pending 事件（与失联释放同形）+ 团队 wake（退避到期后 75s 长轮询
 * 不等满）。todo/build 不落任何失败痕迹（挂起不是失败）。重领成功路径在
 * claim 面（holdUntil 过滤 + hold 清位）。 */
function holdStepForQuota(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  outcome: MachineDoneBody,
): void {
  const { db } = deps;
  const holdCount = stepRow.holdCount + 1;
  const holdUntil = nowMs() + quotaHoldBackoffMs(holdCount);
  db.update(step)
    .set({ status: 'pending', machineId: null, holdReason: 'quota', holdUntil, holdCount })
    .where(eq(step.id, stepRow.id))
    .run();
  const note = quotaHoldNote(outcome.errorMessage ?? '', holdUntil);
  if (isChiefConversation(stepRow.buildId)) {
    upsertChiefRow(deps, {
      id: `quota-hold-${stepRow.id}`,
      threadId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  } else {
    upsertMessage(deps, {
      id: `quota-hold-${stepRow.id}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  }
  publishStepStatus(deps, stepRow.id);
  const teamId = stepTeamId(deps, stepRow);
  if (teamId !== null) deps.machineHub.wake(teamId);
}

/** per-step 凭证下发（02 §5.4/§8：模型 key + git 凭证 + 团队密钥取用面，
 * daemon 内存持有不落盘常驻）。解析链单源 = M2c services/credentials.ts
 * （step → build → todo → assignment → agent → provider → SecretBox 解密 +
 * 按 step kind 收窄的 secrets 取用面）；
 * 本层只做机器所有权校验 + wire 形状映射（machineTokenResponseSchema）。 */
export function stepToken(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): MachineTokenResponse {
  const owned = ownedStep(deps, machineId, stepId);
  if (isChiefConversation(owned.buildId)) return chiefStepToken(deps, stepId, owned.buildId);
  const bundle = resolveStepCredentials({ db: deps.db, box: deps.box }, stepId);
  // provider 行为空（preset 目录形态）时回退 agent.provider 直投 api_key kind。
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  const buildRow = stepRow
    ? deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get()
    : undefined;
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const agentRow =
    stepRow && todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
  // repo 形态分流 git 凭证（02 §3 凭证纪律：仅 per-step 注入；relay 工具名对照
  // push_credential，r5 §3.1）：hosted = 一次性 gitAccess key 发行；github =
  // github_connection token（spec 12 G2-T2 执行凭证面）；local = null（本地
  // 路径 clone/push 无需凭证）。
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  const git =
    projectRow?.repoKind === 'hosted' && todoRow
      ? issueStepGitCredential(deps, { teamId: todoRow.teamId, stepId })
      : projectRow?.repoKind === 'github' && todoRow
        ? githubExecCredential(deps, todoRow.teamId)
        : null;
  return {
    provider: toProviderConfig(bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    git,
  };
}

/** GitHub 执行凭证（spec 12 G2-T2）：connection 行 token → per-step
 * GitCredentials（basic auth 用户名固定 x-access-token，GitHub 约定；daemon
 * 消费形 = git.ts gitCredentialEnv，不进 argv / 不落盘）。未连接 = null——
 * 私有仓匿名 clone/push 的失败原文归 daemon 步 reason，不在 token 端点造错。
 * 凭证生命周期 = connection 行（非 hosted 族一次性 key；步收尾
 * revokeStepGitCredential 对该 stepId 无行可删 = no-op）。 */
function githubExecCredential(deps: MachineDeps, teamId: string): GitCredentials | null {
  const token = openGithubToken({ db: deps.db, box: deps.box }, teamId);
  return token !== null ? { username: GITHUB_ACCESS_TOKEN_USERNAME, password: token } : null;
}

/** provider 行 → wire ProviderConfig（custom http 端点）；无 custom 行回退
 * agent.provider 直投 api_key kind（preset 38 目录，r3 §2）。runtime 身份
 * （spec 17 A4，claude-code ∈ BACKEND_RUNTIME_IDS）例外：无可代发之物，
 * 回退支返回 null——凭据机器本地（claude 登录或 ANTHROPIC_API_KEY），不再
 * 凭空造 api_key 配置（旧行为会让 daemon 在 pi 后端炸 model not found）。
 * stepToken 与 chiefStepToken 共用（去重）；bundle 优先级不动（daemon 侧
 * runtime 分支才是权威短路——mixed-version 兼容面见 runner）。导出供
 * provider-config.test 钉非 runtime 支零回归。 */
export function toProviderConfig(
  bundleProvider: StepCredentialBundle['provider'],
  agentProviderId: string | null | undefined,
): ProviderConfig | null {
  if (bundleProvider) {
    return {
      kind: 'http', // custom 端点（baseUrl 在位；r3 §2 记录形状投影）
      providerId: bundleProvider.providerId,
      label: bundleProvider.label,
      baseUrl: bundleProvider.baseUrl,
      api: bundleProvider.api,
      authHeader: bundleProvider.authHeader,
      // 兼容旋钮（#654）：行值原样透传；老 server 不带此位 = daemon 走 pi
      // 端点探测默认（现状行为，mixed-version 零回归）。
      compat: bundleProvider.compat,
      models: bundleProvider.models,
      ...(bundleProvider.apiKey !== null ? { apiKey: bundleProvider.apiKey } : {}),
    };
  }
  if (isBackendRuntimeId(agentProviderId)) return null;
  return agentProviderId ? { kind: 'api_key', providerId: agentProviderId } : null;
}

/** chief 步凭证（绑定 Agent 模型 key；secrets 取用面恒空——chief = 总管探索
 * 步，records/step.ts stepTakesSecrets）。git 槽恒 null——chief 「探测仓库」
 * 经 docs relay 走 server 端裸库读（A4 黑盒逼近 r5 §3.1 的 worktree
 * `git show`），daemon 侧不开 worktree、不需 per-step git 凭证；不下发死载荷。 */
function chiefStepToken(
  deps: MachineDeps,
  _stepId: string,
  conversationId: string,
): MachineTokenResponse {
  const threadId = conversationId; // conv id ≡ chief-<threadId> 同值（r5 §3.6）
  const bundle = resolveChiefStepCredentials({ db: deps.db, box: deps.box }, threadId);
  const threadRow = deps.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
  const chiefRow = threadRow
    ? deps.db.select().from(chief).where(eq(chief.id, threadRow.chiefId)).get()
    : undefined;
  const agentRow = chiefRow?.agentId
    ? deps.db.select().from(agent).where(eq(agent.id, chiefRow.agentId)).get()
    : undefined;
  return {
    provider: toProviderConfig(bundle.provider, agentRow?.provider),
    secrets: bundle.secrets,
    git: null,
  };
}

/** #1186 技能注入断言：done 携带的实际注入名集 × 步上的选择 hits × agent
 * 授权面 × 已落库 toolcall 事实。副作用只有一条 system 行（deterministic
 * id，recover 重放 upsert 幂等）。不改步结果、相位、合并闸。quota 挂起
 * 不进这里（那次运行还没结束）。facts 缺席（旧 daemon）由调用方跳过。
 * worker 步找不到 agent 行 = 不写、不抛（收尾照常）。chief 步按不限制、
 * 无选择收窄计（daemon 不对 chief 套 allowlist）。 */
function recordSkillInjectionCheck(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  facts: SkillInjectionFacts,
): void {
  const chiefStep = stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId);
  let skillsAllowlist: readonly string[] | null = null;
  let defaultSkill: string | null = null;
  let requested: string[] | undefined;
  if (!chiefStep) {
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const agentRow = todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
    if (agentRow == null) return;
    skillsAllowlist = agentRow.skillsAllowlist ?? null;
    defaultSkill = agentRow.defaultSkill;
    if (stepRow.skillInjection == null) {
      requested = undefined;
    } else {
      const ids = stepRow.skillInjection.hits.map((h) => h.id);
      requested =
        defaultSkill == null || defaultSkill === ''
          ? ids
          : [defaultSkill, ...ids.filter((id) => id !== defaultSkill)];
    }
  }
  const contents = (
    chiefStep
      ? deps.db
          .select({ content: chiefMessage.content })
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, stepRow.buildId))
          .all()
      : deps.db
          .select({ content: message.content })
          .from(message)
          .where(eq(message.conversationId, stepRow.buildId))
          .all()
  ).map((row) => row.content);
  const verdict = assertSkillInjection({
    skillsAllowlist,
    defaultSkill,
    requested,
    names: facts,
    facts: skillFactsFromContents(contents),
  });
  const row = {
    id: `skill-injection-${stepRow.id}`,
    role: 'system' as const,
    content: JSON.stringify({
      kind: SKILL_INJECTION_CHECK_KIND,
      level: verdict.level,
      reds: verdict.reds,
      yellows: verdict.yellows,
      injected: facts.injected,
      omitted: facts.omitted,
      unrendered: facts.unrendered,
    }),
    createdAt: nowMs(),
  };
  if (chiefStep) upsertChiefRow(deps, { ...row, threadId: stepRow.buildId });
  else upsertMessage(deps, { ...row, conversationId: stepRow.buildId });
}

// —— done（步骤收尾 + phase 推进 + token 记账，02 §5.4/§4.2）——————————————————

export async function finishStep(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineDoneBody,
): Promise<void> {
  const { db } = deps;
  // #1473 回报只对仍 claimed 的步生效：已收尾（done 重放，XMON-59）、被扫尾
  // 停掉、或已被放回 pending（machineId 已清空）的步，一律答 ok、不写——落账
  // 函数都不看步当前状态，放进去就会把步和卡片再改一遍。凭证照收（凭证生命
  // 周期 = 步生命周期，这次执行已经结束）。归属：记名本机，或已放回（无
  // 记名）且同团队；他机记名的步、他团队的步对本机仍是 404。
  const found = db.select().from(step).where(eq(step.id, stepId)).get();
  if (found && found.status !== 'claimed') {
    const released =
      found.machineId === null &&
      stepTeamId(deps, found) ===
        db.select({ teamId: machine.teamId }).from(machine).where(eq(machine.id, machineId)).get()
          ?.teamId;
    if (found.machineId === machineId || released) {
      revokeStepGitCredential(deps, stepId);
      return;
    }
  }
  const stepRow = ownedStep(deps, machineId, stepId);
  // per-step 一次性 git 凭证回收（步收尾即撤销，成败均回收——凭证生命周期 =
  // 步生命周期，02 §8 运行时层「不落盘常驻」的 server 半）。
  revokeStepGitCredential(deps, stepId);
  // #1217 第二张 PR 警告（done 回填面兜底）：本步回填了新 PR 且同 todo 已有
  // 更早的 GitHub merged PR（守卫探测判，排除本 build 自身）——agent 无视
  // claim 面守卫指令仍开了第二张 PR，疑似重复交付。落 conv system 警告
  // note 点名双 PR（PR 面可见；合并面 409 之外的第二道兜底——即便合并闸
  // 也会拦，警告先让板面看得见）。deterministic id = 同 build 重报幂等；
  // 无先前 PR build / 探测不到 = 不警告（fail-open，正常落地路零出站）。
  let priorMerged: { prNumber: number; prUrl: string | null } | null = null;
  if (body.prUrl !== undefined && body.prNumber !== undefined) {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow) priorMerged = await mergedPrElsewhere(deps, buildRow.todoId, stepRow.buildId);
  }
  // 合并步落地（02 §4.2：merge 202 delegated → 机器 git merge + push → server
  // bare repo 默认分支 fast-forward [设计]；r3 §3.6「服务端 main 验证」同语义）。
  // 落地失败（非快进/无 commit）= 步按 failed 收尾（失败仅人工重跑，02/A6）。
  // #1487（2026-10-22 裁决方案 a）：卡在合并步跑的时候被关闭或挪回待开始，
  // 成功回报不落地——默认分支不动，卡保持现相位，下面落一行时间线说明。
  const mergeSuccess = stepRow.kind === 'merge' && body.status === 'success';
  let landingSkipped = mergeSuccess && mergeCardLeftReview(deps, stepRow);
  let landingError: string | null = null;
  if (mergeSuccess && !landingSkipped) {
    const landing = await applyMergeLanding(deps, stepRow, body.commit ?? null);
    if (landing === MERGE_LANDING_SKIPPED) landingSkipped = true;
    else landingError = landing;
  }
  // #1473 await 之后复查领取：探测 / 落地期间扫尾可能已把步放回 pending、
  // 又被领走（同机或他机）。这份回报属于上一次领取，不能收掉新的那次——
  // 409 让 daemon 留着 journal；在这之前没有写过步、build、卡片（合并落地
  // 例外：默认分支已快进到这个 commit，重领后的合并步再落一次是同一 commit，
  // 快进幂等）。之后到函数结束都是同步写，不会再被别的请求插进来。
  {
    const current = db.select().from(step).where(eq(step.id, stepId)).get();
    if (
      current?.status !== 'claimed' ||
      current.machineId !== machineId ||
      current.claimedAt !== stepRow.claimedAt
    ) {
      throw conflict(`step ${stepId} was released or claimed again while its report was applied`);
    }
  }
  // #1108 空位释放 wake：本机一个 claimed 位即将转终态——唤醒全团队挂起的
  // claim 长轮询（本机若无在飞空位会立刻领队头 pending 步；它机各多一次
  // tryClaim，同步读可忽略）。没有它，满载机器的空位要等满 ~75s hold 才
  // 被下一轮重试发现（enqueue wake 只覆盖新步入队路径）。放在复查之后：
  // 409 的回报不释放空位。被唤醒的领取在下一拍才跑，看到的是下面写完的状态。
  {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null) deps.machineHub.wake(teamId);
  }
  if (landingSkipped) {
    upsertMessage(deps, {
      id: `merge-not-landed-${stepId}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: MERGE_NOT_LANDED_NOTE,
      createdAt: nowMs(),
    });
  }
  if (body.sessionId !== undefined) {
    db.update(step).set({ sessionId: body.sessionId }).where(eq(step.id, stepId)).run();
  }
  // per-step checkpoint（M3b done 回传 commit：「恢复到此处」数据源 +
  // 合并步落地键，r3 §3.5/§3.9）。
  if (body.commit !== undefined) {
    db.update(step).set({ checkpointCommit: body.commit }).where(eq(step.id, stepId)).run();
  }
  // 交付面回填（#704 / B-C16，Multica link-back 只读方向）：daemon 步收尾
  // 上报的 PR（github 形态 agent 开的 PR）与变更 diff（非 hosted 形态投影
  // 真值源）落 build 行。字段缺席 = 未上报/探测失败——保持 null 不造数据
  // （失败方式 ②④：无 PR 不造假、探测失败按「未知」）。changesDiff 超上限
  // 丢弃（daemon 侧同闸，此处第二道——两侧闸都不打爆 done 通道与 DB）。
  // chief 步 buildId 无 build 行，update 无匹配 = no-op。
  {
    const sets: Partial<typeof build.$inferSelect> = {};
    if (body.prUrl !== undefined && body.prNumber !== undefined) {
      sets.prUrl = body.prUrl;
      sets.prNumber = body.prNumber;
    }
    if (body.changesDiff !== undefined && body.changesDiff.length <= CHANGES_DIFF_MAX_BYTES) {
      const files = parseUnifiedDiff(body.changesDiff);
      sets.changes =
        files.length === 0 && diffTextNamesAFile(body.changesDiff)
          ? { files, changed: true }
          : files;
    }
    if (Object.keys(sets).length > 0) {
      const updated = db.update(build).set(sets).where(eq(build.id, stepRow.buildId)).run();
      // 回填即发布：build doc SSE 事件（web「分支 / PR」面板与 changes 面的
      // 失效重取键）；行不存在（chief conv）changes=0 时不发布。
      if (updated.changes > 0) {
        const row = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
        const todoRow = row
          ? db.select().from(todo).where(eq(todo.id, row.todoId)).get()
          : undefined;
        if (row && todoRow) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
      }
    }
  }
  if (priorMerged !== null && body.prNumber !== undefined) {
    upsertMessage(deps, {
      id: secondPrWarningNoteRowId(stepRow.buildId),
      conversationId: stepRow.buildId,
      role: 'system',
      content: buildSecondPrWarningNote({
        prNumber: body.prNumber,
        mergedPrNumber: priorMerged.prNumber,
        mergedPrUrl: priorMerged.prUrl,
      }),
      createdAt: nowMs(),
    });
  }
  const outcome: MachineDoneBody =
    landingError !== null ? { ...body, status: 'failed', errorMessage: landingError } : body;
  // token 记账（02 §6.2：build × model × 四维；成本五列 = #927——pi 报的
  // cost 原样累积，缺省按 0 记：旧 daemon / claude-code 行不带 cost 位，
  // 四维行为零变化）。
  for (const u of outcome.usage ?? []) {
    const cost = u.cost;
    db.insert(tokenUsage)
      .values({
        buildId: stepRow.buildId,
        model: u.model,
        input: u.input,
        output: u.output,
        cacheRead: u.cacheRead,
        cacheWrite: u.cacheWrite,
        costInput: cost?.input ?? 0,
        costOutput: cost?.output ?? 0,
        costCacheRead: cost?.cacheRead ?? 0,
        costCacheWrite: cost?.cacheWrite ?? 0,
        costTotal: cost?.total ?? 0,
      })
      .onConflictDoUpdate({
        target: [tokenUsage.buildId, tokenUsage.model],
        set: {
          input: sql`${tokenUsage.input} + ${u.input}`,
          output: sql`${tokenUsage.output} + ${u.output}`,
          cacheRead: sql`${tokenUsage.cacheRead} + ${u.cacheRead}`,
          cacheWrite: sql`${tokenUsage.cacheWrite} + ${u.cacheWrite}`,
          costInput: sql`${tokenUsage.costInput} + ${cost?.input ?? 0}`,
          costOutput: sql`${tokenUsage.costOutput} + ${cost?.output ?? 0}`,
          costCacheRead: sql`${tokenUsage.costCacheRead} + ${cost?.cacheRead ?? 0}`,
          costCacheWrite: sql`${tokenUsage.costCacheWrite} + ${cost?.cacheWrite ?? 0}`,
          costTotal: sql`${tokenUsage.costTotal} + ${cost?.total ?? 0}`,
        },
      })
      .run();
  }
  // stop_pending 卫生清理（全终态共通，M7 #308）：stop 与自然完成/失败的
  // 竞态残留随收尾即清（拉取-确认面另有定向步校验双保险，不复活）。
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  // #1261 配额熔断分支：daemon 识别 quota/capacity 后随 done 携带 quotaBlock
  // ——挂起等额度（waiting_quota + 通知 + 探测续跑），**不**走下方 failed 漏斗
  // （todo 不落 failed）。早于 chief/success/stopped/failed 各分支：配额事件
  // 与步形态无关（chief 步挂起 = 回合冻结，activeRun 保持；worker 步挂起 =
  // todo building 保持）。新 daemon 携带结构化 quotaBlock 走本分支；无
  // quotaBlock 的旧 daemon 落到下方 #1257 文本分类兜底分支（同挂起语义）。
  if (outcome.status === 'failed' && outcome.quotaBlock !== undefined) {
    applyQuotaWaitStep(deps, stepRow, outcome.quotaBlock);
    return;
  }
  // #1257 额度挂起（文本兜底腿）：done(failed) 且错误分类 quota → 步不判死
  // （配额事件，不是任务失败）——挂起等额度：退避到期重领即一次「额度恢复
  // 了吗」探测，恢复后自动续跑，无需人工重跑。sessionId 续接面已在上方落位
  // （重领走 continue）。
  if (outcome.status === 'failed' && classifyStepFailure(outcome.errorMessage ?? '') === 'quota') {
    holdStepForQuota(deps, stepRow, outcome);
    return;
  }
  // #1288 model_unavailable 回填：step 撞 /v1/messages 404（模型已被上游
  // 下架）→ 标注 dead 即时生效（后续选择器/闸即时置灰 + 拒绝）。
  // 发生在 applyStepFailure 之前——dead 回填与失败收尾两条轨道并行，
  // 回填失败不影响步失败漏斗（markModelDead 是纯内存写，永不抛）。
  if (
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable'
  ) {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow) {
      const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
      const agentId =
        todoRow?.assignment?.build?.agentId ?? todoRow?.assignment?.plan?.agentId ?? null;
      if (agentId) {
        const agentRow = db.select().from(agent).where(eq(agent.id, agentId)).get();
        if (agentRow?.modelId && agentRow?.provider) {
          markModelDead(agentRow.provider, agentRow.modelId);
        }
      }
    }
  }
  // #1186：配额挂起已经 return（那次运行还没结束）。断言是旁路写，
  // 写在 chief / success / stopped / failed 分叉之前，三支收尾都带上。
  if (outcome.skillInjectionFacts !== undefined) {
    recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
  }
  // chief 步收尾（无 build/phase/merge；thread 面 + chief_message 通知，r5 §3.6/
  // §7.2）。token 记账已按 buildId=chief conv id 落位（context.tokens 数据源）。
  if (stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId)) {
    db.update(step)
      .set({ status: outcome.status === 'success' ? 'done' : 'failed' })
      .where(eq(step.id, stepId))
      .run();
    publishStepStatus(deps, stepId);
    // #1049 步终态收口：pending 问答卡翻 cancelled（等答 hold 随即返回，
    // D4 出口——挂住的回合不无限占线）。先于 finishChiefTurn：翻面事件沿
    // 会话流到达 web 时线程行还是回合态，卡片上下文自洽。
    cancelPendingQuestions(
      {
        db: deps.db,
        hub: deps.hub,
        user: deps.user,
        ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
      },
      stepRow.buildId,
      '回合已结束',
    );
    finishChiefTurn(deps, stepRow.buildId, outcome);
    if (outcome.status === 'success') notifyChiefTurn(deps, stepRow.buildId, stepRow.prompt);
    // #631 失败闭环：build 路径的失败原因有 build.errorMessage 承接，chief
    // 路径此前零承接——daemon 上报的 errorMessage 落一条 system 行进线程
    // （machine_selected 同族 content 形态 = JSON 串），会话流 message 事件
    // 即时推送，web 面渲染为失败行 + toast。无 errorMessage 的终态（stopped
    // 等）不落。
    if (outcome.status === 'failed' && outcome.errorMessage) {
      upsertChiefRow(deps, {
        id: `chief-err-${stepId}`,
        threadId: stepRow.buildId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: outcome.errorMessage }),
        createdAt: nowMs(),
      });
    }
    return;
  }
  if (outcome.status === 'success') {
    completeStep(deps, stepId, {
      hasChanges: outcome.hasChanges,
      // #1195 工作分支偏离透传（闸 2 点名分支偏离的入参面）。
      ...(outcome.workBranchDrift !== undefined
        ? { workBranchDrift: outcome.workBranchDrift }
        : {}),
      ...(outcome.findings !== undefined ? { findings: outcome.findings } : {}),
      ...(outcome.findingsError !== undefined ? { findingsError: outcome.findingsError } : {}),
      // #1250 verify 步 verdict 透传（completeStep verify 分支消费）。
      ...(outcome.verifyVerdict !== undefined ? { verifyVerdict: outcome.verifyVerdict } : {}),
      ...(outcome.verifyVerdictError !== undefined
        ? { verifyVerdictError: outcome.verifyVerdictError }
        : {}),
    });
    publishStepStatus(deps, stepId);
    return;
  }
  if (outcome.status === 'stopped') {
    // 停止钮落账（M7 #308，r9 §3.3）：step stopped + build.errorMessage
    // 取消标记 + gate 回落（上一完成 turn 关口 / prevPhase）+ stopPending 清。
    // 落账单源 = builds.applyStoppedStep（pending 步即时取消路径同函数）；
    // 不走 failed 漏斗（todo 不落 failed，r9 #12 → 审核实证）。
    applyStoppedStep(deps, stepId);
    publishStepStatus(deps, stepId);
    return;
  }
  // failed：步级失败无自动重跑（02 §4.2/r3 §3.7），todo → failed +
  // build.errorMessage。落账单源 = builds.applyStepFailure（#703 产物闸的
  // 失败收尾同函数——闸失败与机器报失败走同一条漏斗）。
  applyStepFailure(deps, stepRow, outcome.errorMessage ?? `step ${outcome.status}`);
  publishStepStatus(deps, stepId);
}

/** applyMergeLanding 的 git 检查期间卡被关闭 / 挪回待开始：不快进（#1487）。 */
const MERGE_LANDING_SKIPPED = Symbol('merge-landing-skipped');

/** #1487 合并没落地的时间线说明（卡在合并步跑的时候已关闭或挪回待开始）。 */
export const MERGE_NOT_LANDED_NOTE =
  '合并步跑完时任务已取消或已挪回待开始，合并没有落地：默认分支保持不变';

/** 合并步所属的卡已离开审核、走向取消（closed / todo）——成功回报不落地
 * （#1487）。done 不在此列：手动标完成期间合并跑完照常落地。 */
function mergeCardLeftReview(deps: MachineDeps, stepRow: typeof step.$inferSelect): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  return todoRow?.phase === 'closed' || todoRow?.phase === 'todo';
}

/** 合并落地（M3b [设计]，02 §4.2 merge 202 delegated 的 server 半）：机器合并
 * 步 push 后，bare repo 默认分支 fast-forward 到 done 回传的 conv 分支 HEAD。
 * 护栏：现 tip 必须是该 commit 祖先（非快进 = main 在合并窗口被推进 → 步按
 * failed 收尾，人工重跑，02/A6）。GitHub 形态不落地本地 ref（PR 面归后票，
 * 02 §3 接入形态）。返回 null = 落地成功/不适用；string = 失败原因。 */
async function applyMergeLanding(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  commit: string | null,
): Promise<string | null | typeof MERGE_LANDING_SKIPPED> {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  const todoRow = buildRow
    ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
    : undefined;
  const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
  if (!todoRow || projectRow?.repoKind !== 'hosted' || projectRow.repoName === null) {
    return null; // 未绑托管 repo：无可落地 ref（github 形态 PR 面归后票）。
  }
  if (commit === null) return 'merge step reported no commit';
  const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
  const { defaultBranch } = await systemGitOps.listBranches(dir);
  const branch = defaultBranch ?? 'main'; // main 正典值（r3 §3.6 origin/main）
  const tip = await systemGitOps.resolveCommit(dir, `refs/heads/${branch}`);
  if (tip !== null && tip !== commit) {
    const ancestor = await systemGitOps.isAncestor(dir, tip, commit);
    if (!ancestor) {
      return `merge landing refused: ${branch} moved (non-fast-forward) — rerun the task`;
    }
  }
  // 上面的 git 检查都是 await：期间卡可能被关闭。快进前最后再看一次（与
  // updateBranchRef 的发起同步，之间插不进别的请求）。
  if (mergeCardLeftReview(deps, stepRow)) return MERGE_LANDING_SKIPPED;
  await systemGitOps.updateBranchRef(dir, branch, commit);
  return null;
}
