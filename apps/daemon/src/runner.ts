import { mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  CommitIdentity,
  DeliveredImage,
  MachineHeartbeatBody,
  PreparedWorkspace,
  ProviderConfig,
  SessionOpts,
  SkillInjectionFacts,
  WorkspaceHookNoteData,
  WorktreeOps,
} from '@cairn/shared';
import {
  classifyStepFailure,
  isBuildStepKind,
  localCommitIdentity,
  PLAN_FILE_NAME,
  stepTakesSecrets,
} from '@cairn/shared';
import { createTempEnvironment } from '@cairn/shared/temp-environment';
import { createActivityTracker } from './activity.js';
import { AgentTodoReporter } from './agent-todo.js';
import { AskChannel } from './ask-channel.js';
import type { DaemonOtel } from './backend/otel.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import { piWorktreeSkillDirs } from './backend/skills.js';
import { assertNoLegacyBrief, composeBrief } from './brief-file.js';
import type { ClaudeCodeAuthProbe } from './claude-code-auth.js';
import { claudeQuotaTrip, forwardClaudeRateLimit } from './claude-quota-trip.js';
import {
  credentialRedactor,
  credentialSafeEvents,
  guardCredentialOutputs,
  prepareCredentialSessionUpload,
} from './credential-output.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { type StepJournal, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { type MachineApi, MachineApiError } from './machine-client.js';
import type { StatePaths } from './state.js';
import { StepAppCredential } from './step-app-credential.js';
import { resolveDeliveredPrompt } from './step-attachments.js';
import { composeDoneBody } from './step-done-body.js';
import { assembleStepEnv } from './step-env.js';
import { reportStepProvenance } from './step-executor-record.js';
import { putFinalArtifacts } from './step-final-upload.js';
import { stepGitRunner } from './step-git-tools.js';
import { runLocalMergeStep } from './step-local-merge.js';
import { assembleStepLocalTools } from './step-local-tools.js';
import { readDeliveredPlan, readInfoReport } from './step-outputs.js';
import {
  consumeStepPassEvent,
  newStepPassState,
  resetStepPassForRetry,
  type StepPassEventContext,
} from './step-pass-events.js';
import { boundedChangesDiff, probeStepPr } from './step-pr-probe.js';
import { agentStepRefusal, probeModelImageSupport } from './step-preflight.js';
import { composeWorkerSystemPrompt, planStepPrompt, taskMetaOpts } from './step-prompt.js';
import { resolveStepProvider } from './step-provider.js';
import { stepQuotaBlock } from './step-quota-block.js';
import { stepRemoteToolExecutor } from './step-remote-tools.js';
import { StepSessionOpener } from './step-session-opener.js';
import { settleStepGit } from './step-settle-git.js';
import { sessionInjectedSkills, stepMcpEndpoints } from './step-skill-tool.js';
import { type RunStop, StepStops, type StopRequest } from './step-stops.js';
import { seedStepTranscript } from './step-transcript-seed.js';
import { StepTranscriptStream } from './step-transcript-stream.js';
import {
  prepareStepWorkspace,
  prepareVerifyClone,
  resetFreshSessionWorkspace,
} from './step-workspace.js';
import {
  resolveStreamLimits,
  STREAM_DURATION_CAP_DEFAULT_MS,
  STREAM_DURATION_CAP_ENV,
  STREAM_FIRST_EVENT_ENV,
  STREAM_IDLE_ENV,
  StreamWatchdog,
} from './stream-watchdog.js';
import { materializeTeamSkills } from './team-skills.js';

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

  const {
    isChief,
    isReview,
    verifyMeta,
    attachmentVerify,
    verifyEvidenceDirectory,
    reviewGate,
    isInfoBuild,
    readonlyWorkspace,
    reportFile,
    prompt,
  } = planStepPrompt(claimed, opts.resume?.prompt, deps.paths);
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
    await runLocalMergeStep(deps, claimed, claimed.localMerge, claimedEntry, {
      stopRequested: () => stop.request !== null,
      now,
      running,
    });
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
  const resolvedProvider = resolveStepProvider(agent?.provider, creds.provider);
  const runtimeId = resolvedProvider.runtimeId;
  let provider = resolvedProvider.provider;
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
  const refusal = await agentStepRefusal({
    stepKind: claimed.step.kind,
    agentTools: agent.tools,
    runtimeId,
    hasSubscriptionToken: creds.claudeSubscriptionToken !== undefined,
    authProbe: deps.claudeCodeAuthProbe,
    machineName: () => deps.machineName ?? hostname(),
    log: (message) => logger.step(message),
  });
  if (refusal !== null) {
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, refusal);
    return;
  }
  const backend = deps.backendFor(agent?.provider, agent.id);
  deps.stepSteeringSupport?.set(stepId, backend.capabilities.steering !== false);
  const modelKey = `${provider?.providerId ?? agent.provider}/${agent.modelId}`;
  logger.raw(`using model ${modelKey}`);

  const imageSupport = isChief
    ? null
    : await probeModelImageSupport(backend, provider, agent.modelId, (message) =>
        logger.step(message),
      );
  deps.stepImageSupport?.set(stepId, imageSupport);
  let deliveryPrompt = prompt;
  let promptImages: DeliveredImage[] | undefined;
  let skippedNoVisionCount = 0;
  if (!isChief && prompt !== null) {
    const resolved = await resolveDeliveredPrompt({
      text: prompt,
      stepId,
      client,
      materializeDir: deps.paths.stepAttachmentsDir,
      log: (line) => logger.step(line),
      imageSupport,
    });
    deliveryPrompt = resolved.text;
    promptImages = resolved.images;
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
  const appIdentity: CommitIdentity | null = tokenRes.commitIdentity ?? null;
  const stepIdentity: CommitIdentity =
    appIdentity ?? localCommitIdentity(claimed.agent?.displayName ?? 'cairn-agent');
  const withStepGit = stepGitRunner({
    credential: creds.git,
    appCredential,
    refresh: refreshGit,
    allowMachineFallback: repo?.kind === 'github',
    log: (line) => logger.step(line),
  });
  const injectedForSession = sessionInjectedSkills(agent);
  const skillsRootDir = deps.skillsDir;
  const localTools = assembleStepLocalTools({
    web: {
      enabled: isPi && !isChief && !isReview && claimed.remoteToolsOnly !== true,
      metered: opts.env?.CAIRN_ORB !== '1',
      creds,
      stepId,
      home: deps.paths.home,
      log: (line) => logger.step(line),
    },
    secrets: stepTakesSecrets(claimed.step.kind)
      ? { stepId, agentId: agent?.id ?? null, onAudit: (line) => logger.step(line) }
      : null,
    createTag: {
      localTools: claimed.localTools,
      repoDir: ws?.cwd ?? null,
      credential: creds.git,
      identity: stepIdentity,
      runGit: withStepGit,
      redact,
    },
    skillLoad:
      isPi && skillsRootDir !== undefined
        ? {
            skillsDir: skillsRootDir,
            home: deps.paths.home,
            cwd,
            isChief,
            skillsAllowlist: agent.skillsAllowlist,
            injectedSkills: injectedForSession,
            teamSkillsDir,
            log: (msg) => logger.skills(msg),
          }
        : null,
  });
  const localToolDefs = localTools.tools;
  if (deliveryPrompt !== null) deliveryPrompt = localTools.dispatch(deliveryPrompt);
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
          executeRemoteTool: stepRemoteToolExecutor({
            client,
            stepId,
            cwd,
            remoteTools,
            askChannel,
            attachFiles: !isChief,
            verifyEvidence: attachmentVerify
              ? { directory: verifyEvidenceDirectory, uploaded: uploadedVerifyEvidence }
              : null,
          }),
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

  const transcript = guardCredentialOutputs(
    new TranscriptBuffer(deps.paths.outboxDir, stepId),
    redact,
  );
  deps.stepTranscripts?.set(stepId, transcript);
  seedStepTranscript(transcript, {
    stepId,
    now,
    modelKey,
    skippedNoVisionCount,
    prompt,
    orbHookNotes: opts.hookNotes ?? [],
    orbStartedAt: opts.orbStartedAt,
    workspaceHooks: ws?.hooks ?? [],
    gitCredentialSource:
      repo !== null && repo.kind === 'github' && ws !== null
        ? (ws.credentialSource ?? 'integration')
        : null,
    redact,
  });

  if (
    ws !== null &&
    deps.workspace &&
    claimed.session.action === 'new' &&
    !isReview &&
    !attachmentVerify &&
    ws.reused &&
    headAtStart !== null
  ) {
    const reason = await resetFreshSessionWorkspace({
      workspace: deps.workspace,
      cwd: ws.cwd,
      headAtStart,
      planFile: join(deps.paths.plansDir, convId, PLAN_FILE_NAME),
    });
    if (reason === null) {
      logger.workspace('返工新会话：工作区回退到分支头');
    } else {
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
    await reportStepProvenance({
      record: () => ({
        catalog:
          deps.skillsDir === undefined
            ? null
            : {
                skillsDir: deps.skillsDir,
                cwd: deps.paths.home,
                ...(sessionOpts.skillsAllowlist !== undefined
                  ? { allowlist: sessionOpts.skillsAllowlist }
                  : {}),
                ...(injectedForSession !== undefined ? { injectedSkills: injectedForSession } : {}),
                ...(teamSkillsDir !== null ? { teamSkillsDir } : {}),
                ...(isPi ? { worktreeSkillsDirs: piWorktreeSkillDirs(cwd) } : {}),
              },
        injectedNames: skillInjection.facts?.injected,
        backend: backend.capabilities.name,
        model: modelKey,
        effort: agent.thinkingLevel,
        systemPrompt,
        tools: [...(remoteTools ?? []), ...localToolDefs],
      }),
      provenance,
      baseSha: headAtStart,
      heartbeat: (body) => client.heartbeat(stepId, body),
      log: (line) => logger.step(line),
    });
  }

  const passState = newStepPassState();
  let priorPassMadeProgress = false;
  const retryStormMax = opts.retryStormMax ?? RETRY_STORM_MAX;
  let networkRetries = 0;
  const networkRetryDelays =
    claimed.step.kind === 'plan' || isBuildStepKind(claimed.step.kind)
      ? PROVIDER_NETWORK_RETRY_DELAYS_MS
      : [0, 5_000];
  const freshPromptPaths = {
    isInfoBuild,
    reportFile,
    plansDir: deps.paths.plansDir,
    convId,
  };
  const opener = new StepSessionOpener({
    backend,
    sessionOpts,
    claimed,
    stepId,
    isChief,
    resume: opts.resume,
    prompt,
    promptImages,
    imageSupport,
    freshPromptPaths,
    modelKey,
    client,
    journal,
    transcript,
    logger,
    stepAttachmentsDir: deps.paths.stepAttachmentsDir,
    now,
    forgetHandle: () => deps.sessionHandles?.delete(stepId),
    rememberImageSupport: (support) => deps.stepImageSupport?.set(stepId, support),
  });
  const retryWithoutImages = (failureText: string): Promise<boolean> =>
    opener.retryWithoutImages(
      failureText,
      passState.sawProgress ||
        priorPassMadeProgress ||
        watchdog.trippedArm !== null ||
        stop.request !== null ||
        passState.quotaTrip !== null,
    );
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
  const stream = new StepTranscriptStream({
    stepId,
    client,
    transcript,
    agentTodo,
    now,
    log: (line) => logger.step(line),
  });
  const segments = stream.segments;
  let handle: AgentSessionHandle | null = null;
  sessionOpts.onClaudeRateLimit = (notice) => {
    forwardClaudeRateLimit(client, claimed.step.machineId, notice, (line) => logger.step(line));
    if (passState.quotaTrip !== null) return;
    const trip = claudeQuotaTrip(notice, Date.now());
    if (trip === null) return;
    passState.quotaTrip = trip;
    void handle?.stop();
  };
  for (let pass = 0; ; pass++) {
    if (pass > 0) {
      priorPassMadeProgress ||= passState.sawProgress;
      resetStepPassForRetry(passState);
      watchdog.clearTrip();
      stream.discardDeltas();
    }
    if (stop.request !== null) break;
    activity.setPhase('starting', pass > 0 ? { resetLive: true } : undefined);
    try {
      handle = await opener.open();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (await retryWithoutImages(message)) continue;
      stream.flushDeltas();
      clearCredentials(creds);
      await failStep(deps, heartbeat, stepId, message);
      return;
    }
    logger.raw(opener.continueId !== null ? `continue session ${convId}` : `new session ${convId}`);
    if (!isChief && opener.imageSupport === null) {
      try {
        opener.setImageSupport(
          (await backend.modelSupportsImages?.(sessionOpts.provider, sessionOpts.modelId)) ?? null,
        );
      } catch (err) {
        logger.step(
          `session image support probe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    journal.update(stepId, { state: 'running', sessionId: handle.sessionId });
    const passEvents: StepPassEventContext = {
      stepId,
      client,
      logger,
      modelKey,
      provider,
      handle,
      promptImages: opener.promptImages,
      retryStormMax,
      now,
      watchdog,
      activity,
      stream,
      transcript,
      agentTodo,
      toolStartedAt,
    };
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
        await consumeStepPassEvent(ev, passEvents, passState);
        if (classifyStepFailure(passState.lastModelError ?? '') === 'model_unavailable') break;
      }
    } catch (err) {
      passState.lastError = err instanceof Error ? err.message : String(err);
    }
    stop.detach();
    if (classifyStepFailure(passState.lastModelError ?? '') === 'model_unavailable')
      passState.lastError = passState.lastModelError;
    {
      const failureText = passState.lastModelError ?? passState.lastError;
      const stopPending = stop.request !== null;
      if (
        failureText !== null &&
        passState.lastError !== null &&
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
        opener.continueId = handle.sessionId;
        deps.sessionHandles?.delete(stepId);
        continue;
      }
    }
    if (
      classifyStepFailure(passState.lastModelError ?? passState.lastError ?? '') ===
      'model_unavailable'
    )
      break;
    if (pass === 0 && !passState.sawProgress && passState.quotaTrip === null) {
      const failureText = passState.lastModelError ?? passState.lastError;
      if (
        failureText !== null &&
        (passState.lastError !== null ||
          (watchdog.trippedArm !== null && passState.lastModelError !== null) ||
          (passState.retryStorm && passState.lastModelError !== null))
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
    const imageFailure = passState.lastModelError ?? passState.lastError;
    if (imageFailure !== null && (await retryWithoutImages(imageFailure))) continue;
    break;
  }
  const continueId = opener.continueId;
  let { usage, lastError } = passState;
  const {
    lastModelError,
    lastErrorWasProcessCrash,
    sawChangeTool,
    sawDone,
    sawProgress,
    retryStorm,
    quotaTrip,
  } = passState;
  deps.sessionHandles?.delete(stepId);
  await segments.seal();
  stream.flushDeltas();
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
  const quotaBlock = stepQuotaBlock({
    provider,
    quotaTrip,
    stopped,
    processCrash: lastErrorWasProcessCrash,
    failureText: lastModelError ?? lastError,
  });
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

  const settledGit = await settleStepGit({
    git: deps.workspace,
    ws,
    claimed,
    stepId,
    coAuthor: tokenRes.coAuthor ?? null,
    appIdentity,
    identity: stepIdentity,
    mergeCredential: creds.git,
    headAtStart,
    stepStartMs,
    runGit: withStepGit,
    headCommit: attachmentVerify ? headAtStart : null,
    hasChanges: isReview || attachmentVerify || readonlyWorkspace ? false : sawChangeTool,
    lastError,
    stopped,
    closes: lastError === null && !stopped && !isReview && !attachmentVerify,
    note: (id, content) => transcript.upsert({ id, role: 'system', content, createdAt: now() }),
    log: (message) => logger.step(message),
    logRaw: (message) => logger.raw(message),
  });
  lastError = settledGit.lastError;
  const {
    headCommit,
    branchDrift,
    artifactBranches,
    hasChanges,
    pushHookOutput,
    preservedCommits,
  } = settledGit;

  let report: string | null = null;
  if (isInfoBuild && !stopped && lastError === null) {
    const read = readInfoReport(reportFile);
    if (read.kind === 'too-large') lastError = read.error;
    else if (read.kind === 'report') report = read.content;
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
    planContent = readDeliveredPlan(deps.paths.plansDir, convId, cwd);
  }
  const sessionIdForDone = handle?.sessionId ?? continueId;
  const doneBody = composeDoneBody(
    {
      status,
      lastError,
      sessionId: sessionIdForDone,
      usage,
      hasChanges,
      headCommit,
      preservedCommits,
      pushHookOutput,
      prProbe,
      changesDiff,
      branchDrift,
      quotaBlock,
      skillInjectionFacts: skillInjection.facts,
      report,
    },
    {
      kind: claimed.step.kind,
      messages,
      attachmentVerify,
      uploadedEvidence: uploadedVerifyEvidence,
      cwd,
    },
  );
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
