import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  AgentTokenUsage,
  BoundGitCredentials,
  ClaimedStep,
  CommitIdentity,
  DeliveredImage,
  LocalToolDef,
  MachineDoneBody,
  MachineHeartbeatBody,
  PreparedWorkspace,
  ProviderConfig,
  QuotaBlock,
  SessionOpts,
  SkillInjectionFacts,
  TranscriptUpload,
  WorkspaceHookNoteData,
  WorktreeOps,
} from '@cairn/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  appendAnswers,
  appendBlockerHandoff,
  appendConfirmedPlanNote,
  appendDecisionsNote,
  appendPlanLocationNote,
  appendReportLocationNote,
  appendWorkBranchNote,
  buildPlanFirstRoundInstruction,
  buildTaskPromptText,
  CONTINUE_PROMPTS,
  classifyAgentFailure,
  classifySkillFact,
  classifyStepFailure,
  composeTaskPromptWithInstruction,
  conversationBranch,
  gitCredentialRowContent,
  INFO_REPORT_MAX_BYTES,
  isBackendRuntimeId,
  isBuildStepKind,
  isIssueSourcedTask,
  LOCAL_TOOL_CREATE_TAG,
  localCommitIdentity,
  noVisionSignalOf,
  PLAN_FILE_NAME,
  parseRetryAfterMs,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
  REMOTE_TOOL_RETRY_DELAYS_MS,
  REPORT_FILE_NAME,
  type ReviewGate,
  SESSION_FILE_NAME,
  skillCallName,
  stepTakesSecrets,
  stripAnsiEscapes,
  transcriptPromptRowId,
  workspaceHookRowContent,
} from '@cairn/shared';
import { createTempEnvironment } from '@cairn/shared/temp-environment';
import { z } from 'zod';
import { createActivityTracker } from './activity.js';
import { AgentTodoReporter, parseAgentTodoText } from './agent-todo.js';
import { AskChannel } from './ask-channel.js';
import { prepareFileAttachment } from './attach-file.js';
import { SessionNotResumableError } from './backend/errors.js';
import type { DaemonOtel } from './backend/otel.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import { collectVisibleSkillFileMap, piWorktreeSkillDirs } from './backend/skills.js';
import { prepareWebTools } from './backend/web-search.js';
import { assertNoLegacyBrief, composeBrief } from './brief-file.js';
import {
  type ClaudeCodeAuthProbe,
  claudeCodeAuthFailureMessage,
  probeClaudeCodeAuth,
} from './claude-code-auth.js';
import { claudeQuotaTrip, claudeRateLimitReport, type QuotaTrip } from './claude-quota-trip.js';
import {
  credentialRedactor,
  credentialSafeEvents,
  guardCredentialOutputs,
  prepareCredentialSessionUpload,
} from './credential-output.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { DeltaRelay } from './delta-relay.js';
import { buildExecutorRecord } from './executor-record.js';
import { GitPushHookError, isGitAuthFailure, withGitCredentialFallback } from './git.js';
import { type StepJournal, type StepJournalEntry, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { isTransientUploadError, type MachineApi, MachineApiError } from './machine-client.js';
import { extractReviewVerdict } from './review-findings.js';
import { buildSecretTool } from './secret-channel.js';
import { type SealedSegment, SegmentEmitter, segmentContent } from './segment.js';
import { readSessionJsonlForUpload } from './session-jsonl.js';
import type { StatePaths } from './state.js';
import { StepAppCredential } from './step-app-credential.js';
import { resolveStepImagesOrRaw } from './step-attachments.js';
import { commitAndPushStep, preserveFailedBuild } from './step-closing-git.js';
import { assembleStepEnv } from './step-env.js';
import { localMergeDoneBody } from './step-local-merge.js';
import { boundedChangesDiff, probeStepPr } from './step-pr-probe.js';
import {
  prepareSkillLoadTool,
  sessionInjectedSkills,
  stepMcpEndpoints,
} from './step-skill-tool.js';
import { type RunStop, StepStops, type StopRequest } from './step-stops.js';
import { prepareStepWorkspace, prepareVerifyClone } from './step-workspace.js';
import {
  resolveStreamLimits,
  STREAM_DURATION_CAP_DEFAULT_MS,
  STREAM_DURATION_CAP_ENV,
  STREAM_FIRST_EVENT_ENV,
  STREAM_IDLE_ENV,
  StreamWatchdog,
} from './stream-watchdog.js';
import { buildCreateTagTool } from './tag-tool.js';
import { materializeTeamSkills } from './team-skills.js';
import { extractVerifyVerdict } from './verify-verdict.js';

export interface RunStepDeps {
  client: MachineApi;
  journal: StepJournal;
  backendFor: (agentProviderId: string | null | undefined, agentId?: string) => AgentBackend;
  logger: DaemonLogger;
  paths: StatePaths;
  workspacesDir: string;
  mcpConfigPath: string;
  workspace?: WorktreeOps;
  sessionHandles?: Map<string, AgentSessionHandle>;
  stepImageSupport?: Map<string, boolean | null>;
  stepSteeringSupport?: Map<string, boolean>;
  stepTranscripts?: Map<string, TranscriptBuffer>;
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
  hookNotes?: WorkspaceHookNoteData[];
  orbStartedAt?: number;
  retryStormMax?: number;
  streamTimeouts?: { first: number; idle: number; body: number };
  streamDurationCapMs?: number;
}

export const PROVIDER_NETWORK_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

export { RETRY_STORM_MAX };

export function combineTimeoutWithRootCause(timeoutText: string, rootCause: string | null): string {
  return rootCause !== null ? `${timeoutText}；根因: ${rootCause}` : timeoutText;
}

export {
  STREAM_DURATION_CAP_DEFAULT_MS,
  STREAM_DURATION_CAP_ENV,
  STREAM_FIRST_EVENT_ENV,
  STREAM_IDLE_ENV,
};

export function buildTaskPrompt(claimed: ClaimedStep): string {
  const todo = claimed.todo;
  if (!todo) return claimed.instruction ?? '';
  const taskText = appendDecisionsNote(
    appendBlockerHandoff(buildTaskPromptText(todo.title, todo.spec, todo), todo.blockerHandoff),
    todo.decisions,
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

function carriedAnswers(claimed: ClaimedStep): { requestId: string; text: string }[] {
  const carried = new Set(claimed.answerIds ?? []);
  return (claimed.todo?.decisions ?? [])
    .filter((decision) => carried.has(decision.requestId))
    .map((decision) => ({ requestId: decision.requestId, text: decision.answer }));
}

function resumeMissNote(sessionId: string, claimed: ClaimedStep): string {
  const prior = claimed.session.priorMachineId;
  if (prior !== undefined && prior !== claimed.step.machineId) {
    return `会话 ${sessionId} 在另一台机器上，本机无法续接。已改开新会话，按原任务继续。`;
  }
  return `本机找不到会话 ${sessionId}，无法续接。已改开新会话，按原任务继续。`;
}

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
  if (isBuildStepKind(claimed.step.kind)) {
    const planFile = confirmedPlanFile(plansDir, convId);
    if (planFile !== null) text = appendConfirmedPlanNote(text, planFile);
  } else if (claimed.step.kind === 'plan') {
    text = appendPlanLocationNote(text, join(plansDir, convId, PLAN_FILE_NAME));
  }
  if (
    (isBuildStepKind(claimed.step.kind) ||
      claimed.step.kind === 'merge' ||
      (claimed.step.kind === 'verify' &&
        parseVerifyPromptMeta(claimed.instruction ?? null)?.evidence !== 'attachments')) &&
    (claimed.project?.repo ?? null) !== null
  ) {
    text = appendWorkBranchNote(
      text,
      conversationBranch(convId),
      claimed.project?.repo?.baseBranch,
    );
  }
  return text;
}

export interface TaskMetaForm {
  vocab: readonly { name: string }[];
}

export function composeTaskMetaInstruction(currentTitle: string, meta?: TaskMetaForm): string {
  if (meta === undefined) {
    return `## 任务元信息\n本任务当前标题是占位截断：「${currentTitle}」。正式开工前，先调用一次 \`set_task_meta\` 工具回填标题：\`title\` = 用不超过 50 个字总结任务正文（平文本，无 markdown，覆盖占位标题）。`;
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
  claimed: Pick<ClaimedStep, 'todo' | 'remoteTools'>,
): { taskMeta: { currentTitle: string; meta?: TaskMetaForm } } | undefined {
  const { todo } = claimed;
  if (!todo) return undefined;
  if (!claimed.remoteTools?.some((tool) => tool.name === 'set_task_meta')) return undefined;
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
  opts?: {
    taskMeta?: { currentTitle: string; meta?: TaskMetaForm };
    attachments?: boolean;
    project?: { name: string; instructions?: string | undefined };
  },
): string | undefined {
  const parts: string[] = [];
  if (opts?.attachments) {
    parts.push(
      'For UI tasks, attach light and dark screenshots with `attach_file {path, caption?}` before your final reply. Attach other deliverable files the same way. Attachment tokens are appended to your assistant output automatically.',
    );
  }
  if (description) parts.push(description);
  if (opts?.project?.instructions) {
    parts.push(`## 项目说明（${opts.project.name}）\n${opts.project.instructions}`);
  }
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
  const stepCleanups: (() => void | Promise<void>)[] = [];
  const errors: unknown[] = [];
  try {
    await runClaimedStep(deps, claimed, opts, heartbeat, stop, provenance, stepCleanups);
  } catch (error) {
    errors.push(error);
  }
  for (const cleanup of [
    ...stepCleanups.reverse(),
    () => deps.sessionHandles?.delete(stepId),
    () => clearInterval(heartbeat),
    () => deps.stepImageSupport?.delete(stepId),
    () => deps.stepSteeringSupport?.delete(stepId),
    () => deps.stepTranscripts?.delete(stepId),
    () => stop.settle(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      `Step execution or cleanup failed: ${errors
        .map((error) => (error instanceof Error ? error.message : String(error)))
        .join('; ')}`,
    );
}

async function runClaimedStep(
  deps: RunStepDeps,
  claimed: ClaimedStep,
  opts: RunStepOptions,
  heartbeat: ReturnType<typeof setInterval>,
  stop: RunStop,
  provenance: MachineHeartbeatBody,
  stepCleanups: (() => void | Promise<void>)[],
): Promise<void> {
  let { client, journal, logger } = deps;
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

  const agentTodo = new AgentTodoReporter({
    send: (items) => client.agentTodo?.(stepId, { items }),
    onFirstError: (err) =>
      logger.step(
        `agent todo relay failed (suppressed until next step): ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
  });

  const isChief = claimed.step.kind === 'chief';
  const isReview = claimed.step.kind === 'review';
  const isVerify = claimed.step.kind === 'verify';
  const verifyMeta = isVerify ? parseVerifyPromptMeta(claimed.instruction ?? null) : null;
  const attachmentVerify = verifyMeta?.evidence === 'attachments';
  const verifyEvidenceDirectory = verifyMeta?.evidenceDirectory;
  const reviewGate: ReviewGate =
    (isReview ? parseReviewPromptMeta(claimed.instruction ?? null)?.gate : undefined) ?? 'confirm';
  const basePrompt =
    opts.resume?.prompt ??
    (isChief || isReview || isVerify
      ? (claimed.instruction ?? '')
      : claimed.session.action === 'continue' && claimed.session.sessionId
        ? appendAnswers(
            claimed.instruction ?? CONTINUE_PROMPTS[claimed.step.kind],
            carriedAnswers(claimed),
          )
        : buildTaskPrompt(claimed));
  const isInfoBuild = isBuildStepKind(claimed.step.kind) && claimed.todo?.output === 'info';
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
    (isBuildStepKind(claimed.step.kind) ||
      claimed.step.kind === 'merge' ||
      (claimed.step.kind === 'verify' && !attachmentVerify)) &&
    (claimed.project?.repo ?? null) !== null
      ? appendWorkBranchNote(
          promptWithPlanNote,
          conversationBranch(convId),
          claimed.project?.repo?.baseBranch,
        )
      : promptWithPlanNote;
  if (claimed.step.kind === 'plan') {
    mkdirSync(join(deps.paths.plansDir, convId), { recursive: true });
  }
  if (isInfoBuild) {
    mkdirSync(dirname(reportFile), { recursive: true });
    if (!opts.resume) rmSync(reportFile, { force: true });
  }

  const claimedEntry = journal.claim({
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

  if (claimed.localMerge !== undefined) {
    const doneBody = await localMergeDoneBody(
      claimed,
      claimed.localMerge,
      () => stop.request !== null,
    );
    const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
    transcript.upsert({
      id: `local-merge-${stepId}`,
      role: 'system',
      content: JSON.stringify(doneBody),
      createdAt: now(),
    });
    journal.update(stepId, { state: 'awaiting-upload', doneBody });
    await resumePendingUpload(
      deps,
      journal.get(stepId) ?? { ...claimedEntry, state: 'awaiting-upload', doneBody },
      { running },
    );
    return;
  }

  const tokenRes = await client.token(stepId);
  const creds = pushCredential(tokenRes, claimed.project?.repo?.cloneUrl ?? null);
  stepCleanups.push(() => clearCredentials(creds));
  const credentialValues = [creds.claudeSubscriptionToken, creds.git?.password];
  const redactors = [credentialRedactor(...credentialValues)];
  const redact = <T>(value: T): T => redactors.reduce((result, next) => next(result), value);
  const appCredential =
    creds.git?.kind === 'app'
      ? new StepAppCredential(
          join(deps.paths.agentRuntimeDir, `step-${stepId}-github`),
          creds.git,
          async () => {
            const fresh = (await client.token(stepId)).git;
            if (fresh?.password) {
              credentialValues.push(fresh.password);
              redactors.push(credentialRedactor(fresh.password));
            }
            if (fresh?.kind !== 'app' || creds.git === null)
              throw new Error('App credential refresh unavailable');
            return { ...fresh, url: creds.git.url };
          },
          (value) => {
            credentialValues.push(value);
            redactors.push(credentialRedactor(value));
          },
          now,
          () => logger.step('App credential timer refresh failed; retrying next minute'),
        )
      : null;
  if (appCredential !== null) stepCleanups.push(() => appCredential.dispose());
  const refreshGit = async () => {
    if (appCredential === null) throw new Error('App credential refresh unavailable');
    return appCredential.refresh();
  };
  client = guardCredentialOutputs(client, redact);
  journal = guardCredentialOutputs(journal, redact);
  logger = guardCredentialOutputs(logger, redact);
  deps = { ...deps, client, journal, logger };
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
  if (runtimeId === 'claude-code' && creds.claudeSubscriptionToken === undefined) {
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
  const backend = deps.backendFor(agent?.provider, agent.id);
  deps.stepSteeringSupport?.set(stepId, backend.capabilities.steering !== false);
  const modelKey = `${provider?.providerId ?? agent.provider}/${agent.modelId}`;
  logger.raw(`using model ${modelKey}`);

  let imageSupport: boolean | null = null;
  if (!isChief) {
    try {
      imageSupport = (await backend.modelSupportsImages?.(provider, agent.modelId)) ?? null;
    } catch (err) {
      imageSupport = null;
      logger.step(
        `image support probe failed (assuming unknown): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  deps.stepImageSupport?.set(stepId, imageSupport);
  let activePrompt = prompt;
  let deliveryPrompt = prompt;
  let promptImages: DeliveredImage[] | undefined;
  let skippedNoVisionCount = 0;
  if (!isChief && prompt !== null) {
    const resolved = await resolveStepImagesOrRaw({
      text: prompt,
      stepId,
      client,
      materializeDir: deps.paths.stepAttachmentsDir,
      log: (line) => logger.step(line),
      imageSupport,
    });
    deliveryPrompt = resolved.text;
    if (resolved.images.length > 0) promptImages = [...resolved.images];
    skippedNoVisionCount = resolved.skippedNoVision;
  }
  if (skippedNoVisionCount > 0) {
    logger.step(
      `image attachment skipped: model ${modelKey} does not support images (${skippedNoVisionCount} image(s) not delivered)`,
    );
  }

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
    const prepared = await prepareStepWorkspace({
      workspace: deps.workspace,
      claimed,
      repo,
      workspacesRoot: deps.workspacesDir,
      credentials: creds.git,
      readonly: readonlyWorkspace,
      refresh: refreshGit,
      machineName: deps.machineName ?? hostname(),
    });
    if ('error' in prepared) {
      clearCredentials(creds);
      await failStep(deps, heartbeat, stepId, prepared.error);
      return;
    }
    ws = prepared.ws;
  }
  let cwd = ws?.cwd ?? join(deps.workspacesDir, convId);
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

  const uploadedVerifyEvidence = new Set<string>();
  if (attachmentVerify) {
    const verifyClone = await prepareVerifyClone({
      workspace: deps.workspace,
      ws,
      headAtStart,
      evidenceDirectory: verifyEvidenceDirectory,
      expectedHeadSha: verifyMeta?.expectedHeadSha,
      cleanups: stepCleanups,
    });
    if ('error' in verifyClone) {
      await failStep(deps, heartbeat, stepId, verifyClone.error);
      return;
    }
    ws = verifyClone.ws;
    cwd = verifyClone.cwd;
    headAtStart = verifyClone.headAtStart;
  }

  const systemPrompt =
    isChief && claimed.chief
      ? claimed.chief.systemPrompt
      : composeWorkerSystemPrompt(agent.description, agent.memories, {
          ...taskMetaOpts(claimed),
          attachments: true,
          ...(claimed.project !== undefined ? { project: claimed.project } : {}),
        });
  const remoteTools = claimed.remoteTools;
  const claimedMcp = claimed.mcpServers;
  const mcpEndpoints = stepMcpEndpoints(deps.mcpConfigPath, claimedMcp, (line) => logger.mcp(line));
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
  const isPi = backend.brief?.backendId === 'pi';
  const webTools = prepareWebTools({
    enabled: isPi && !isChief && !isReview && claimed.remoteToolsOnly !== true,
    metered: opts.env?.CAIRN_ORB !== '1',
    creds,
    stepId,
    home: deps.paths.home,
    log: (line) => logger.step(line),
  });
  const secretTool = stepTakesSecrets(claimed.step.kind)
    ? buildSecretTool({
        creds: webTools.secretCreds,
        stepId,
        agentId: agent?.id ?? null,
        onAudit: (line) => logger.step(line),
      })
    : null;
  const appIdentity: CommitIdentity | null = tokenRes.commitIdentity ?? null;
  const stepIdentity: CommitIdentity =
    appIdentity ?? localCommitIdentity(claimed.agent?.displayName ?? 'cairn-agent');
  const withStepGit = async (
    operation: (credential: BoundGitCredentials | null) => Promise<void>,
  ) => {
    let refreshed = false;
    const refresh = async () => {
      if (refreshed) throw new Error('App credential authentication failed after refresh');
      refreshed = true;
      return refreshGit();
    };
    if (appCredential?.needsRefresh()) await refreshGit();
    return withGitCredentialFallback(operation, creds.git, {
      what: 'push',
      allowMachineFallback: repo?.kind === 'github',
      refresh,
      onFallback: (reason) =>
        logger.step(
          `git push auth failed (per-step token), retrying with machine credentials: ${reason}`,
        ),
    });
  };
  const createTagTool = (claimed.localTools ?? []).includes(LOCAL_TOOL_CREATE_TAG)
    ? buildCreateTagTool({
        repoDir: ws?.cwd ?? null,
        cred: creds.git,
        identity: stepIdentity,
        withCredentials: async (operation) => {
          try {
            await withStepGit(operation);
          } catch (error) {
            throw new Error(redact(error instanceof Error ? error.message : String(error)));
          }
        },
      })
    : null;
  const localToolDefs = [secretTool, createTagTool, ...webTools.tools].filter(
    (t): t is LocalToolDef => t !== null,
  );
  const injectedForSession = sessionInjectedSkills(agent);
  const skillsRootDir = deps.skillsDir;
  if (isPi && skillsRootDir !== undefined) {
    const skillLoad = prepareSkillLoadTool({
      skillsDir: skillsRootDir,
      home: deps.paths.home,
      cwd,
      isChief,
      skillsAllowlist: agent.skillsAllowlist,
      injectedSkills: injectedForSession,
      teamSkillsDir,
      log: (msg) => logger.skills(msg),
    });
    localToolDefs.push(skillLoad.tool);
    if (deliveryPrompt !== null) deliveryPrompt = skillLoad.withDispatch(deliveryPrompt);
  }
  const askChannel = new AskChannel({ client, stepId, log: (message) => logger.step(message) });
  const telemetry =
    deps.otel != null
      ? deps.otel.contextFor(claimed.step.buildId, stepId, claimed.step.kind)
      : undefined;
  const skillInjection: { facts: SkillInjectionFacts | null } = { facts: null };
  let temporary: ReturnType<typeof createTempEnvironment>;
  try {
    temporary = createTempEnvironment({ ...process.env, ...opts.env });
  } catch (error) {
    await failStep(
      deps,
      heartbeat,
      stepId,
      `Temporary directory setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  stepCleanups.push(temporary.cleanup);
  const { env: stepEnv, dropGitCredentials } = assembleStepEnv({
    inherited: opts.env,
    temporary: temporary.env,
    git: repo?.kind === 'github' ? creds.git : null,
    appCredential,
    readonlyGit: readonlyWorkspace || attachmentVerify,
    claudeSubscriptionToken:
      runtimeId === 'claude-code' ? creds.claudeSubscriptionToken : undefined,
  });
  stepCleanups.push(dropGitCredentials);
  const sessionOpts: SessionOpts = {
    provider,
    modelId: agent.modelId,
    ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    cwd,
    ...(deliveryPrompt !== null ? { prompt: deliveryPrompt } : {}),
    ...(promptImages !== undefined ? { promptImages } : {}),
    ...(localToolDefs.length > 0 ? { localTools: localToolDefs } : {}),
    ...(remoteTools && remoteTools.length > 0
      ? {
          remoteTools,
          executeRemoteTool: (name, params) => {
            if (name === 'ask_user' && askChannel.available) return askChannel.ask(params);
            if (name === 'attach_file' && !isChief) {
              const prepared = prepareFileAttachment(
                cwd,
                params,
                attachmentVerify ? verifyEvidenceDirectory : undefined,
              );
              const upload = client.relayTool(stepId, name, prepared);
              if (!attachmentVerify) return upload;
              const path = resolve(cwd, String(params.path));
              const sha256 = createHash('sha256')
                .update(Buffer.from(String(prepared.contentBase64), 'base64'))
                .digest('hex');
              return upload.then((result) => {
                z.object({ id: z.string().min(1), sha256: z.literal(sha256) }).parse(
                  JSON.parse(result),
                );
                uploadedVerifyEvidence.add(path);
                return result;
              });
            }
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
    ...(isChief || isReview ? { lockedDown: true } : {}),
    ...(claimed.remoteToolsOnly === true ? { remoteToolsOnly: true } : {}),
    ...(telemetry !== undefined ? { telemetry } : {}),
    ...(Object.keys(stepEnv).length > 0 ? { env: stepEnv } : {}),
  };

  let continueId =
    claimed.session.action === 'continue'
      ? (opts.resume?.sessionId ?? claimed.session.sessionId)
      : null;

  const transcript = guardCredentialOutputs(
    new TranscriptBuffer(deps.paths.outboxDir, stepId),
    redact,
  );
  deps.stepTranscripts?.set(stepId, transcript);
  if (skippedNoVisionCount > 0) {
    transcript.upsert({
      id: `image-skip-${stepId}`,
      role: 'system',
      content: `图片未被模型读取：模型 ${modelKey} 不支持图片输入，${skippedNoVisionCount} 张图片未下载（步骤继续执行，请以文字描述或改用支持图片的模型）`,
      createdAt: now(),
    });
  }
  if (prompt !== null) {
    transcript.upsert({
      id: transcriptPromptRowId(stepId),
      role: 'user',
      content: prompt,
      createdAt: now(),
    });
  }
  for (const [index, hook] of [...(opts.hookNotes ?? []), ...(ws?.hooks ?? [])].entries()) {
    const output =
      opts.hookNotes?.includes(hook) &&
      hook.output.startsWith('orb: started in') &&
      opts.orbStartedAt !== undefined
        ? `orb: started in ${Math.max(0, now() - opts.orbStartedAt)}ms`
        : hook.output;
    transcript.upsert({
      id: opts.hookNotes?.includes(hook)
        ? `orb-hook-${index}-${stepId}`
        : `hook-${hook.name}-${stepId}`,
      role: 'system',
      content: workspaceHookRowContent(hook, redact(output)),
      createdAt: now(),
    });
  }

  if (repo !== null && repo.kind === 'github' && ws !== null) {
    transcript.upsert({
      id: `git-credential-${stepId}`,
      role: 'system',
      content: gitCredentialRowContent(ws.credentialSource ?? 'integration'),
      createdAt: now(),
    });
  }

  if (
    ws !== null &&
    deps.workspace &&
    claimed.session.action === 'new' &&
    !isReview &&
    !attachmentVerify &&
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

  try {
    assertNoLegacyBrief(cwd);
    if (backend.brief !== undefined) {
      sessionOpts.systemPrompt = composeBrief({
        cwd,
        backendId: backend.brief.backendId,
        content: backend.brief.composeBody(sessionOpts, systemPrompt),
      });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, `Runtime guidance could not be composed: ${reason}`);
    return;
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
      const executorRecord = buildExecutorRecord({
        backend: backend.capabilities.name,
        model: modelKey,
        effort: agent.thinkingLevel,
        harness: {
          systemPrompt: systemPrompt ?? '',
          skills,
          tools: [...(remoteTools ?? []), ...localToolDefs].map(({ name, description }) => ({
            name,
            description,
          })),
        },
      });
      provenance.harnessHash = executorRecord.harness_sha;
      logger.step(`executor record ${JSON.stringify(executorRecord)}`);
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
  let lastErrorWasProcessCrash = false;
  let messageSeq = 0;
  let sawChangeTool = false;
  let sawDone = false;
  let sawProgress = false;
  let priorPassMadeProgress = false;
  let zeroProgressRetries = 0;
  let retryStorm = false;
  const retryStormMax = opts.retryStormMax ?? RETRY_STORM_MAX;
  let quotaTrip: QuotaTrip | null = null;
  let networkRetries = 0;
  const networkRetryDelays =
    claimed.step.kind === 'plan' || isBuildStepKind(claimed.step.kind)
      ? PROVIDER_NETWORK_RETRY_DELAYS_MS
      : [0, 5_000];
  let noVisionDegraded = false;
  const retryWithoutImages = async (failureText: string): Promise<boolean> => {
    if (
      noVisionDegraded ||
      sawProgress ||
      priorPassMadeProgress ||
      watchdog.trippedArm !== null ||
      stop.request !== null ||
      quotaTrip !== null ||
      promptImages === undefined ||
      prompt === null ||
      !noVisionSignalOf(failureText)
    ) {
      return false;
    }
    noVisionDegraded = true;
    imageSupport = false;
    backend.rememberNoVision?.(sessionOpts.provider, sessionOpts.modelId);
    deps.stepImageSupport?.set(stepId, false);
    const retryPrompt =
      continueId === null
        ? activePrompt
        : isInfoBuild
          ? appendReportLocationNote(buildTaskPrompt(claimed), reportFile)
          : degradedFreshPrompt(claimed, deps.paths.plansDir, convId);
    const degraded = await resolveStepImagesOrRaw({
      text: retryPrompt,
      stepId,
      client,
      materializeDir: deps.paths.stepAttachmentsDir,
      log: (line) => logger.step(line),
      imageSupport: false,
    });
    sessionOpts.prompt = degraded.text;
    continueId = null;
    journal.update(stepId, { prompt: retryPrompt, sessionAction: 'new', sessionId: null });
    delete sessionOpts.promptImages;
    promptImages = undefined;
    logger.step(`image degrade retry: ${modelKey} rejected image input — retrying without images`);
    transcript.upsert({
      id: `image-skip-${stepId}`,
      role: 'system',
      content: `图片未被模型读取：模型 ${modelKey} 拒绝了图片输入（${failureText.slice(0, 200)}），已去掉图片重试本步骤`,
      createdAt: now(),
    });
    deps.sessionHandles?.delete(stepId);
    return true;
  };
  const streamLimits = resolveStreamLimits({
    ...(opts.streamTimeouts !== undefined ? { timeouts: opts.streamTimeouts } : {}),
    ...(opts.streamDurationCapMs !== undefined ? { durationCapMs: opts.streamDurationCapMs } : {}),
  });
  const toolStartedAt = new Map<string, number>();
  const watchdog = new StreamWatchdog({
    timeouts: streamLimits.timeouts,
    durationCapMs: streamLimits.durationCapMs,
    durationCapIsAbsolute: streamLimits.durationCapIsAbsolute,
    progressExtendsDuration:
      isBuildStepKind(claimed.step.kind) && !streamLimits.durationCapIsAbsolute,
    onTrip: () => {
      askChannel.abort();
      void handle?.stop();
    },
  });
  askChannel.keepAlive = () => watchdog.keepAlive();
  let lastRowCreatedAt = 0;
  const rowCreatedAt = (): number => {
    lastRowCreatedAt = Math.max(now(), lastRowCreatedAt + 1);
    return lastRowCreatedAt;
  };
  const textDeltas = new DeltaRelay({
    flushMs: TRANSCRIPT_DELTA_FLUSH_MS,
    send: (text) => client.transcriptDelta(stepId, text),
    onError: (err) =>
      logger.step(
        `transcript delta relay failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
  const thinkingDeltas = new DeltaRelay({
    flushMs: TRANSCRIPT_DELTA_FLUSH_MS,
    send: (text) => client.thinkingDelta?.(stepId, text),
    onError: (err) =>
      logger.step(
        `thinking delta relay failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
  });
  const emitSegment = async (seg: SealedSegment): Promise<void> => {
    await thinkingDeltas.flushNow();
    await textDeltas.flushNow();
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
      if (items !== null) agentTodo.report(items);
    }
  };
  const segments = new SegmentEmitter(emitSegment);
  let handle: AgentSessionHandle | null = null;
  sessionOpts.onClaudeRateLimit = (notice) => {
    const machineId = claimed.step.machineId;
    if (machineId !== null) {
      void client
        .reportClaudeRateLimit?.(claudeRateLimitReport(machineId, notice))
        .catch((err: unknown) => {
          logger.step(
            `claude rate limit report failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }
    if (quotaTrip !== null) return;
    const trip = claudeQuotaTrip(notice, Date.now());
    if (trip === null) return;
    quotaTrip = trip;
    void handle?.stop();
  };
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
        activePrompt = fresh;
        let delivery = fresh;
        let images: DeliveredImage[] | undefined;
        if (!isChief) {
          const resolved = await resolveStepImagesOrRaw({
            text: fresh,
            stepId,
            client,
            materializeDir: deps.paths.stepAttachmentsDir,
            log: (line) => logger.step(line),
            imageSupport,
          });
          delivery = resolved.text;
          if (resolved.images.length > 0) images = [...resolved.images];
          if (resolved.skippedNoVision > 0) {
            transcript.upsert({
              id: `image-skip-${stepId}`,
              role: 'system',
              content: `图片未被模型读取：模型 ${modelKey} 不支持图片输入，${resolved.skippedNoVision} 张图片未下载（步骤继续执行，请以文字描述或改用支持图片的模型）`,
              createdAt: now(),
            });
          }
        }
        sessionOpts.prompt = delivery;
        promptImages = images;
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
      priorPassMadeProgress ||= sawProgress;
      lastError = null;
      lastModelError = null;
      lastErrorWasProcessCrash = false;
      sawDone = false;
      sawProgress = false;
      watchdog.clearTrip();
      zeroProgressRetries = 0;
      retryStorm = false;
      usage = [];
      thinkingDeltas.discard();
      textDeltas.discard();
    }
    if (stop.request !== null) break;
    activity.setPhase('starting', pass > 0 ? { resetLive: true } : undefined);
    try {
      handle = await openSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await retryWithoutImages(message)) continue;
      textDeltas.flush();
      thinkingDeltas.flush();
      clearCredentials(creds);
      await failStep(deps, heartbeat, stepId, message);
      return;
    }
    logger.raw(continueId !== null ? `continue session ${convId}` : `new session ${convId}`);
    if (!isChief && imageSupport === null) {
      try {
        imageSupport =
          (await backend.modelSupportsImages?.(sessionOpts.provider, sessionOpts.modelId)) ?? null;
        deps.stepImageSupport?.set(stepId, imageSupport);
      } catch (err) {
        logger.step(
          `session image support probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    journal.update(stepId, { state: 'running', sessionId: handle.sessionId });
    deps.sessionHandles?.set(stepId, handle);
    let promptDelivered = false;
    stop.attach(handle).catch((err: unknown) => {
      logger.step(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    watchdog.startPass(pass === 0);
    try {
      for await (const ev of credentialSafeEvents(handle.events, () => credentialValues)) {
        if (!promptDelivered) {
          promptDelivered = true;
          await askChannel.ackAnswers(claimed.answerIds ?? [], 'session-start');
        }
        if (ev.type === 'toolcall_end') {
          watchdog.noteToolCall(ev.call.id, ev.call.result === undefined);
          if (ev.call.result !== undefined) await askChannel.ackPollsReachedBy(ev.call.result);
        }
        watchdog.noteEvent();
        activity.noteEvent();
        switch (ev.type) {
          case 'text_delta': {
            watchdog.noteProgress();
            sawProgress = true;
            zeroProgressRetries = 0;
            activity.setPhase('responding');
            textDeltas.push(ev.text);
            await segments.append('text', ev.text);
            break;
          }
          case 'thinking_delta': {
            watchdog.noteProgress();
            sawProgress = true;
            zeroProgressRetries = 0;
            activity.setPhase('thinking');
            thinkingDeltas.push(ev.text);
            await segments.append('thinking', ev.text);
            break;
          }
          case 'thinking': {
            watchdog.noteProgress();
            activity.setPhase('thinking');
            await segments.replace('thinking', ev.text);
            break;
          }
          case 'toolcall_end': {
            const eventTime = now();
            if (ev.call.result === undefined) {
              const startedAt = ev.call.startedAt ?? toolStartedAt.get(ev.call.id) ?? eventTime;
              toolStartedAt.set(ev.call.id, startedAt);
              ev.call = { ...ev.call, startedAt };
            } else {
              const startedAt = ev.call.startedAt ?? toolStartedAt.get(ev.call.id);
              ev.call = {
                ...ev.call,
                ...(startedAt !== undefined ? { startedAt } : {}),
                endedAt: ev.call.endedAt ?? eventTime,
              };
              toolStartedAt.delete(ev.call.id);
            }
            watchdog.noteProgress();
            sawProgress = true;
            zeroProgressRetries = 0;
            if (ev.call.name && CHANGE_TOOLS.has(ev.call.name.toLowerCase())) {
              sawChangeTool = true;
            }
            await segments.seal();
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
            if (ev.call.todo !== undefined) agentTodo.report(ev.call.todo);
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
              watchdog.noteProgress();
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
            await segments.endAssistantMessage(ev.message.content);
            break;
          }
          case 'error':
            lastError = ev.error.message;
            lastModelError = ev.error.message;
            lastErrorWasProcessCrash = ev.error.processCrash === true;
            logger.step(`error: ${ev.error.message} (retryable=${ev.error.retryable})`);
            {
              const failureKind = lastErrorWasProcessCrash
                ? 'other'
                : classifyAgentFailure(ev.error.message);
              if (
                !lastErrorWasProcessCrash &&
                classifyStepFailure(ev.error.message) === 'model_unavailable'
              ) {
                logger.step(`model unavailable: ${modelKey} — stopping session without retry`);
                await handle.stop();
              } else if (failureKind === 'quota' || failureKind === 'capacity') {
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
              if (promptImages !== undefined && noVisionSignalOf(ev.error.message)) {
                logger.step(
                  `image capability rejected by ${modelKey} — stopping session (no auto-retry spin)`,
                );
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
        if (classifyStepFailure(lastModelError ?? '') === 'model_unavailable') break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    stop.detach();
    if (classifyStepFailure(lastModelError ?? '') === 'model_unavailable')
      lastError = lastModelError;
    {
      const failureText = lastModelError ?? lastError;
      const stopPending = stop.request !== null;
      if (
        failureText !== null &&
        lastError !== null &&
        !stopPending &&
        classifyStepFailure(failureText) === 'network' &&
        networkRetries < networkRetryDelays.length
      ) {
        const delay = networkRetryDelays[networkRetries] ?? 0;
        networkRetries += 1;
        logger.step(
          `provider network retry ${networkRetries}: waiting ${delay}ms before ${networkRetries === networkRetryDelays.length ? 'final' : 'next'} attempt`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continueId = handle.sessionId;
        deps.sessionHandles?.delete(stepId);
        continue;
      }
    }
    if (classifyStepFailure(lastModelError ?? lastError ?? '') === 'model_unavailable') break;
    if (pass === 0 && !sawProgress && quotaTrip === null) {
      const failureText = lastModelError ?? lastError;
      if (
        failureText !== null &&
        (lastError !== null ||
          (watchdog.trippedArm !== null && lastModelError !== null) ||
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
    const imageFailure = lastModelError ?? lastError;
    if (imageFailure !== null && (await retryWithoutImages(imageFailure))) continue;
    break;
  }
  deps.sessionHandles?.delete(stepId);
  await segments.seal();
  textDeltas.flush();
  thinkingDeltas.flush();
  if (opts.env?.CAIRN_ORB !== '1') clearInterval(heartbeat);
  watchdog.stop();
  askChannel.abort();
  const timeoutText = watchdog.message();
  if (timeoutText !== null) {
    lastError = combineTimeoutWithRootCause(timeoutText, lastError ?? lastModelError);
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
    if (stopped || lastErrorWasProcessCrash) return null;
    const failureText = lastModelError ?? lastError;
    if (failureText === null) return null;
    const failureKind = classifyAgentFailure(failureText);
    if (failureKind !== 'quota' && failureKind !== 'capacity') return null;
    return quotaBlockOf(failureKind, failureText, parseRetryAfterMs(failureText));
  })();
  if (quotaBlock !== null && lastError === null) {
    lastError = quotaBlock.reason;
  }
  if (watchdog.trippedArm === null && !stopped && !sawProgress && !sawDone && lastError === null) {
    lastError =
      'agent session ended with zero progress and no terminal outcome (silent no-op round)';
    logger.step('zero-event round: session stream exhausted without progress, done, or error');
  }
  if (!sawDone && handle !== null) usage = handle.usage();

  const rewindToStepStart = async (): Promise<string | null> => {
    if (attachmentVerify) return null;
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

  const pushStep = (git: WorktreeOps, workspace: PreparedWorkspace) =>
    withStepGit(async (credential) => {
      await git.push(workspace.cwd, workspace.branch, credential, {
        base: headAtStart,
        identity: appIdentity,
        coAuthor: tokenRes.coAuthor ?? null,
      });
    });
  let headCommit: string | null = attachmentVerify ? headAtStart : null;
  let branchDrift: { expected: string; actual: string } | null = null;
  let artifactBranches: string[] = [];
  let hasChanges = isReview || attachmentVerify ? false : sawChangeTool;
  if (readonlyWorkspace) hasChanges = false;
  if (
    ws !== null &&
    ws.readonly !== true &&
    deps.workspace &&
    lastError === null &&
    !stopped &&
    !isReview &&
    !attachmentVerify
  ) {
    const git = deps.workspace;
    const workspace = ws;
    const closing = await commitAndPushStep({
      git,
      ws: workspace,
      claimed,
      stepId,
      coAuthor: tokenRes.coAuthor ?? null,
      identity: stepIdentity,
      mergeCredential: creds.git,
      headAtStart,
      stepStartMs,
      push: () => pushStep(git, workspace),
      note: (id, content) => transcript.upsert({ id, role: 'system', content, createdAt: now() }),
      log: (message) => logger.step(message),
      logRaw: (message) => logger.raw(message),
    });
    headCommit = closing.headCommit;
    branchDrift = closing.branchDrift;
    artifactBranches = closing.artifactBranches;
    if (closing.hasChanges !== null) hasChanges = closing.hasChanges;
    if (closing.error !== null) {
      const err = closing.error;
      if (err instanceof GitPushHookError) closingPushHookError = err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  let pushHookOutput: string | null = null;
  if (isBuildStepKind(claimed.step.kind) && closingPushHookError !== null) {
    pushHookOutput = stripAnsiEscapes(closingPushHookError.message);
    lastError = null;
    if (ws !== null && deps.workspace) {
      headCommit = await deps.workspace.headCommit(ws.cwd);
      hasChanges = true;
    }
  }

  let preservedCommits: string[] = [];
  if (
    isBuildStepKind(claimed.step.kind) &&
    lastError !== null &&
    !isGitAuthFailure(lastError) &&
    !stopped &&
    ws !== null &&
    ws.readonly !== true &&
    deps.workspace
  ) {
    const git = deps.workspace;
    const workspace = ws;
    const preserved = await preserveFailedBuild({
      git,
      ws: workspace,
      claimed,
      push: () => pushStep(git, workspace),
      log: (message) => logger.step(message),
      logRaw: (message) => logger.raw(message),
    });
    if (preserved !== null) {
      headCommit = preserved.headCommit;
      preservedCommits = preserved.commits;
      hasChanges = true;
    }
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
    !isReview &&
    !attachmentVerify
  ) {
    if (repo.kind === 'github') {
      prProbe = await probeStepPr({
        cloneUrl: repo.cloneUrl,
        branch: ws.branch,
        driftBranch: branchDrift?.actual ?? null,
        artifactBranches,
        baseBranch: ws.defaultBranch,
        credential: creds.git,
        refreshToken: appCredential !== null ? async () => (await refreshGit()).password : null,
        log: (message) => logger.step(message),
      });
    }
    const diffAgainstDefault = deps.workspace?.diffAgainstDefault?.bind(deps.workspace);
    if ((repo.kind !== 'hosted' || preservedCommits.length > 0) && diffAgainstDefault) {
      changesDiff = await boundedChangesDiff(
        diffAgainstDefault,
        ws.cwd,
        ws.defaultBranch,
        (message) => logger.step(message),
      );
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
    claimed.step.kind === 'review' ? extractReviewVerdict(transcript.messages()) : null;
  const verifyExtraction =
    claimed.step.kind === 'verify'
      ? extractVerifyVerdict(transcript.messages(), { strict: attachmentVerify })
      : null;
  if (attachmentVerify && verifyExtraction?.status === 'ok' && verifyExtraction.verdict.passed) {
    const evidence = verifyExtraction.verdict.evidence;
    if (
      evidence.length === 0 ||
      evidence.some((item) => !uploadedVerifyEvidence.has(resolve(cwd, item.path)))
    ) {
      verifyExtraction.verdict = {
        ...verifyExtraction.verdict,
        passed: false,
        conclusion: `${verifyExtraction.verdict.conclusion}\nAttachment evidence is missing or was not successfully uploaded by this verification step.`,
      };
    }
  }
  const sessionIdForDone = handle?.sessionId ?? continueId;
  const doneBody: MachineDoneBody = {
    status,
    ...(lastError !== null ? { errorMessage: stripAnsiEscapes(lastError) } : {}),
    ...(sessionIdForDone !== null ? { sessionId: sessionIdForDone } : {}),
    usage: [...usage],
    hasChanges,
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
  const redactedSessionFile = join(deps.paths.outboxDir, `step-${stepId}.session.jsonl`);
  const sessionFileForUpload = credentialValues.reduce<string | undefined>(
    (source, credential) =>
      prepareCredentialSessionUpload(source, credential, redactedSessionFile, (message) =>
        logger.step(message),
      ),
    handle?.sessionFile,
  );
  journal.update(stepId, {
    state: 'awaiting-upload',
    doneBody,
    planContent,
    sessionFile: sessionFileForUpload ?? null,
  });
  try {
    await putFinalArtifacts(client, logger, stepId, messages, planContent, sessionFileForUpload);
  } catch (err) {
    logger.step(`transcript upload failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    return;
  }

  try {
    await client.done(stepId, doneBody);
  } catch (err) {
    logger.step(`done report failed: ${err instanceof Error ? err.message : String(err)}`);
    clearCredentials(creds);
    return;
  }
  clearCredentials(creds);
  journal.remove(stepId);
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
  opts: { running?: number; failOnRejectedDone?: boolean } = {},
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
    if (
      !opts.failOnRejectedDone ||
      !(err instanceof MachineApiError) ||
      err.status < 400 ||
      err.status >= 500
    )
      return;
    const failedBody: MachineDoneBody = {
      status: 'failed',
      errorMessage: `Orb completion rejected with HTTP ${err.status}: ${err.body}`,
    };
    journal.update(stepId, { doneBody: failedBody });
    try {
      await client.done(stepId, failedBody);
    } catch (error) {
      logger.step(
        `done(failed) report unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
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
  deps.sessionHandles?.delete(stepId);
  deps.logger.step(`failed: ${message}`);
  try {
    await deps.client.done(stepId, { status: 'failed', errorMessage: message });
    deps.journal.remove(stepId);
  } catch (err) {
    deps.logger.step(
      `done(failed) report unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}
