// 机器主循环（02 §5.4 上线序列 canon + r3 §1.5 实测行为）：
// `Loading pi runtime…` → enroll（如未注册）→ presence → `Online (machineId=…);
// polling <url>` → 防睡（caffeinate 类）→ `[recover]` 步 journal 恢复 →
// `[wake] push channel connected` →
// claim 长轮询循环（断网指数退避封顶 30s，presence 心跳并行失败，进程不退出）。
// 退出：SIGTERM → `[machine] Shutting down…`（`[supervisor] stopped` 在
// supervisor 侧，02 §5.3/r3 §1.5）。

import { type ChildProcess, spawn } from 'node:child_process';
import type { AgentBackend, AgentSessionHandle, ClaimedStep, DeliveredImage } from '@pacman/shared';
import {
  CLAIM_BACKOFF_CAP_MS,
  CLAIM_POLL_INTERVAL_MS,
  isBackendRuntimeId,
  ORPHAN_WORKTREE_TTL_MS,
} from '@pacman/shared';
import { createClaudeCodeBackend } from './backend/claude-code.js';
import { createPiBackend, piSessionPolicyLine } from './backend/pi.js';
import { type ClaudeCodeAuthProbe, probeClaudeCodeAuth } from './claude-code-auth.js';
import { type ClaudeBinInfo, probeClaudeBin } from './claude-code-bin.js';
import { readClaudeCodeReport } from './claude-code-models.js';
import type { DaemonConfig } from './config.js';
import { StepJournal } from './journal.js';
import type { DaemonLogger } from './log.js';
import { type MachineApi, MachineClient } from './machine-client.js';
import { setupProxy } from './proxy.js';
import { resumePendingUpload, runStep, type StopRequest } from './runner.js';
import {
  ensureStateDirs,
  loadMachineJson,
  loadOrCreateDeviceJson,
  recordSession,
  resolveSessionFile,
  type StatePaths,
  saveMachineJson,
} from './state.js';
import { resolveStepImages, sweepStepAttachments } from './step-attachments.js';
import { performSync } from './sync.js';
import { DAEMON_VERSION } from './version.js';
import { WorkspaceManager } from './workspace.js';

export interface MachineLoopOpts {
  config: DaemonConfig;
  paths: StatePaths;
  logger: DaemonLogger;
  /** pi 后端测试注入面（缺省 = 内建构造；spec 17 A3 起 per-step 解析的
   * 默认支）。 */
  backend?: AgentBackend;
  /** claude-code 后端测试注入面（spec 17 A3；缺省 = 首个 runtime 步惰性
   * 构造，canon 行 `Loading claude-code runtime…` 与 pi 行对仗）。 */
  claudeCodeBackend?: AgentBackend;
  /** claude-code 凭据预检注入面（#867 T6；缺省 = 真探针
   * `claude auth status`。测试注入固定三态，免得 CI 上真探成「未登录」）。 */
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  fetchImpl?: typeof fetch;
  client?: MachineApi;
  /** claim 客户端侧护栏（server hold + 余量）[设计]。 */
  claimTimeoutMs?: number;
  /** presence 心跳节奏 [设计]（r3 未采具体值）。 */
  presenceIntervalMs?: number;
  /** claim 断网退避基数（默认 1s，指数翻倍封顶 CLAIM_BACKOFF_CAP_MS=30s，
   * r3 §1.5）；测试注入缩短时标。 */
  claimBackoffBaseMs?: number;
  /** 代理探测 env 面（默认 process.env；测试注入 {} 关闭）。 */
  proxyEnv?: NodeJS.ProcessEnv;
  /** #1148 cap 解析 env 源（PACMAN_DAEMON_MAX_CONCURRENT；默认 process.env，
   * proxyEnv 同律——测试注入隔离）。 */
  capEnv?: NodeJS.ProcessEnv;
  heartbeatIntervalMs?: number;
  /** 闲置防睡（darwin caffeinate；linux systemd-inhibit [推断] 可缺省，
   * 01 §4.3）。测试关闭。 */
  idleSleepPrevention?: boolean;
  /** 孤儿 worktree 回收 TTL（缺省 7×24h，02 §5.5/r3 §1.4；测试注入缩短）。 */
  orphanTtlMs?: number;
  /** #1149 环境钩子超时（缺省 WORKSPACE_HOOK_TIMEOUT_MS 20min；测试注入
   * 缩短时标；PACMAN_HOOK_TIMEOUT_MS 覆写在 cli.ts 组装入参时生效）。 */
  hookTimeoutMs?: number;
}

