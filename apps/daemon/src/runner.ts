import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  AgentTodoItem,
  AgentTokenUsage,
  ClaimedStep,
  CommitIdentity,
  DeliveredImage,
  GitCredentialSource,
  LocalToolDef,
  MachineAskBody,
  MachineDoneBody,
  MachineHeartbeatBody,
  PreparedWorkspace,
  ProviderConfig,
  QuotaBlock,
  SessionOpts,
  SkillInjectionFacts,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  appendBlockerHandoff,
  appendConfirmedPlanNote,
  appendPlanLocationNote,
  appendReportLocationNote,
  appendWorkBranchNote,
  BRAND,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  CHANGES_DIFF_MAX_BYTES,
  CONTINUE_PROMPTS,
  classifyAgentFailure,
  classifySkillFact,
  classifyStepFailure,
  composeTaskPromptWithInstruction,
  conversationBranch,
  FIXED_TAGS,
  INFO_REPORT_MAX_BYTES,
  isBackendRuntimeId,
  isIssueSourcedTask,
  LOCAL_TOOL_CREATE_TAG,
  LocalRepoUnreachableError,
  PLAN_FILE_NAME,
  parseRetryAfterMs,
  parseReviewPromptMeta,
  REMOTE_TOOL_RETRY_DELAYS_MS,
  REPORT_FILE_NAME,
  type ReviewGate,
  SESSION_FILE_NAME,
  STREAM_TIMEOUTS_MS,
  skillCallName,
  stepTakesSecrets,
  stripAnsiEscapes,
  transcriptPromptRowId,
} from '@cairn/shared';
import { createActivityTracker } from './activity.js';
import { parseAgentTodoText } from './agent-todo.js';
import { SessionNotResumableError } from './backend/errors.js';
import { notInConfigLine, resolveMcpEndpoints } from './backend/mcp-config.js';
import type { DaemonOtel } from './backend/otel.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import {
  collectVisibleSkillFileMap,
  collectVisibleSkillNames,
  piWorktreeSkillDirs,
  type SkillsCatalogOpts,
} from './backend/skills.js';
import { type BriefHandle, caseInsensitiveFsFor, cleanupBrief, writeBrief } from './brief-file.js';
import {
  type ClaudeCodeAuthProbe,
  claudeCodeAuthFailureMessage,
  probeClaudeCodeAuth,
} from './claude-code-auth.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { GitPushHookError, withGitCredentialFallback } from './git.js';
import { githubRepoRefOf, probeGithubPr } from './github-probe.js';
import { computeHarnessHash } from './harness-hash.js';
import { type StepJournal, type StepJournalEntry, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { isTransientUploadError, type MachineApi, MachineApiError } from './machine-client.js';
import { reviewedCheckoutHead } from './merge-decision.js';
import { extractReviewVerdict } from './review-findings.js';
import { buildSecretTool } from './secret-channel.js';
import { type SealedSegment, SegmentBuffer, segmentContent } from './segment.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';
import { buildSkillLoadTool } from './skill-tool.js';
import type { StatePaths } from './state.js';
import { resolveStepImages } from './step-attachments.js';
import { type RunStop, StepStops, type StopRequest } from './step-stops.js';
import { buildCreateTagTool } from './tag-tool.js';
import { materializeTeamSkills } from './team-skills.js';
import { extractVerifyVerdict } from './verify-verdict.js';
import { localRepoUnreachableMessage } from './workspace.js';

function gitCredentialSourceRowContent(source: GitCredentialSource): string {
  return source === 'machine'
    ? 'git 凭据来源：machine（执行机本机 git 凭据）'
    : 'git 凭据来源：integration（per-step 下发 token）';
}

export interface RunStepDeps {
  client: MachineApi;
  journal: StepJournal;
  backendFor: (agentProviderId: string | null | undefined) => AgentBackend;
  logger: DaemonLogger;
  paths: StatePaths;
  workspacesDir: string;
  mcpConfigPath: string;
  workspace?: WorktreeOps;
  sessionHandles?: Map<string, AgentSessionHandle>;
  stops?: StepStops;
  heartbeatIntervalMs?: number;
  skillsDir?: string;
  machineName?: string;
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  otel?: DaemonOtel | null;
  now?: () => number;
}

export interface RunStepOptions {
  resume?: { sessionId: string | null; prompt: string | null };
  running?: number;
  env?: Record<string, string>;
  stopRequest?: StopRequest;
  retryStormMax?: number;
  streamTimeouts?: { first: number; idle: number; body: number };
  streamDurationCapMs?: number;
  providerNetworkFinalWaitMs?: number;
}

export const PROVIDER_NETWORK_MAX_ATTEMPTS = 3;

export const PROVIDER_NETWORK_FINAL_RETRY_WAIT_MS = 5_000;

export { RETRY_STORM_MAX };

export function combineTimeoutWithRootCause(timeoutText: string, rootCause: string | null): string {
  return rootCause !== null ? `${timeoutText}；根因: ${rootCause}` : timeoutText;
}

export const STREAM_DURATION_CAP_DEFAULT_MS = 3_600_000;

export const STREAM_DURATION_CAP_ENV = 'CAIRN_STREAM_DURATION_CAP_MS';

function envDurationCapMs(env: NodeJS.ProcessEnv): number | null {
  const raw = env[STREAM_DURATION_CAP_ENV];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export type StreamTimeoutArm = 'first' | 'idle' | 'body' | 'duration';

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

export function buildTaskPrompt(claimed: ClaimedStep): string {
  const todo = claimed.todo;
  if (!todo) return claimed.instruction ?? '';
  const taskText = appendBlockerHandoff(
    buildTaskPromptText(todo.title, todo.spec, todo),
    todo.blockerHandoff,
  );
  const instruction = claimed.instruction ?? null;
  if (instruction !== null && instruction.trim() !== '') {
    return composeTaskPromptWithInstruction(taskText, instruction);
  }
  if (claimed.step.kind === 'plan') {
    return composeTaskPromptWithInstruction(taskText, buildPlanFirstRoundInstruction());
  }
  return taskText;
}

function resumeMissNote(sessionId: string, claimed: ClaimedStep): string {
  const prior = claimed.session.priorMachineId;
  if (prior !== undefined && prior !== claimed.step.machineId) {
    return `会话 ${sessionId} 在另一台机器上，本机无法续接。已改开新会话，按原任务继续。`;
  }
  return `本机找不到会话 ${sessionId}，无法续接。已改开新会话，按原任务继续。`;
}

const READONLY_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'url.cairn-readonly-workspace-denied:.pushInsteadOf',
  GIT_CONFIG_VALUE_0: '',
};

function confirmedPlanFile(plansDir: string, convId: string): string | null {
  const planFile = join(plansDir, convId, PLAN_FILE_NAME);
  try {
    if (!existsSync(planFile)) return null;
    return readFileSync(planFile, 'utf8').trim() !== '' ? planFile : null;
  } catch {
    return null;
  }
}

function degradedFreshPrompt(claimed: ClaimedStep, plansDir: string, convId: string): string {
  let text = buildTaskPrompt(claimed);
  if (claimed.step.kind === 'build') {
    const planFile = confirmedPlanFile(plansDir, convId);
    if (planFile !== null) text = appendConfirmedPlanNote(text, planFile);
  } else if (claimed.step.kind === 'plan') {
    text = appendPlanLocationNote(text, join(plansDir, convId, PLAN_FILE_NAME));
  }
  if (
    (claimed.step.kind === 'build' ||
      claimed.step.kind === 'merge' ||
      claimed.step.kind === 'verify') &&
    (claimed.project?.repo ?? null) !== null
  ) {
    text = appendWorkBranchNote(text, conversationBranch(convId));
  }
  return text;
}

export interface TaskMetaForm {
  vocab: readonly { name: string }[];
}

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

function taskMetaOpts(
  todo: ClaimedStep['todo'],
): { taskMeta: { currentTitle: string; meta?: TaskMetaForm } } | undefined {
  if (!todo) return undefined;
  if (todo.meta?.titleFinal === true || isIssueSourcedTask(todo)) return undefined;
  return {
    taskMeta: {
      currentTitle: todo.title,
      ...(todo.meta !== undefined ? { meta: todo.meta } : {}),
    },
  };
}

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

const CHANGE_TOOLS = new Set(['edit', 'write', 'bash']);

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
  const stepId = claimed.step.id;
  const stop = (deps.stops ?? new StepStops()).enter(stepId, (stopRequest) => {
    try {
      deps.journal.update(stepId, { stopRequest });
    } catch (err) {
      deps.logger.step(
        `stop journal write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });
  const provenance: MachineHeartbeatBody = {};
  const heartbeat = setInterval(() => {
    deps.client.heartbeat(stepId, provenance).catch((err: unknown) => {
      if (!(err instanceof MachineApiError) || err.status !== 410 || stop.request !== null) return;
      deps.logger.step(`step ${stepId} no longer exists on the server — stopping`);
      stop.deliver({ discard: false }).catch((stopErr: unknown) => {
        deps.logger.step(
          `stop after heartbeat 410 failed: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`,
        );
      });
    });
  }, deps.heartbeatIntervalMs ?? 30_000);
  if (heartbeat.unref) heartbeat.unref();
  if (opts.stopRequest !== undefined) stop.accept(opts.stopRequest);
  try {
    await runClaimedStep(deps, claimed, opts, heartbeat, stop, provenance);
  } finally {
    clearInterval(heartbeat);
    stop.settle();
  }
}

async function runClaimedStep(
  deps: RunStepDeps,
  claimed: ClaimedStep,
  opts: RunStepOptions,
  heartbeat: ReturnType<typeof setInterval>,
  stop: RunStop,
  provenance: MachineHeartbeatBody,
): Promise<void> {
  const { client, journal, logger } = deps;
  const now = deps.now ?? (() => Date.now());
  const stepId = claimed.step.id;
  const convId = claimed.conversationId;
  const running = opts.running ?? 1;
  logger.raw(`step ${stepId} for conv ${convId} (${running} running)`);

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

  let agentTodoRelayWarned = false;
  let lastAgentTodo: AgentTodoItem[] | null = null;
  const reportAgentTodo = (items: readonly AgentTodoItem[]): void => {
    if (items.length === 0) return;
    if (
      lastAgentTodo !== null &&
      lastAgentTodo.length === items.length &&
      lastAgentTodo.every((it, i) => {
        const next = items[i];
        return next !== undefined && it.text === next.text && it.state === next.state;
      })
    ) {
      return;
    }
    lastAgentTodo = items.map((it) => ({ ...it }));
    client.agentTodo?.(stepId, { items: items.map((it) => ({ ...it })) })?.catch((err: unknown) => {
      if (agentTodoRelayWarned) return;
      agentTodoRelayWarned = true;
      logger.step(
        `agent todo relay failed (suppressed until next step): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  };

  const isChief = claimed.step.kind === 'chief';
  const isReview = claimed.step.kind === 'review';
  const isVerify = claimed.step.kind === 'verify';
  const reviewGate: ReviewGate =
    (isReview ? parseReviewPromptMeta(claimed.instruction ?? null)?.gate : undefined) ?? 'confirm';
  const basePrompt =
    opts.resume?.prompt ??
    (isChief || isReview || isVerify
      ? (claimed.instruction ?? '')
      : claimed.session.action === 'continue' && claimed.session.sessionId
        ? (claimed.instruction ?? CONTINUE_PROMPTS[claimed.step.kind])
        : buildTaskPrompt(claimed));
  const isInfoBuild = claimed.step.kind === 'build' && claimed.todo?.output === 'info';
  const readonlyWorkspace = !isChief && claimed.todo?.output === 'info';
  const reportFile = join(deps.paths.reportsDir, convId, REPORT_FILE_NAME);
  const promptWithPlanNote =
    basePrompt !== null && claimed.step.kind === 'plan'
      ? appendPlanLocationNote(basePrompt, join(deps.paths.plansDir, convId, PLAN_FILE_NAME))
      : basePrompt !== null && isInfoBuild
        ? appendReportLocationNote(basePrompt, reportFile)
        : basePrompt;
  const prompt =
    promptWithPlanNote !== null &&
    promptWithPlanNote.trim() !== '' &&
    !isInfoBuild &&
    (claimed.step.kind === 'build' ||
      claimed.step.kind === 'merge' ||
      claimed.step.kind === 'verify') &&
    (claimed.project?.repo ?? null) !== null
      ? appendWorkBranchNote(promptWithPlanNote, conversationBranch(convId))
      : promptWithPlanNote;
  if (claimed.step.kind === 'plan') {
    mkdirSync(join(deps.paths.plansDir, convId), { recursive: true });
  }
  if (isInfoBuild) {
    mkdirSync(dirname(reportFile), { recursive: true });
    if (!opts.resume) rmSync(reportFile, { force: true });
  }

  journal.claim({
    stepId,
    buildId: claimed.step.buildId,
    kind: claimed.step.kind,
    conversationId: convId,
    sessionAction: claimed.session.action,
    sessionId: opts.resume?.sessionId ?? claimed.session.sessionId,
    prompt,
    claimed,
    stopRequest: stop.request,
  });

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

  const tokenRes = await client.token(stepId);
  const creds = pushCredential(tokenRes, claimed.project?.repo?.cloneUrl ?? null);
  const agent = claimed.agent;
  const runtimeId = isBackendRuntimeId(agent?.provider) ? agent.provider : null;
  let provider: ProviderConfig | null =
    runtimeId !== null
      ? { kind: 'api_key', providerId: runtimeId }
      : (creds.provider ??
        (agent?.provider ? { kind: 'api_key', providerId: agent.provider } : null));
  if (!agent?.modelId || !provider) {
    clearCredentials(creds);
    await failStep(
      deps,
      heartbeat,
      stepId,
      runtimeId !== null ? `${runtimeId} step has no model id` : 'no agent/model on claimed step',
    );
    return;
  }
  const quotaBlockOf = (
    kind: 'quota' | 'capacity',
    reason: string,
    retryAfterMs: number | null,
  ): QuotaBlock => ({
    kind,
    providerId: provider?.providerId ?? 'unknown',
    ...(provider?.label !== undefined ? { label: provider.label } : {}),
    reason: reason.slice(0, 500),
    ...(retryAfterMs !== null ? { retryAfterMs } : {}),
  });
  const agentTools = agent.tools;
  if (claimed.step.kind === 'merge' && agentTools !== undefined) {
    const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentTools.includes(t));
    if (missing.length > 0) {
      clearCredentials(creds);
      await failStep(
        deps,
        heartbeat,
        stepId,
        `Agent 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），合并步拒绝执行`,
      );
      return;
    }
  }
  if (runtimeId === 'claude-code') {
    const auth = await (deps.claudeCodeAuthProbe ?? probeClaudeCodeAuth)();
    if (auth.state === 'not-logged-in') {
      clearCredentials(creds);
      await failStep(
        deps,
        heartbeat,
        stepId,
        claudeCodeAuthFailureMessage(deps.machineName ?? hostname()),
      );
      return;
    }
    if (auth.state === 'unknown') {
      logger.step(`claude-code auth probe inconclusive: ${auth.reason} (continuing)`);
    }
  }
  const backend = deps.backendFor(agent?.provider);
  const modelKey = `${provider?.providerId ?? agent.provider}/${agent.modelId}`;
  logger.raw(`using model ${modelKey}`);

  logger.workspace('准备工作区...');
  let ws: PreparedWorkspace | null = null;
  const checkout = isReview && reviewGate === 'review';
  const repo = isChief || (isReview && !checkout) ? null : (claimed.project?.repo ?? null);
  if (repo !== null) {
    if (!deps.workspace) {
      clearCredentials(creds);
      await failStep(deps, heartbeat, stepId, 'workspace ops unavailable for repo-bound step');
      return;
    }
    try {
      ws = await deps.workspace.prepare({
        projectId: claimed.project?.id ?? '',
        conversationId: convId,
        cloneUrl: repo.cloneUrl,
        repoKind: repo.kind,
        workspacesRoot: deps.workspacesDir,
        credentials: creds.git,
        localPath: repo.kind === 'github' ? (repo.localPath ?? null) : null,
        machineCredentialFallback: repo.kind === 'github',
        ...(readonlyWorkspace ? { readonly: true } : {}),
      });
    } catch (err) {
      clearCredentials(creds);
      await failStep(
        deps,
        heartbeat,
        stepId,
        err instanceof LocalRepoUnreachableError
          ? localRepoUnreachableMessage(deps.machineName ?? hostname(), err)
          : err instanceof Error
            ? err.message
            : String(err),
      );
      return;
    }
  }
  const cwd = ws?.cwd ?? join(deps.workspacesDir, convId);
  if (!ws) mkdirSync(cwd, { recursive: true });

  const stepStartMs = Date.now();
  let headAtStart: string | null = null;
  if (ws !== null && ws.readonly !== true && deps.workspace) {
    try {
      headAtStart = await deps.workspace.headCommit(ws.cwd);
    } catch {
      headAtStart = null;
    }
  }

  const systemPrompt =
    isChief && claimed.chief
      ? claimed.chief.systemPrompt
      : composeWorkerSystemPrompt(agent.description, agent.memories, taskMetaOpts(claimed.todo));
  const remoteTools = claimed.remoteTools;
  const claimedMcp = claimed.mcpServers;
  const mcpSlugs = claimedMcp ?? [];
  const mcpEndpoints =
    mcpSlugs.length > 0
      ? resolveMcpEndpoints(deps.mcpConfigPath, mcpSlugs, {
          onMissing: (slug) => logger.mcp(notInConfigLine(slug)),
        })
      : [];
  if (claimedMcp !== undefined) {
    logger.mcp(
      mcpSlugs.length > 0
        ? `loaded from ${deps.mcpConfigPath}: ${
            mcpEndpoints.length > 0 ? mcpEndpoints.map((e) => e.slug).join(', ') : '(none)'
          }`
        : 'managed-empty: strict MCP set (runtime config not inherited)',
    );
  }
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
    await failStep(deps, heartbeat, stepId, `team skills distribution failed: ${reason}`);
    return;
  }
  const secretTool = stepTakesSecrets(claimed.step.kind)
    ? buildSecretTool({
        creds,
        stepId,
        agentId: agent?.id ?? null,
        onAudit: (line) => logger.step(line),
      })
    : null;
  const stepIdentity: CommitIdentity = {
    name: claimed.agent?.displayName ?? 'cairn-agent',
    email: `${claimed.step.machineId ?? 'machine'}@cairn.local`,
  };
  const createTagTool = (claimed.localTools ?? []).includes(LOCAL_TOOL_CREATE_TAG)
    ? buildCreateTagTool({ repoDir: ws?.cwd ?? null, cred: creds.git, identity: stepIdentity })
    : null;
  const localToolDefs = [secretTool, createTagTool].filter((t): t is LocalToolDef => t !== null);
  const injectedForSession =
    agent.injectedSkills === undefined || agent.defaultSkill == null
      ? agent.injectedSkills
      : [agent.defaultSkill, ...agent.injectedSkills.filter((id) => id !== agent.defaultSkill)];
  const isPi = backend.brief?.backendId === 'pi';
  const skillsRootDir = deps.skillsDir;
  const canSkillTool = isPi && skillsRootDir !== undefined;
  if (canSkillTool) {
    const worktreeSkillDirs = piWorktreeSkillDirs(cwd);
    const skillScanOpts: SkillsCatalogOpts = {
      skillsDir: skillsRootDir,
      cwd: deps.paths.home,
      ...(!isChief && agent.skillsAllowlist != null ? { allowlist: agent.skillsAllowlist } : {}),
      ...(!isChief && injectedForSession !== undefined
        ? { injectedSkills: injectedForSession }
        : {}),
      ...(teamSkillsDir !== null ? { teamSkillsDir } : {}),
      worktreeSkillsDirs: worktreeSkillDirs,
      log: (msg: string) => logger.skills(msg),
    };
    const skillFileMap = collectVisibleSkillFileMap(skillScanOpts);
    const skillLoadTool = buildSkillLoadTool({
      skillFileMap,
      onInvoke: (name) => logger.skills(`invoke: ${name}`),
    });
    localToolDefs.push(skillLoadTool);
    if (deliveryPrompt !== null) {
      const visibleNames = collectVisibleSkillNames(skillScanOpts);
      const slashPattern = /\b\/([a-z][a-z0-9-]*)\b/g;
      const matched: string[] = [];
      let m = slashPattern.exec(deliveryPrompt);
      while (m !== null) {
        // biome-ignore lint/style/noNonNullAssertion: regex /\/([a-z][a-z0-9-]*)/ guarantees capture group 1 when exec returned non-null
        const name = m[1]!;
        if (visibleNames.has(name)) {
          matched.push(name);
        } else {
          logger.skills(`unknown-dispatch: ${name}`);
        }
        m = slashPattern.exec(deliveryPrompt);
      }
      if (matched.length > 0) {
        const uniqueMatched = [...new Set(matched)];
        const directives = uniqueMatched
          .map((n) => `Before proceeding, use the Skill tool to load "${n}".`)
          .join('\n');
        deliveryPrompt = `${directives}\n\n${deliveryPrompt}`;
        logger.skills(`dispatch: ${uniqueMatched.map((n) => `/${n}`).join(', ')}`);
      }
    }
  }
  const askAbort = new AbortController();
  const telemetry =
    deps.otel != null ? deps.otel.contextFor(claimed.step.buildId, stepId) : undefined;
  let askKeepAlive: (() => void) | null = null;
  const runAskChannel = async (params: Record<string, unknown>): Promise<string> => {
    if (client.askUser === undefined) throw new Error('ask channel unavailable');
    const requestId = `ask-${randomUUID()}`;
    const keepAlive = setInterval(() => askKeepAlive?.(), 30_000);
    keepAlive.unref?.();
    try {
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
  const skillInjection: { facts: SkillInjectionFacts | null } = { facts: null };
  const sessionOpts: SessionOpts = {
    provider,
    modelId: agent.modelId,
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    ...(systemPrompt && backend.brief === undefined ? { systemPrompt } : {}),
    cwd,
    ...(deliveryPrompt !== null ? { prompt: deliveryPrompt } : {}),
    ...(promptImages !== undefined ? { promptImages } : {}),
    ...(localToolDefs.length > 0 ? { localTools: localToolDefs } : {}),
    ...(remoteTools && remoteTools.length > 0
      ? {
          remoteTools,
          executeRemoteTool: (name, params) => {
            if (name === 'ask_user' && client.askUser) return runAskChannel(params);
            const def = remoteTools.find((t) => t.name === name);
            return client.relayTool(stepId, name, params, {
              ...(def?.replaySafe ? { replaySafe: true } : {}),
            });
          },
        }
      : {}),
    ...(claimedMcp !== undefined ? { mcpServers: mcpEndpoints } : {}),
    ...(isChief || agent.skillsAllowlist == null ? {} : { skillsAllowlist: agent.skillsAllowlist }),
    ...(isChief || injectedForSession === undefined ? {} : { injectedSkills: injectedForSession }),
    onSkillsResolved: (names) => {
      skillInjection.facts = names;
    },
    ...(teamSkillsDir !== null ? { teamSkillsDir } : {}),
    ...(isReview ? { readOnly: true } : {}),
    ...(telemetry !== undefined ? { telemetry } : {}),
    ...(opts.env !== undefined || readonlyWorkspace
      ? { env: { ...opts.env, ...(readonlyWorkspace ? READONLY_GIT_ENV : {}) } }
      : {}),
  };

  let continueId =
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

  if (repo !== null && repo.kind === 'github' && ws !== null) {
    transcript.upsert({
      id: `git-credential-${stepId}`,
      role: 'system',
      content: gitCredentialSourceRowContent(ws.credentialSource ?? 'integration'),
      createdAt: now(),
    });
  }

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
      rmSync(join(deps.paths.plansDir, convId, PLAN_FILE_NAME), { force: true });
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

  let briefHandle: BriefHandle | null = null;
  let briefCleanupFailed = false;
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
      await failStep(deps, heartbeat, stepId, `运行简报写入失败（${reason}）`);
      return;
    }
  }

  if (!isChief) {
    try {
      const skillFiles =
        deps.skillsDir === undefined
          ? new Map<string, string>()
          : collectVisibleSkillFileMap({
              skillsDir: deps.skillsDir,
              cwd: deps.paths.home,
              ...(sessionOpts.skillsAllowlist !== undefined
                ? { allowlist: sessionOpts.skillsAllowlist }
                : {}),
              ...(injectedForSession !== undefined ? { injectedSkills: injectedForSession } : {}),
              ...(teamSkillsDir !== null ? { teamSkillsDir } : {}),
              ...(isPi ? { worktreeSkillsDirs: piWorktreeSkillDirs(cwd) } : {}),
            });
      const injectedNames = skillInjection.facts?.injected;
      const skills = [...skillFiles]
        .filter(([name]) => injectedNames === undefined || injectedNames.includes(name))
        .map(([name, path]) => ({ name, content: readFileSync(path, 'utf8') }));
      provenance.baseSha = headAtStart;
      provenance.harnessHash = computeHarnessHash({
        systemPrompt: systemPrompt ?? '',
        skills,
        tools: [...(remoteTools ?? []), ...localToolDefs].map(({ name, description }) => ({
          name,
          description,
        })),
      });
      await client.heartbeat(stepId, provenance);
    } catch (err: unknown) {
      logger.step(
        `build provenance report failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let usage: AgentTokenUsage = [];
  let lastError: string | null = null;
  let closingPushHookError: GitPushHookError | null = null;
  let lastModelError: string | null = null;
  let messageSeq = 0;
  let sawChangeTool = false;
  let sawDone = false;
  let sawProgress = false;
  let zeroProgressRetries = 0;
  let retryStorm = false;
  const retryStormMax = opts.retryStormMax ?? RETRY_STORM_MAX;
  let quotaTrip: {
    kind: 'quota' | 'capacity';
    reason: string;
    retryAfterMs: number | null;
  } | null = null;
  let networkRetries = 0;
  const providerNetworkFinalWaitMs =
    opts.providerNetworkFinalWaitMs ?? PROVIDER_NETWORK_FINAL_RETRY_WAIT_MS;
  const streamTimeouts = {
    first: opts.streamTimeouts?.first ?? STREAM_TIMEOUTS_MS.streamFirstEvent,
    idle: opts.streamTimeouts?.idle ?? STREAM_TIMEOUTS_MS.streamIdle,
    body: opts.streamTimeouts?.body ?? STREAM_TIMEOUTS_MS.streamBodyTimeout,
  };
  const absoluteDurationCapMs = envDurationCapMs(process.env);
  const streamDurationCapMs =
    absoluteDurationCapMs ?? opts.streamDurationCapMs ?? STREAM_DURATION_CAP_DEFAULT_MS;
  const progressResetsDuration = claimed.step.kind === 'build' && absoluteDurationCapMs === null;
  let timedOut = false;
  let timeoutArm: StreamTimeoutArm | null = null;
  const runningToolCalls = new Set<string>();
  let watchdog: NodeJS.Timeout | null = null;
  let bodyTimeout: NodeJS.Timeout | null = null;
  let durationCap: NodeJS.Timeout | null = null;
  const tripTimeout = (arm: StreamTimeoutArm) => {
    timedOut = true;
    timeoutArm = arm;
    askAbort.abort();
    void handle?.stop();
  };
  const armWatchdog = (ms: number, arm: 'first' | 'idle') => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
    if (arm === 'idle' && runningToolCalls.size > 0) return;
    watchdog = setTimeout(() => tripTimeout(arm), ms);
    watchdog.unref?.();
  };
  const armBodyTimeout = () => {
    if (bodyTimeout) clearTimeout(bodyTimeout);
    bodyTimeout = null;
    if (runningToolCalls.size > 0) return;
    bodyTimeout = setTimeout(() => tripTimeout('body'), streamTimeouts.body);
    bodyTimeout.unref?.();
  };
  const armDurationCap = () => {
    if (durationCap && absoluteDurationCapMs !== null) return;
    if (durationCap) clearTimeout(durationCap);
    durationCap = setTimeout(() => tripTimeout('duration'), streamDurationCapMs);
    durationCap.unref?.();
  };
  askKeepAlive = () => {
    armWatchdog(streamTimeouts.idle, 'idle');
    armBodyTimeout();
    armDurationCap();
  };
  const segments = new SegmentBuffer();
  let sealedInMessage = false;
  let lastRowCreatedAt = 0;
  const rowCreatedAt = (): number => {
    lastRowCreatedAt = Math.max(now(), lastRowCreatedAt + 1);
    return lastRowCreatedAt;
  };
  let deltaBuf = '';
  let deltaTimer: NodeJS.Timeout | null = null;
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
  let thinkingBuf = '';
  let thinkingTimer: NodeJS.Timeout | null = null;
  const flushThinkingNow = async (): Promise<void> => {
    if (thinkingTimer !== null) {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }
    const text = thinkingBuf;
    thinkingBuf = '';
    if (text === '' || client.thinkingDelta === undefined) return;
    try {
      await client.thinkingDelta(stepId, text);
    } catch (err: unknown) {
      logger.step(
        `thinking delta relay failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const flushThinking = (): void => {
    void flushThinkingNow();
  };
  const emitSegment = async (seg: SealedSegment): Promise<void> => {
    await flushThinkingNow();
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
      logger.step(`segment row relay failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (seg.kind === 'text') {
      const items = parseAgentTodoText(seg.text);
      if (items !== null) reportAgentTodo(items);
    }
  };
  const sealSegment = async (): Promise<void> => {
    const seg = segments.seal();
    if (seg !== null) await emitSegment(seg);
  };
  const sealFromContent = async (content: unknown): Promise<void> => {
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
  let handle: AgentSessionHandle | null = null;
  const openSession = (): Promise<AgentSessionHandle> => {
    if (continueId === null) return backend.createSession(sessionOpts);
    return backend.continueSession(continueId, sessionOpts).catch(async (err: unknown) => {
      if (!(err instanceof SessionNotResumableError)) throw err;
      if (opts.resume?.prompt === null) {
        throw new Error(
          `recover step ${stepId}: continue session ${continueId} unavailable and no journal prompt to resend`,
        );
      }
      const missed = continueId ?? '';
      const note = resumeMissNote(missed, claimed);
      logger.step(
        `continue session unavailable (${missed}) — falling back to new session — ${note}`,
      );
      transcript.upsert({
        id: `resume-miss-${stepId}`,
        role: 'system',
        content: note,
        createdAt: now(),
      });
      if (!opts.resume) {
        const fresh = isInfoBuild
          ? appendReportLocationNote(buildTaskPrompt(claimed), reportFile)
          : degradedFreshPrompt(claimed, deps.paths.plansDir, convId);
        journal.update(stepId, {
          prompt: fresh,
          sessionAction: 'new',
          sessionId: null,
        });
        let delivery = fresh;
        let images: DeliveredImage[] | undefined;
        if (!isChief) {
          try {
            const resolved = await resolveStepImages({
              text: fresh,
              stepId,
              client,
              materializeDir: deps.paths.stepAttachmentsDir,
              log: (line) => logger.step(line),
            });
            delivery = resolved.text;
            if (resolved.images.length > 0) images = [...resolved.images];
          } catch (resolveErr) {
            logger.step(
              `attachment resolve failed (delivering raw text): ${
                resolveErr instanceof Error ? resolveErr.message : String(resolveErr)
              }`,
            );
          }
        }
        sessionOpts.prompt = delivery;
        if (images !== undefined) sessionOpts.promptImages = images;
        else delete sessionOpts.promptImages;
        transcript.upsert({
          id: transcriptPromptRowId(stepId),
          role: 'user',
          content: fresh,
          createdAt: now(),
        });
      }
      continueId = null;
      return backend.createSession(sessionOpts);
    });
  };
  for (let pass = 0; ; pass++) {
    if (pass > 0) {
      lastError = null;
      lastModelError = null;
      sawDone = false;
      sawProgress = false;
      timedOut = false;
      timeoutArm = null;
      zeroProgressRetries = 0;
      retryStorm = false;
      usage = [];
      if (thinkingTimer !== null) {
        clearTimeout(thinkingTimer);
        thinkingTimer = null;
      }
      thinkingBuf = '';
      if (deltaTimer !== null) {
        clearTimeout(deltaTimer);
        deltaTimer = null;
      }
      deltaBuf = '';
    }
    if (stop.request !== null) break;
    activity.setPhase('starting', pass > 0 ? { resetLive: true } : undefined);
    try {
      handle = await openSession();
    } catch (err) {
      flushDeltas();
      flushThinking();
      cleanupBriefOnce();
      clearCredentials(creds);
      await failStep(deps, heartbeat, stepId, err instanceof Error ? err.message : String(err));
      return;
    }
    logger.raw(continueId !== null ? `continue session ${convId}` : `new session ${convId}`);
    journal.update(stepId, { state: 'running', sessionId: handle.sessionId });
    deps.sessionHandles?.set(stepId, handle);
    stop.attach(handle).catch((err: unknown) => {
      logger.step(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    runningToolCalls.clear();
    armWatchdog(streamTimeouts.first, 'first');
    armBodyTimeout();
    if (pass === 0) armDurationCap();
    try {
      for await (const ev of handle.events) {
        if (ev.type === 'toolcall_end') {
          if (ev.call.result === undefined) runningToolCalls.add(ev.call.id);
          else runningToolCalls.delete(ev.call.id);
        }
        armWatchdog(streamTimeouts.idle, 'idle');
        armBodyTimeout();
        activity.noteEvent();
        switch (ev.type) {
          case 'text_delta': {
            if (progressResetsDuration) armDurationCap();
            sawProgress = true;
            zeroProgressRetries = 0;
            activity.setPhase('responding');
            deltaBuf += ev.text;
            if (deltaTimer === null) {
              deltaTimer = setTimeout(flushDeltas, TRANSCRIPT_DELTA_FLUSH_MS);
              deltaTimer.unref?.();
            }
            const sealedText = segments.append('text', ev.text);
            if (sealedText !== null) await emitSegment(sealedText);
            break;
          }
          case 'thinking_delta': {
            if (progressResetsDuration) armDurationCap();
            sawProgress = true;
            zeroProgressRetries = 0;
            activity.setPhase('thinking');
            thinkingBuf += ev.text;
            if (thinkingTimer === null) {
              thinkingTimer = setTimeout(flushThinking, TRANSCRIPT_DELTA_FLUSH_MS);
              thinkingTimer.unref?.();
            }
            const sealedThinking = segments.append('thinking', ev.text);
            if (sealedThinking !== null) await emitSegment(sealedThinking);
            break;
          }
          case 'thinking': {
            if (progressResetsDuration) armDurationCap();
            activity.setPhase('thinking');
            const sealedFull = segments.replace('thinking', ev.text);
            if (sealedFull !== null) await emitSegment(sealedFull);
            break;
          }
          case 'toolcall_end': {
            if (progressResetsDuration) armDurationCap();
            sawProgress = true;
            zeroProgressRetries = 0;
            if (ev.call.name && CHANGE_TOOLS.has(ev.call.name.toLowerCase())) {
              sawChangeTool = true;
            }
            await sealSegment();
            if (ev.call.result === undefined) {
              const skillName = skillCallName(ev.call);
              activity.toolStarted(
                ev.call.id,
                skillName !== null ? `skill: ${skillName}` : ev.call.name || 'tool',
              );
            } else {
              activity.toolEnded(ev.call.id);
              const skillFact = classifySkillFact(ev.call);
              if (skillFact !== null) activity.noteSkill(skillFact);
            }
            if (ev.call.todo !== undefined) reportAgentTodo(ev.call.todo);
            transcript.upsert({
              id: ev.call.id,
              role: 'assistant',
              content: { kind: 'toolcall', call: ev.call },
              createdAt: rowCreatedAt(),
            });
            if (ev.call.result === undefined) {
              await client.tool(stepId, ev.call).catch((err: unknown) => {
                logger.step(
                  `tool start relay failed for ${ev.call.id}: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
            } else {
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
            if (ev.message.role === 'user') break;
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
            if (ev.message.role === 'assistant' && ev.message.stopReason !== 'error') {
              if (progressResetsDuration) armDurationCap();
              sawProgress = true;
              zeroProgressRetries = 0;
            }
            if (ev.message.role !== 'assistant') {
              messageSeq += 1;
              transcript.upsert({
                id: `msg-${stepId}-${messageSeq}`,
                role: ev.message.role,
                content: ev.message.content,
                createdAt: rowCreatedAt(),
              });
              break;
            }
            const hadRows = sealedInMessage;
            sealedInMessage = false;
            const trailing = segments.seal();
            if (hadRows || trailing !== null) {
              if (trailing !== null) await emitSegment(trailing);
            } else {
              await sealFromContent(ev.message.content);
            }
            sealedInMessage = false;
            break;
          }
          case 'error':
            lastError = ev.error.message;
            lastModelError = ev.error.message;
            logger.step(`error: ${ev.error.message} (retryable=${ev.error.retryable})`);
            {
              const failureKind = classifyAgentFailure(ev.error.message);
              if (failureKind === 'quota' || failureKind === 'capacity') {
                if (quotaTrip === null) {
                  quotaTrip = {
                    kind: failureKind,
                    reason: ev.error.message,
                    retryAfterMs: parseRetryAfterMs(ev.error.message),
                  };
                  logger.step(
                    `quota circuit breaker: ${failureKind} on ${provider?.providerId ?? 'unknown'} — stopping session (no auto-retry spin)`,
                  );
                }
                void handle.stop();
              }
            }
            break;
          case 'auto_retry_start':
            lastError = null;
            zeroProgressRetries += 1;
            if (zeroProgressRetries > retryStormMax) {
              retryStorm = true;
              logger.step(
                `retry storm: ${zeroProgressRetries} consecutive zero-progress auto-retries (max ${retryStormMax}) — stopping session`,
              );
              void handle.stop();
            }
            logger.step(`auto_retry_start attempt=${ev.attempt}`);
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
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }
    stop.detach();
    {
      const failureText = lastModelError ?? lastError;
      const stopPending = stop.request !== null;
      if (
        failureText !== null &&
        lastError !== null &&
        !stopPending &&
        classifyStepFailure(failureText) === 'network' &&
        networkRetries < PROVIDER_NETWORK_MAX_ATTEMPTS - 1
      ) {
        networkRetries += 1;
        if (networkRetries === PROVIDER_NETWORK_MAX_ATTEMPTS - 1) {
          logger.step(
            `provider network retry ${networkRetries}: waiting ${providerNetworkFinalWaitMs}ms before final attempt`,
          );
          await new Promise((r) => setTimeout(r, providerNetworkFinalWaitMs));
        } else {
          logger.step(`provider network retry ${networkRetries}: resuming session immediately`);
        }
        continueId = handle.sessionId;
        deps.sessionHandles?.delete(stepId);
        continue;
      }
    }
    if (pass === 0 && !sawProgress && quotaTrip === null) {
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
  await sealSegment();
  flushDeltas();
  flushThinking();
  clearInterval(heartbeat);
  if (watchdog) clearTimeout(watchdog);
  if (bodyTimeout) clearTimeout(bodyTimeout);
  if (durationCap) clearTimeout(durationCap);
  askAbort.abort();
  if (timedOut && timeoutArm !== null) {
    lastError = combineTimeoutWithRootCause(
      streamTimeoutMessage(timeoutArm, {
        ...streamTimeouts,
        durationCap: streamDurationCapMs,
      }),
      lastError ?? lastModelError,
    );
  } else if (retryStorm && lastError === null && lastModelError !== null) {
    lastError = lastModelError;
  }
  const stopReq = stop.settle();
  const stopped = stopReq !== null && !sawDone;
  if (stopReq !== null && sawDone) logger.step('stop arrived after completion — ignored');
  const quotaBlock: QuotaBlock | null = (() => {
    if (quotaTrip !== null) {
      return quotaBlockOf(quotaTrip.kind, quotaTrip.reason, quotaTrip.retryAfterMs);
    }
    if (stopped) return null;
    const failureText = lastModelError ?? lastError;
    if (failureText === null) return null;
    const failureKind = classifyAgentFailure(failureText);
    if (failureKind !== 'quota' && failureKind !== 'capacity') return null;
    return quotaBlockOf(failureKind, failureText, parseRetryAfterMs(failureText));
  })();
  if (quotaBlock !== null && lastError === null) {
    lastError = quotaBlock.reason;
  }
  if (!timedOut && !stopped && !sawProgress && !sawDone && lastError === null) {
    lastError =
      'agent session ended with zero progress and no terminal outcome (silent no-op round)';
    logger.step('zero-event round: session stream exhausted without progress, done, or error');
  }
  if (!sawDone && handle !== null) usage = handle.usage();

  cleanupBriefOnce();

  const rewindToStepStart = async (): Promise<string | null> => {
    if (ws?.readonly === true) return null;
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
    if (stopReq?.discard === true) {
      const failed = await rewindToStepStart();
      if (failed !== null) logger.step(`discard rewind failed: ${failed}`);
    }
  }

  let reviewHeadSha: string | null = null;
  if (checkout) {
    try {
      const observed =
        ws !== null && deps.workspace ? await deps.workspace.headCommit(ws.cwd) : null;
      reviewHeadSha = reviewedCheckoutHead(
        headAtStart,
        observed,
        parseReviewPromptMeta(claimed.instruction ?? null)?.expectedHeadSha ?? null,
      );
    } catch (err) {
      logger.step(
        `review head observation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  let headCommit: string | null = null;
  let branchDrift: { expected: string; actual: string } | null = null;
  let artifactBranches: string[] = [];
  let hasChanges = isReview ? false : sawChangeTool;
  if (readonlyWorkspace) hasChanges = false;
  if (
    ws !== null &&
    ws.readonly !== true &&
    deps.workspace &&
    lastError === null &&
    !stopped &&
    !isReview &&
    !briefCleanupFailed
  ) {
    const git = deps.workspace;
    try {
      const headBranch = (await git.currentBranch?.(ws.cwd)) ?? null;
      if (headBranch !== null && headBranch !== ws.branch) {
        branchDrift = { expected: ws.branch, actual: headBranch };
        logger.step(`work branch drift: HEAD on ${headBranch}, contract branch ${ws.branch}`);
        transcript.upsert({
          id: `branch-drift-${stepId}`,
          role: 'system',
          content: `检测到工作分支偏离：收尾时 HEAD 在「${headBranch}」，契约工作分支是「${ws.branch}」。本步产物判定已按步窗口内有新提交的任意分支放宽；交付（提交/推送/PR head）应留在契约分支上。`,
          createdAt: now(),
        });
      }
      const committed = await git.commitAll(
        ws.cwd,
        `${claimed.step.kind}: ${claimed.todo?.title ?? claimed.conversationId}`,
        stepIdentity,
      );
      if (claimed.step.kind === 'merge') {
        const merged = await git.mergeDefaultBranch(ws.cwd, ws.defaultBranch);
        transcript.upsert({
          id: `merge-${stepId}`,
          role: 'system',
          content: `git merge origin/${ws.defaultBranch} 结果为 "${merged.output || 'OK'}"`,
          createdAt: now(),
        });
      }
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
        const pushSource = await withGitCredentialFallback(
          (cred) => git.push(ws.cwd, ws.branch, cred),
          creds.git,
          {
            what: 'push',
            allowMachineFallback: repo?.kind === 'github',
            onFallback: (reason) => {
              logger.step(
                `git push auth failed (per-step token), retrying with machine credentials: ${reason}`,
              );
            },
          },
        );
        if (pushSource === 'machine') {
          transcript.upsert({
            id: `git-credential-${stepId}`,
            role: 'system',
            content: gitCredentialSourceRowContent('machine'),
            createdAt: now(),
          });
        }
        logger.raw(`pushed ${ws.branch}`);
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
      }
      headCommit = committed.head ?? (await git.headCommit(ws.cwd));
      const headAhead = await git.countAhead(ws.cwd, ws.defaultBranch);
      if (headAhead === 0 && headAtStart !== null && git.branchesWithNewCommits) {
        try {
          const candidates = await git.branchesWithNewCommits(ws.cwd, headAtStart, stepStartMs);
          artifactBranches = candidates.filter(
            (b) => b === ws.branch || !b.startsWith(BRAND.branchPrefix),
          );
        } catch (err) {
          logger.step(`branch scan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      hasChanges = headAhead > 0 || artifactBranches.length > 0;
    } catch (err) {
      if (err instanceof GitPushHookError) closingPushHookError = err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  let pushHookOutput: string | null = null;
  if (claimed.step.kind === 'build' && closingPushHookError !== null) {
    pushHookOutput = stripAnsiEscapes(closingPushHookError.message);
    lastError = null;
    if (ws !== null && deps.workspace) {
      headCommit = await deps.workspace.headCommit(ws.cwd);
      hasChanges = true;
    }
  }

  let preservedCommits: string[] = [];
  if (
    claimed.step.kind === 'build' &&
    lastError !== null &&
    !stopped &&
    ws !== null &&
    ws.readonly !== true &&
    deps.workspace &&
    !briefCleanupFailed
  ) {
    const git = deps.workspace;
    try {
      const currentBranch = await git.currentBranch?.(ws.cwd);
      const pushAllowed =
        claimed.agent?.tools === undefined || claimed.agent.tools.includes(AGENT_TOOL_PUSH);
      if (
        currentBranch === ws.branch &&
        pushAllowed &&
        (await git.countAhead(ws.cwd, ws.defaultBranch)) > 0
      ) {
        await withGitCredentialFallback((cred) => git.push(ws.cwd, ws.branch, cred), creds.git, {
          what: 'push',
          allowMachineFallback: repo?.kind === 'github',
        });
        headCommit = await git.headCommit(ws.cwd);
        preservedCommits =
          (await git.commitsAhead?.(ws.cwd, ws.defaultBranch)) ??
          (headCommit === null ? [] : [headCommit]);
        hasChanges = true;
        logger.raw(`pushed ${ws.branch}`);
      }
    } catch (err) {
      logger.step(
        `failed build preservation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (briefCleanupFailed && lastError === null) {
    lastError = '运行简报未能从工作区擦除——本轮未提交未推送（详见 transcript 的简报行）';
  }

  let report: string | null = null;
  if (isInfoBuild && !stopped && lastError === null && existsSync(reportFile)) {
    const content = readFileSync(reportFile, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > INFO_REPORT_MAX_BYTES) {
      lastError = `${REPORT_FILE_NAME} 超过上限 ${INFO_REPORT_MAX_BYTES} 字节，请压缩报告后重试`;
    } else if (content.trim() !== '') {
      report = content;
    }
  }

  const status = stopped ? 'stopped' : lastError === null ? 'success' : 'failed';
  if (!stopped && lastError !== null) logger.step(`step failed: ${lastError}`);
  journal.update(stepId, { state: 'awaiting-upload' });

  let prProbe: { number: number; url: string } | null = null;
  let changesDiff: string | null = null;
  if (
    ws !== null &&
    ws.readonly !== true &&
    repo !== null &&
    (lastError === null || preservedCommits.length > 0) &&
    !stopped &&
    !isReview
  ) {
    const ghRef = repo.kind === 'github' ? githubRepoRefOf(repo.cloneUrl) : null;
    if (ghRef !== null) {
      const probeHeads: string[] = [ws.branch];
      if (branchDrift !== null) probeHeads.push(branchDrift.actual);
      for (const b of artifactBranches) {
        if (probeHeads.length >= 3) break;
        if (!probeHeads.includes(b)) probeHeads.push(b);
      }
      for (const head of probeHeads) {
        prProbe = await probeGithubPr({
          owner: ghRef.owner,
          repo: ghRef.repo,
          branch: head,
          token: creds.git?.password ?? null,
        }).catch((err: unknown) => {
          logger.step(
            `pr probe failed: ${err instanceof Error ? err.message : String(err)} (panel will show branch without PR)`,
          );
          return null;
        });
        if (prProbe !== null) {
          logger.step(`pr probe: #${prProbe.number} for ${head}`);
          break;
        }
      }
    }
    if (
      (repo.kind !== 'hosted' || preservedCommits.length > 0) &&
      deps.workspace?.diffAgainstDefault
    ) {
      try {
        const diff = await deps.workspace.diffAgainstDefault(ws.cwd, ws.defaultBranch);
        changesDiff = diff.length <= CHANGES_DIFF_MAX_BYTES ? diff : null;
        if (changesDiff === null && diff.length > 0) {
          logger.step(
            `changes diff ${diff.length}B over ${CHANGES_DIFF_MAX_BYTES}B cap — projection falls back to empty`,
          );
        }
      } catch (err) {
        logger.step(`changes diff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const messages = transcript.messages();
  let planContent: string | null = null;
  if (claimed.step.kind === 'plan' && !stopped) {
    const readAt = (p: string): string | null => {
      if (!existsSync(p)) return null;
      const content = readFileSync(p, 'utf8');
      return content.trim() !== '' ? content : null;
    };
    const planPath = join(deps.paths.plansDir, convId, PLAN_FILE_NAME);
    planContent =
      (existsSync(planPath) ? readAt(planPath) : readAt(join(cwd, PLAN_FILE_NAME))) ?? null;
  }
  const reviewExtraction =
    claimed.step.kind === 'review'
      ? extractReviewVerdict(transcript.messages(), {
          requireFinalVerdict: reviewGate === 'review',
        })
      : null;
  const verifyExtraction =
    claimed.step.kind === 'verify' ? extractVerifyVerdict(transcript.messages()) : null;
  const sessionIdForDone = handle?.sessionId ?? continueId;
  const doneBody: MachineDoneBody = {
    status,
    ...(lastError !== null ? { errorMessage: stripAnsiEscapes(lastError) } : {}),
    ...(sessionIdForDone !== null ? { sessionId: sessionIdForDone } : {}),
    usage: [...usage],
    hasChanges,
    ...(reviewHeadSha !== null ? { gateHeadSha: reviewHeadSha } : {}),
    ...(headCommit !== null ? { commit: headCommit } : {}),
    ...(preservedCommits.length > 0 ? { preservedCommits } : {}),
    ...(pushHookOutput !== null ? { pushHookOutput } : {}),
    ...(reviewExtraction?.status === 'ok' ? { findings: reviewExtraction.verdict } : {}),
    ...(reviewExtraction?.status === 'failed' ? { findingsError: reviewExtraction.reason } : {}),
    ...(verifyExtraction?.status === 'ok' ? { verifyVerdict: verifyExtraction.verdict } : {}),
    ...(verifyExtraction?.status === 'failed'
      ? { verifyVerdictError: verifyExtraction.reason }
      : {}),
    ...(prProbe !== null ? { prUrl: prProbe.url, prNumber: prProbe.number } : {}),
    ...(changesDiff !== null ? { changesDiff } : {}),
    ...(branchDrift !== null ? { workBranchDrift: branchDrift } : {}),
    ...(quotaBlock !== null ? { quotaBlock } : {}),
    ...(skillInjection.facts !== null ? { skillInjectionFacts: skillInjection.facts } : {}),
    ...(report !== null ? { report } : {}),
    ...(status === 'success' && !messages.some((m) => m.role === 'assistant')
      ? { noOutput: true as const }
      : {}),
  };
  journal.update(stepId, {
    state: 'awaiting-upload',
    doneBody,
    planContent,
    sessionFile: handle?.sessionFile ?? null,
  });
  try {
    await putFinalArtifacts(client, logger, stepId, messages, planContent, handle?.sessionFile);
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    deps.sessionHandles?.delete(stepId);
    return;
  }

  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    deps.sessionHandles?.delete(stepId);
    return;
  }
  clearCredentials(creds);
  journal.remove(stepId);
  deps.sessionHandles?.delete(stepId);
  logger.raw(`finished (${running - 1} running)`);
}

const UPLOAD_RETRY_ATTEMPTS = 3;
const UPLOAD_RETRY_DELAY_MS = 1_000;

function finalUploadFiles(
  messages: TranscriptUpload['messages'],
  planContent: string | null,
  sessionContent: string | null,
): { name: string; size?: number }[] {
  const files: { name: string; size?: number }[] = [
    { name: 'transcript.json', size: JSON.stringify(messages).length },
  ];
  if (planContent !== null) files.push({ name: PLAN_FILE_NAME, size: planContent.length });
  if (sessionContent !== null) files.push({ name: SESSION_FILE_NAME, size: sessionContent.length });
  return files;
}

async function putFinalArtifacts(
  client: MachineApi,
  logger: DaemonLogger,
  stepId: string,
  messages: TranscriptUpload['messages'],
  planContent: string | null,
  sessionFile: string | undefined,
): Promise<void> {
  const sessionContent = readSessionJsonlForUpload(sessionFile, (msg) => logger.step(msg));
  const files = finalUploadFiles(messages, planContent, sessionContent);
  for (let attempt = 1; ; attempt++) {
    try {
      const { uploads } = await client.uploadUrls(stepId, files);
      for (const upload of uploads) {
        if (upload.name === PLAN_FILE_NAME) {
          if (planContent !== null) {
            await client.putUpload(upload.url, upload.headers, planContent, 'text/markdown');
          }
        } else if (upload.name === SESSION_FILE_NAME) {
          if (sessionContent !== null) {
            try {
              await client.putUpload(
                upload.url,
                upload.headers,
                sessionContent,
                'application/x-ndjson',
              );
            } catch (err) {
              logger.step(
                `session upload failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
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

export async function resumePendingUpload(
  deps: Pick<RunStepDeps, 'client' | 'journal' | 'logger' | 'paths' | 'sessionHandles'>,
  entry: StepJournalEntry,
  opts: { running?: number } = {},
): Promise<void> {
  const { client, journal, logger } = deps;
  const stepId = entry.stepId;
  const doneBody = entry.doneBody;
  if (doneBody == null) return;
  const running = opts.running ?? 1;
  logger.recover(`step ${stepId} awaiting upload — replaying final report (no agent round)`);
  const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
  const messages = transcript.messages();
  const planContent = entry.planContent ?? null;
  try {
    await putFinalArtifacts(
      client,
      logger,
      stepId,
      messages,
      planContent,
      entry.sessionFile ?? undefined,
    );
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  journal.remove(stepId);
  deps.sessionHandles?.delete(stepId);
  logger.raw(`finished (${running - 1} running)`);
}

async function failStep(
  deps: RunStepDeps,
  heartbeat: ReturnType<typeof setInterval>,
  stepId: string,
  message: string,
): Promise<void> {
  clearInterval(heartbeat);
  deps.sessionHandles?.delete(stepId);
  deps.logger.step(`failed: ${message}`);
  try {
    await deps.client.done(stepId, { status: 'failed', errorMessage: message });
    deps.journal.remove(stepId);
  } catch (err) {
    deps.logger.step(
      `done(failed) report unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