export interface MachineHandle {
  machineId: string;
  /** 优雅停止：等待在跑步收尾后退出（r3 §1.5 SIGTERM 序列）。硬崩溃面
   * （journal 残留 + recover 对账）以子进程 SIGKILL 实测（T2 验证）。
   * cause = 触发面标识（#691：信号名进退出行，事后可考）。 */
  stop(cause?: string): Promise<void>;
  /** 主循环结束（stop 后 resolve）。 */
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 指数退避封顶 30s（r3 §1.5「断网 claim 指数退避封顶 30s」）。 */
export function nextBackoffMs(current: number, cap = CLAIM_BACKOFF_CAP_MS): number {
  return Math.min(current * 2, cap);
}

// —— #1148 并发面三个常量单源（本模块 = 分配与解析的唯一落点）————————————

/** #1148 env 兜底旋钮名：daemon worker 并发上限的 env 覆盖位（对齐 Multica
 * `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` 的覆盖关系——env 是操作员对这台
 * daemon 的显式意志，DB machine 行是 server 侧团队配置）。取值序（钉死）：
 * env > DB（me.maxConcurrent）> 默认 1。值域：正整数；非法/非正值忽略
 * （回落下一级，宁保守不误伤）。 */
export const DAEMON_MAX_CONCURRENT_ENV = 'PACMAN_DAEMON_MAX_CONCURRENT';

/** #1148 本地闸取值序 env > DB > 默认（纯函数单源；机器循环 + 单测共用）。 */
export function resolveLocalCap(
  env: NodeJS.ProcessEnv,
  meMaxConcurrent: number | undefined,
): number {
  const raw = env[DAEMON_MAX_CONCURRENT_ENV];
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return typeof meMaxConcurrent === 'number' && meMaxConcurrent >= 1 ? meMaxConcurrent : 1;
}

/** #1148 per-worker 步端口基座 env 名：按槽位分段的端口基段下发给 worker 步
 * 的命令环境（项目 dev server 自愿消费——pacman 仓自身的 PACMAN_DEV_WEB_PORT
 * / E2E_PORT 纪律直接受益）。chief 步不携带（不占槽自然无段）。 */
export const PORT_BASE_ENV = 'PACMAN_PORT_BASE';

/** 首段基座（槽 1 → 20000；槽 2 → 20100；槽 N → 20000 + (N-1)×100）。 */
export const PORT_BASE_FLOOR = 20_000;
/** 每槽步进（一段 = 100 个端口的私有区）。 */
export const PORT_BASE_STRIDE = 100;

/** 槽位 → 端口基座（#1148 段公式单源；槽从 1 起，见 workerSlots 注释）。 */
export function portBaseForSlot(slot: number): number {
  return PORT_BASE_FLOOR + (slot - 1) * PORT_BASE_STRIDE;
}

export async function runMachine(opts: MachineLoopOpts): Promise<MachineHandle> {
  const { config, paths, logger } = opts;
  ensureStateDirs(paths);
  loadOrCreateDeviceJson(paths); // device.json 32hex（r3 §1.3）
  setupProxy(logger, opts.proxyEnv ?? process.env, config.serverUrl);

  // —— 上线序列 canon（02 §5.4）——
  logger.raw('Loading pi runtime…');
  const backend =
    opts.backend ??
    createPiBackend({
      agentDir: paths.agentRuntimeDir,
      sessionDir: paths.chatSessionsDir,
      // skills 执行面注入（spec 14/#371）：skillsDir = PACMAN_SKILLS_DIR 扫描根；
      // cwd = daemon home（project 级解析不随任务 worktree 切换跳变）。
      skills: { skillsDir: config.skillsDir, cwd: config.home },
      resolveSessionFile: (sid) => resolveSessionFile(paths, sid),
      onSession: (sid, file) => {
        if (file) recordSession(paths, sid, file);
      },
      // [mcp] 降级行（r3 §1.5 canon；02 §5.3 前缀词表 mcp 位）。
      onMcpLog: (msg) => logger.mcp(msg),
      // [skills] 诊断行（spec 14/#371；前缀词表 skills 位）。
      onSkillsLog: (msg) => logger.skills(msg),
      // [gate] 裁决行（#866 T5 命令闸；只记非放行裁决，allow 静默）。
      onGateLog: (msg) => logger.gate(msg),
      // [trust] 裁决行（#925 D1：受保护资源在位的 denied 行，空 worktree 静默）。
      onTrustLog: (msg) => logger.trust(msg),
      // 非 SSE 响应诊断文案的「哪台机器」位（#882；与 #867 同值来源）。
      machineName: config.name,
    });
  // 策略宣告行（#925/#927，spec 26）：trust/telemetry/version-check/
  // cache-retention/settings 五面从 daemon.log 可读。只在真 PiBackend 构造
  // （env 钉已落）时宣告——注入后端的测试面不谎报。
  if (opts.backend === undefined) {
    logger.machine(piSessionPolicyLine(process.env));
  }

  // —— #1050：claude 可用性的两个事实位（二进制 + 凭据态）——
  // 二进制：PATH 解析 + `--version`（2s 上界），起动时探一次并缓存。它是
  // 「这台机器装没装 claude」的判据——没有它，providers 页的 installed 只
  // 等于「settings.json 在」，两个方向都会说谎（配置在而二进制缺失 / 装好
  // 了却没写配置）。探到的路径同时钉给 SDK（pathToClaudeCodeExecutable），
  // 免掉「探的二进制」与「执行的二进制」不是一个。
  const claudeBin: ClaudeBinInfo | null = await probeClaudeBin();
  logger.machine(
    claudeBin
      ? `claude binary: ${claudeBin.path}${claudeBin.version !== null ? ` (${claudeBin.version})` : ''}`
      : 'claude binary: not found on PATH',
  );
  // 凭据态：探针结果缓存在这里，随下一拍 presence 上行。不进 presence 节拍
  // ——30s 一次 spawn `claude auth status` 是纯浪费（登录态分钟级才变），
  // 节奏 = 起动一次 + 每个 claude-code 步前一次（现状）。
  let claudeAuth: ClaudeCodeAuthProbe | null = null;
  const probeAuthAndRemember = async (): Promise<ClaudeCodeAuthProbe> => {
    const probe = await (opts.claudeCodeAuthProbe ?? probeClaudeCodeAuth)();
    claudeAuth = probe;
    return probe;
  };
  const claudeReport = () =>
    readClaudeCodeReport(undefined, {
      bin: claudeBin,
      ...(claudeAuth !== null ? { auth: claudeAuth } : {}),
    });
  claudeAuth = await probeAuthAndRemember();

  // —— per-step 后端解析 registry（spec 17 A3：runner 的 backendFor 唯一
  // 分叉，此处供解析目标）——claude-code 后端惰性初始化：首 runtime 步才
  // 构造（零 claude 步的机器不付 SDK 构造/扫描成本），canon 行
  // `Loading claude-code runtime…` 与 pi 启动行对仗、恰一条。注入面
  // （测试）预置即免构造，canon 行仍在首解析时落（行为面统一）。
  let claudeBackend: AgentBackend | null = opts.claudeCodeBackend ?? null;
  let claudeAnnounced = false;
  const backendFor = (agentProviderId: string | null | undefined): AgentBackend => {
    if (!isBackendRuntimeId(agentProviderId)) return backend; // 默认支（pi）
    if (!claudeAnnounced) {
      logger.raw('Loading claude-code runtime…');
      claudeAnnounced = true;
    }
    if (claudeBackend === null) {
      claudeBackend = createClaudeCodeBackend({
        // skills 通道与 pi 同律（A9 复用 buildSkillsCatalog）。
        skills: { skillsDir: config.skillsDir, cwd: config.home },
        onSkillsLog: (msg) => logger.skills(msg),
        // 缺凭据失败文案的「哪台机器」位（#867 T6；机器名 = 注册/上线序列里
        // 那一个，与 machines 页显示同值）。
        machineName: config.name,
        // #1050 路径单源：探到的绝对路径钉给 SDK，免掉「探的二进制」与
        // 「执行的二进制」不是一个（PACMAN_CLAUDE_BIN 此前只喂 auth 探针）。
        ...(claudeBin !== null ? { executablePath: claudeBin.path } : {}),
      });
    }
    return claudeBackend;
  };

  let inMemoryToken = '';
  const client =
    opts.client ??
    new MachineClient({
      serverUrl: config.serverUrl,
      getToken: () => inMemoryToken,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });

  // enroll（02 §5.2：machine.json 缺省 = 未注册；--api-key --team 非交互路径。
  // 浏览器授权流交互式注册归 M3b/web 接线）。
  let machineJson = loadMachineJson(paths);
  // server 迁移诊断（#519 控制面搬家）：token 由注册时 server 签发，配置指向
  // 另一地址后旧 token 打新 server——若对面是全新库，唯一表象是 claim 401
  // 退避死循环，本行是排障第一线索（轮询地址仍以配置为准，A1「PACMAN_SERVER
  // 指过去」语义不变）。
  if (machineJson && machineJson.serverUrl !== config.serverUrl) {
    logger.machine(
      `enrolled against ${machineJson.serverUrl} but polling ${config.serverUrl} — if auth fails, re-enroll: logout, then start --api-key <k> --team <id>`,
    );
  }
  if (!machineJson) {
    if (!config.apiKey || !config.teamId) {
      throw new Error(
        'machine not enrolled: pass --api-key <k> --team <id> (browser enroll path lands with web wiring)',
      );
    }
    const enrolled = await client.enroll({
      apiKey: config.apiKey,
      teamId: config.teamId,
      name: config.name,
      cliVersion: DAEMON_VERSION,
      claudeCode: claudeReport(),
    });
    machineJson = {
      machineId: enrolled.machineId,
      token: enrolled.token,
      teamId: enrolled.teamId,
      serverUrl: enrolled.serverUrl,
    };
    saveMachineJson(paths, machineJson);
    logger.raw(`Enrolled in team ${machineJson.teamId} (machine ${machineJson.machineId})`);
  }
  inMemoryToken = machineJson.token;
  const machineId = machineJson.machineId;

  await client.presence({ cliVersion: DAEMON_VERSION, claudeCode: claudeReport() });
  logger.raw(`Online (machineId=${machineId}); polling ${config.serverUrl}`);

  // #1108 本地并发闸：GET me 读本机 maxConcurrent——server claim 闸的客户端
  // 镜像（护混版本：新 daemon 对旧 server，字段缺席按 1 串行；旧 daemon 对
  // 新 server 本就串行不触闸）。随 presence 节拍刷新（30s）：上调 ≤30s 生
  // 效，下调由 server 闸即刻拦住本地旧值多发的一次 claim。读失败保留旧值
  // （闸宁可保守）。
  // #1148 两处增量：① 取值序 env > DB > 默认（resolveLocalCap 单源，
  // PACMAN_DAEMON_MAX_CONCURRENT 覆盖 DB 值）；② serverGates 标记（me
  // 携 maxConcurrent = #1108+ server，worker 容量闸权威在 server 侧）——
  // 本地 park 面收窄到「server 无闸」的混版本保护（见 claim 主循环注释）。
  let localCap = 1;
  let serverGates = false;
  const capEnv = opts.capEnv ?? process.env;
  const refreshCap = async (): Promise<void> => {
    try {
      const me = await client.me();
      // 每拍按当次响应重判（server 降级回无闸形 → local park 随即恢复保护）；
      // me 失败才保留旧值（catch 分支）。
      serverGates = typeof me.maxConcurrent === 'number' && me.maxConcurrent >= 1;
      localCap = resolveLocalCap(capEnv, me.maxConcurrent);
    } catch (err) {
      logger.machine(
        `me failed (keeping cap ${localCap}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  await refreshCap();

  // 闲置防睡（darwin caffeinate -i；平台命令表 spawn，01 §4.3）。
  let caffeinate: ChildProcess | undefined;
  if (opts.idleSleepPrevention !== false && process.platform === 'darwin') {
    try {
      caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
      caffeinate.unref();
      logger.raw('Idle-sleep prevention active (caffeinate)');
    } catch {
      // 平台命令缺省可降级（01 §9 linux systemd-inhibit [推断] 可缺省同族）。
    }
  }

  const journal = new StepJournal(paths.outboxDir);
  // worktree 契约面（02 §5.5；单例共享 = projectLock 跨步串行化前提）。
  const workspace = new WorkspaceManager({
    logger,
    ...(opts.orphanTtlMs !== undefined ? { orphanTtlMs: opts.orphanTtlMs } : {}),
    ...(opts.hookTimeoutMs !== undefined ? { hookTimeoutMs: opts.hookTimeoutMs } : {}),
  });
  // 在跑 session 句柄注册表（W3 #279 steer 投递面）。声明位必须在 recover 块
  // 之前——stepDeps() 是函数声明（提升）且 recover 路径会先于下方流段调用它，
  // 注册表若在调用点之后才 const 初始化 = TDZ ReferenceError（crash-recover
  // 集成实测：重启 daemon 于 recover 即崩）。
  const sessionHandles = new Map<string, AgentSessionHandle>();
  // 停止请求旗标（M7 #308）：deliverStop 拉取-确认后置位，runStep 收尾判
  // stopped 消费；声明位纪律同 sessionHandles。
  const stopRequests = new Map<string, StopRequest>();
  // #1148 在飞 chief 步 id 集（本地闸不计数；与 inFlight 同进同出）。声明位
  // 纪律同 sessionHandles——recover 块的消费面（workerEnv）在其下方。
  const inFlightChief = new Set<string>();
  // #1148 worker 槽位登记：stepId → 槽（1 起最小空闲整数；发射处同步分配、
  // 收尾释放——单线程事件循环内无竞态，并发在飞步恒不同槽）。recover 续跑
  // 步同领槽（主循环与恢复面同律）。
  const workerSlots = new Map<string, number>();
  const assignWorkerSlot = (stepId: string): number => {
    const used = new Set(workerSlots.values());
    let slot = 1;
    while (used.has(slot)) slot += 1;
    workerSlots.set(stepId, slot);
    return slot;
  };
  /** worker 步的步级 env（#1148 端口基座）。分配即登记槽位（finally 释放）。 */
  const workerEnv = (stepId: string): Record<string, string> => ({
    [PORT_BASE_ENV]: String(portBaseForSlot(assignWorkerSlot(stepId))),
  });

  // 孤儿 worktree 回收（r3 §1.4 cleanupOrphanWorktrees(ttlMs = 7*24h)）：
  // 上线一次 + 每日节奏 [设计]（观测仅函数名，节奏未采）。活步 = journal
  // pending 面的 conversationId 集。
  const sweepOrphans = () => {
    workspace
      .cleanupOrphans({
        workspacesRoot: config.workspacesDir,
        ttlMs: opts.orphanTtlMs ?? ORPHAN_WORKTREE_TTL_MS,
        now: Date.now(),
        activeConversationIds: journal.pending().map((e) => e.conversationId),
      })
      .then((removed) => {
        if (removed.length > 0) {
          logger.workspace(`orphan worktrees recycled: ${removed.length} (${removed.join(', ')})`);
        }
      })
      .catch((err: unknown) => {
        logger.workspace(
          `orphan cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };
  sweepOrphans();
  const orphanTimer = setInterval(sweepOrphans, 24 * 60 * 60 * 1000);
  orphanTimer.unref?.();

  // step-attachments scratch 回收（#759 R3：sweepOrphans 同形——上线一次 +
  // 每日节奏；再生前提见 step-attachments.ts STEP_ATTACHMENTS_TTL_MS）。
  const sweepStepScratch = () => {
    try {
      const removed = sweepStepAttachments(paths.stepAttachmentsDir, { now: Date.now() });
      if (removed.length > 0) {
        logger.workspace(`step-attachments recycled: ${removed.length} (${removed.join(', ')})`);
      }
    } catch (err: unknown) {
      logger.workspace(
        `step-attachments cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  sweepStepScratch();
  const stepScratchTimer = setInterval(sweepStepScratch, 24 * 60 * 60 * 1000);
  stepScratchTimer.unref?.();

  // —— [recover] 步 journal 恢复（server 真值对账 + continue session 续跑）——
  const recovered = await client.recover();
  if (recovered.steps.length === 0) {
    logger.recover('no pending steps found');
  } else {
    logger.recover(`${recovered.steps.length} pending step(s) found — resuming`);
    for (const stepRecord of recovered.steps) {
      const entry = journal.get(stepRecord.id);
      if (entry?.claimed) {
        // #1026 快路径：终稿快照在（上传/done 失败残留）→ 只补报终稿 + done，
        // 不重跑 agent 轮（重跑会白烧一轮模型并把同内容传成重复版本）。
        if (entry.state === 'awaiting-upload' && entry.doneBody != null) {
          await resumePendingUpload(stepDeps(), entry, { running: 1 });
          continue;
        }
        // journal 快照续跑：sessionId 在 → continue session（同 conv pi 会话
        // 复用，02 §4.2/§5.7）；不在 → new session 重发任务文本。
        const claimed: ClaimedStep = {
          ...entry.claimed,
          session: {
            action: entry.sessionId ? 'continue' : 'new',
            sessionId: entry.sessionId,
          },
        };
        await runStep(stepDeps(), claimed, {
          resume: { sessionId: entry.sessionId, prompt: entry.prompt },
          running: 1,
          // #1148 端口基座：续跑 worker 步照领槽（恢复面与主循环同律）。
          ...(claimed.step.kind === 'chief' ? {} : { env: workerEnv(stepRecord.id) }),
        });
      } else {
        logger.recover(`step ${stepRecord.id} has no local journal — reporting failed`);
        await client.done(stepRecord.id, {
          status: 'failed',
          errorMessage: 'daemon journal lost across restart',
        });
      }
    }
  }

  // —— wake SSE（低延迟派发通道；断线持续重连不退出，r3 §1.5）——
  // 低延迟派发全归 server 侧：入队 wake() 同一同步轮直解挂起的 claim hold
  // （tryClaim→waiter 注册为同一同步块，单进程无事件循环间隙可乘——
  // machine-wire.test.ts「入队即 wake」钉住）。daemon 端不消费 wake 事件
  // （#482 裁定）：SSE 先于 claim 响应到达时中断在飞 claim 会与 server 已
  // 落库 claimed 的响应竞态，孤儿化已领步；hold 到期重发（≤75s）即残余
  // 上界的兜底（多进程部署内存 hub 不共享时同此界）。
  // steer 事件（W3 #279）三号分流：拉取-确认投递到在跑 session handle。
  // #730：steer 文本里的整行图片 token 同步解析下载（先判活再下载——无在跑
  // handle 时一字节不白下），图片随 handle.steer(text, images) 内联交付。
  const streamCtrl = new AbortController();
  const deliverSteer = async (stepId: string): Promise<void> => {
    try {
      const content = await client.steer(stepId);
      if (content === null) return; // server 门拒/旧步已丢弃（拉取-确认语义）。
      const live = sessionHandles.get(stepId);
      if (live === undefined) {
        logger.step(`steer dropped (no live session) step=${stepId}`); // 收尾竞态
        return;
      }
      let deliveryText = content;
      let images: DeliveredImage[] | undefined;
      try {
        const resolved = await resolveStepImages({
          text: content,
          stepId,
          client,
          materializeDir: paths.stepAttachmentsDir,
          log: (line) => logger.step(line),
        });
        deliveryText = resolved.text;
        if (resolved.images.length > 0) images = [...resolved.images];
      } catch (err) {
        logger.step(
          `steer attachment resolve failed (delivering raw text): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await live.steer(deliveryText, images);
      logger.step(`steer delivered step=${stepId}`);
    } catch (err) {
      logger.step(`steer delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // 停止投递（M7 #308，steer 三号分流同律）：拉取-确认置旗标 → live.stop()
  // 中断 pi 会话；旗标先于 stop() 置位（runStep 的事件流结束即读）。收尾
  // 判 stopped / done(stopped) 回报 / discard rewind 归 runner。
  const deliverStop = async (stepId: string): Promise<void> => {
    try {
      const discard = await client.stop(stepId);
      if (discard === null) return; // server 门拒/旧步已丢弃（拉取-确认语义）。
      const live = sessionHandles.get(stepId);
      if (live === undefined) {
        logger.step(`stop dropped (no live session) step=${stepId}`); // 收尾竞态
        return;
      }
      stopRequests.set(stepId, { discard });
      await live.stop();
      logger.step(`stop delivered step=${stepId}`);
    } catch (err) {
      // 拉取/abort 失败旗标不残留（会话未真中断，自然收尾不被误判 stopped）。
      stopRequests.delete(stepId);
      logger.step(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const deliverSync = async (cmd: import('@pacman/shared').MachineSyncCommand): Promise<void> => {
    // 第四事件分流（M7 #319 [设计]，08 册附录 B「分支同步」）：分支对话框
    // 「同步到机器」server 派发；performSync 内部 ack running + 收尾 synced
    // /failed + 异常吞掉（本函数不抛——sync 是独立轨道，失败落账即闭环）。
    await performSync({ client, logger }, cmd);
  };
  void (async () => {
    let backoff = 1_000;
    let announced = false;
    while (!streamCtrl.signal.aborted) {
      try {
        await client.stream(
          streamCtrl.signal,
          (ev) => {
            if (ev.type === 'shutdown') void stop();
            if (ev.type === 'steer') void deliverSteer(ev.stepId);
            if (ev.type === 'stop') void deliverStop(ev.stepId);
            if (ev.type === 'sync') void deliverSync(ev.sync);
          },
          () => {
            if (!announced) {
              announced = true;
              logger.wake('push channel connected');
            }
          },
        );
        backoff = 1_000;
      } catch {
        // 断线重连（代理死持续重试不退出同纪律，02 §5.6）。
      }
      if (streamCtrl.signal.aborted) return;
      await sleep(backoff);
      backoff = nextBackoffMs(backoff);
    }
  })();

  // —— presence 心跳（并行失败不退出，r3 §1.5）——
  const presenceTimer = setInterval(() => {
    void refreshCap(); // #1108 并发上限刷新骑同一节拍（失败留旧值）。
    client
      .presence({ cliVersion: DAEMON_VERSION, claudeCode: claudeReport() })
      .catch((err: unknown) => {
        logger.machine(`presence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, opts.presenceIntervalMs ?? 30_000);
  presenceTimer.unref?.();

  // —— claim 主循环（长轮询；空手即重发 → 节奏 ≈ server hold ≈ 75s）——
  let stopping = false;
  const claimCtrl = new AbortController();
  const claimTimeoutMs = opts.claimTimeoutMs ?? CLAIM_POLL_INTERVAL_MS + 15_000;

  function stepDeps() {
    return {
      client,
      journal,
      backendFor,
      logger,
      paths,
      workspace,
      workspacesDir: config.workspacesDir,
      mcpConfigPath: config.mcpConfigPath,
      sessionHandles,
      stopRequests,
      // #867 T6：runtime 步凭据预检（机器名进失败文案；探针缺省 = 真 CLI）。
      machineName: config.name,
      claudeCodeAuthProbe: probeAuthAndRemember,
      ...(opts.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: opts.heartbeatIntervalMs }
        : {}),
    };
  }

  // —— claim 主循环（#1108 起并行：claim 到即发射，不 await——server 闸
  // （tryClaim 数非 chief claimed ≥ 闸值）是同一上限的权威侧。#1148 增量：
  // ① chief 步不占槽：本地闸只数在飞 worker（inFlightChief 集排除）；且
  //   park 面收窄——serverGates（#1108+ server）时 worker 容量过滤全在
  //   server 闸（claim body maxWorkers 自报 + DB 行），本地不 park（挂起
  //   claim 恒可收 chief，满载 worker 不饿死 chief）；仅 pre-#1108 server
  //   （me 无 maxConcurrent、无闸）保留本地 park 护混版本（chief 在飞不
  //   计数；其 pending 等收尾 = 现状保守形）。
  // ② 端口基座：worker 步领槽（1 起最小空闲整数，收尾释放即重用），
  //   PACMAN_PORT_BASE = 段公式（portBaseForSlot）随 RunStepOptions.env 注
  //   入 agent 命令环境；并发在飞步恒不同槽（串槽 = 票面失败方式 2）。
  // runStep 自身失败面已走 done failed 闭环，发射处 catch 是
  // unhandled-rejection 防御位。优雅停止契约不变：循环退出后等在飞步全部
  // 收尾，done 才 resolve（r3 §1.5 SIGTERM 序列）。——
  const inFlight = new Map<string, Promise<void>>();
  const done = (async () => {
    const backoffBase = opts.claimBackoffBaseMs ?? 1_000;
    let backoff = backoffBase;
    while (!stopping) {
      // 本地闸（#1148 收窄）：pre-#1108 server（无 worker 闸）且在飞 worker
      // 数达上限 → 等任一步收尾释放空位；serverGates 时容量过滤在 server
      // 侧（body 自报 + DB），本地不 park——挂起 claim 恒可收 chief。
      // 上限变化经 refreshCap 在下一轮生效。
      const workersInFlight = inFlight.size - inFlightChief.size;
      if (!serverGates && workersInFlight > 0 && workersInFlight >= localCap) {
        await Promise.race(inFlight.values());
        continue;
      }
      let step: ClaimedStep | null = null;
      try {
        // 客户端护栏 = server hold + 余量；stop 时 claimCtrl 中断挂起请求。
        // #1148：maxWorkers 自报 effective cap——server worker 闸取
        // min(DB, 自报)（env > DB 的 server 落点；老 server 剥离该位零碍）。
        step = await client.claim(
          AbortSignal.any([claimCtrl.signal, AbortSignal.timeout(claimTimeoutMs)]),
          { maxWorkers: localCap },
        );
        backoff = backoffBase; // 成功即重置（指数退避仅断网面，r3 §1.5）
      } catch (err) {
        if (stopping) break;
        logger.machine(
          `claim failed: ${err instanceof Error ? err.message : String(err)} (backoff ${backoff}ms)`,
        );
        await sleep(backoff);
        backoff = Math.min(backoff * 2, CLAIM_BACKOFF_CAP_MS); // 封顶 30s
        continue;
      }
      if (!step || stopping) continue;
      logger.raw(`claim step=${step.step.id}`);
      const stepId = step.step.id;
      if (step.step.kind === 'chief') inFlightChief.add(stepId);
      const stepEnv = step.step.kind === 'chief' ? undefined : workerEnv(stepId);
      const launched = runStep(stepDeps(), step, {
        running: inFlight.size + 1,
        ...(stepEnv !== undefined ? { env: stepEnv } : {}),
      })
        .catch((err: unknown) => {
          // runStep 契约上不抛（失败面内部消化走 done failed）；此 catch 是
          // 契约破口时的进程级防御——记行不静默吞。
          logger.step(
            `runStep crashed (step may need recover): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        })
        .finally(() => {
          inFlight.delete(stepId);
          inFlightChief.delete(stepId);
          workerSlots.delete(stepId);
        });
      inFlight.set(stepId, launched);
    }
    await Promise.allSettled([...inFlight.values()]);
  })();

  async function stop(cause?: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.machine(`Shutting down…${cause ? ` (${cause})` : ''}`);
    clearInterval(presenceTimer);
    clearInterval(orphanTimer);
    clearInterval(stepScratchTimer);
    streamCtrl.abort();
    claimCtrl.abort();
    caffeinate?.kill();
  }

  return { machineId, stop, done };
}
