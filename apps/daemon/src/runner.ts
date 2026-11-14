import { mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  CommitIdentity,
  MachineHeartbeatBody,
  SkillInjectionFacts,
  WorkspaceHookNoteData,
  WorktreeOps,
} from '@cairn/shared';
import { isBuildStepKind, PLAN_FILE_NAME } from '@cairn/shared';
import { createActivityTracker } from './activity.js';
import { AgentTodoReporter } from './agent-todo.js';
import { AskChannel } from './ask-channel.js';
import type { DaemonOtel } from './backend/otel.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import { piWorktreeSkillDirs } from './backend/skills.js';
import { composeSessionBrief } from './brief-file.js';
import type { ClaudeCodeAuthProbe } from './claude-code-auth.js';
import { credentialRedactor, guardCredentialOutputs } from './credential-output.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { type StepJournal, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { type MachineApi, MachineApiError } from './machine-client.js';
import type { StatePaths } from './state.js';
import { StepAppCredential } from './step-app-credential.js';
import { prepareStepEnv } from './step-env.js';
import { reportStepProvenance } from './step-executor-record.js';
import { finishStepRun } from './step-finish.js';
import { runLocalMergeStep } from './step-local-merge.js';
import { createStepPassControls } from './step-pass-controls.js';
import { newStepPassState } from './step-pass-events.js';
import { runStepPasses } from './step-pass-loop.js';
import { agentStepRefusal, prepareStepPromptDelivery } from './step-preflight.js';
import { composeWorkerSystemPrompt, planStepPrompt, taskMetaOpts } from './step-prompt.js';
import { resolveStepProvider } from './step-provider.js';
import { StepSessionOpener } from './step-session-opener.js';
import { composeStepSessionOpts } from './step-session-opts.js';
import { stepMcpEndpoints } from './step-skill-tool.js';
import { type RunStop, StepStops, type StopRequest } from './step-stops.js';
import { prepareStepTooling } from './step-tooling.js';
import { seedStepTranscript } from './step-transcript-seed.js';
import { resetReusedWorkspaceForFreshSession, setUpStepWorkspace } from './step-workspace.js';
import {
  STREAM_DURATION_CAP_DEFAULT_MS,
  STREAM_DURATION_CAP_ENV,
  STREAM_FIRST_EVENT_ENV,
  STREAM_IDLE_ENV,
} from './stream-watchdog.js';

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

export {
  RETRY_STORM_MAX,
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

  const delivery = await prepareStepPromptDelivery({
    backend,
    provider,
    modelId: agent.modelId,
    modelKey,
    isChief,
    prompt,
    stepId,
    client,
    materializeDir: deps.paths.stepAttachmentsDir,
    rememberImageSupport: (support) => deps.stepImageSupport?.set(stepId, support),
    log: (line) => logger.step(line),
  });
  const { imageSupport, promptImages, skippedNoVisionCount } = delivery;
  let { deliveryPrompt } = delivery;

  logger.workspace('准备工作区...');
  const checkout = isReview && reviewGate === 'review';
  const repo = isChief || (isReview && !checkout) ? null : (claimed.project?.repo ?? null);
  const setup = await setUpStepWorkspace({
    workspace: deps.workspace,
    claimed,
    repo,
    workspacesRoot: deps.workspacesDir,
    credentials: creds.git,
    readonly: readonlyWorkspace,
    refresh: refreshGit,
    machineName: deps.machineName ?? hostname(),
    attachmentVerify,
    evidenceDirectory: verifyEvidenceDirectory,
    expectedHeadSha: verifyMeta?.expectedHeadSha,
    cleanups: stepCleanups,
  });
  if ('error' in setup) {
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, setup.error);
    return;
  }
  const { ws, cwd, headAtStart, stepStartMs } = setup;
  const uploadedVerifyEvidence = new Set<string>();

  const systemPrompt =
    isChief && claimed.chief
      ? claimed.chief.systemPrompt
      : composeWorkerSystemPrompt(agent.description, agent.memories, {
          ...taskMetaOpts(claimed),
          attachments: true,
          decisionBoundary: claimed.step.kind === 'plan' || isBuildStepKind(claimed.step.kind),
          ...(claimed.project !== undefined ? { project: claimed.project } : {}),
        });
  const remoteTools = claimed.remoteTools;
  const claimedMcp = claimed.mcpServers;
  const mcpEndpoints = stepMcpEndpoints(deps.mcpConfigPath, claimedMcp, (line) => logger.mcp(line));
  const isPi = backend.brief?.backendId === 'pi';
  const appIdentity: CommitIdentity | null = tokenRes.commitIdentity ?? null;
  const tooling = await prepareStepTooling({
    client,
    claimed,
    agent,
    stepId,
    teamSkillsCacheDir: deps.paths.teamSkillsCacheDir,
    skillsDir: deps.skillsDir,
    home: deps.paths.home,
    isPi,
    isChief,
    isReview,
    metered: opts.env?.CAIRN_ORB !== '1',
    creds,
    appCredential,
    refreshGit,
    commitIdentity: appIdentity,
    repo,
    ws,
    cwd,
    redact,
    logger,
  });
  if ('error' in tooling) {
    await failStep(deps, heartbeat, stepId, tooling.error);
    return;
  }
  const {
    teamSkillsDir,
    stepIdentity,
    withStepGit,
    injectedSkills: injectedForSession,
    localTools,
  } = tooling;
  const localToolDefs = localTools.tools;
  if (deliveryPrompt !== null) deliveryPrompt = localTools.dispatch(deliveryPrompt);
  const askChannel = new AskChannel({ client, stepId, log: (message) => logger.step(message) });
  const telemetry =
    deps.otel != null
      ? deps.otel.contextFor(claimed.step.buildId, stepId, claimed.step.kind)
      : undefined;
  const skillInjection: { facts: SkillInjectionFacts | null } = { facts: null };
  const stepEnv = prepareStepEnv(
    {
      inherited: opts.env,
      git: repo?.kind === 'github' ? creds.git : null,
      appCredential,
      readonlyGit: readonlyWorkspace || attachmentVerify,
      claudeSubscriptionToken:
        runtimeId === 'claude-code' ? creds.claudeSubscriptionToken : undefined,
    },
    stepCleanups,
  );
  if ('error' in stepEnv) {
    await failStep(deps, heartbeat, stepId, stepEnv.error);
    return;
  }
  const sessionOpts = composeStepSessionOpts({
    provider,
    modelId: agent.modelId,
    thinkingLevel: agent.thinkingLevel,
    systemPrompt,
    cwd,
    prompt: deliveryPrompt,
    promptImages,
    localTools: localToolDefs,
    remoteTools,
    remoteExecutor: {
      client,
      stepId,
      askChannel,
      attachFiles: !isChief,
      verifyEvidence: attachmentVerify
        ? { directory: verifyEvidenceDirectory, uploaded: uploadedVerifyEvidence }
        : null,
    },
    mcpServers: claimedMcp !== undefined ? mcpEndpoints : null,
    skillsAllowlist: agent.skillsAllowlist,
    injectedSkills: injectedForSession,
    onSkillsResolved: (names) => {
      skillInjection.facts = names;
    },
    teamSkillsDir,
    isChief,
    isReview,
    remoteToolsOnly: claimed.remoteToolsOnly === true,
    telemetry,
    env: stepEnv.env,
  });

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

  await resetReusedWorkspaceForFreshSession({
    workspace: deps.workspace,
    ws,
    claimed,
    headAtStart,
    skip: isReview || attachmentVerify,
    planFile: join(deps.paths.plansDir, convId, PLAN_FILE_NAME),
    stepId,
    transcript,
    now,
    log: { workspace: (line) => logger.workspace(line), step: (line) => logger.step(line) },
  });

  const briefError = composeSessionBrief({
    cwd,
    brief: backend.brief,
    sessionOpts,
    systemPrompt,
  });
  if (briefError !== null) {
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, briefError);
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
  const retryStormMax = opts.retryStormMax ?? RETRY_STORM_MAX;
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
  const { watchdog, stream, session, toolStartedAt } = createStepPassControls({
    stepKind: claimed.step.kind,
    machineId: claimed.step.machineId,
    streamTimeouts: opts.streamTimeouts,
    streamDurationCapMs: opts.streamDurationCapMs,
    askChannel,
    sessionOpts,
    passState,
    stepId,
    client,
    transcript,
    agentTodo,
    now,
    log: (line) => logger.step(line),
  });
  const passes = await runStepPasses({
    stepId,
    client,
    logger,
    modelKey,
    retryStormMax,
    now,
    watchdog,
    activity,
    stream,
    transcript,
    agentTodo,
    toolStartedAt,
    claimed,
    convId,
    isChief,
    backend,
    sessionOpts,
    provider,
    opener,
    passState,
    session,
    stop,
    askChannel,
    journal,
    credentialValues: () => credentialValues,
    sessionHandles: deps.sessionHandles,
    networkRetryDelays,
  });
  provider = passes.provider;
  if (passes.openError !== null) {
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, passes.openError);
    return;
  }
  await finishStepRun({
    client,
    journal,
    logger,
    workspace: deps.workspace,
    outboxDir: deps.paths.outboxDir,
    plansDir: deps.paths.plansDir,
    stepId,
    claimed,
    convId,
    cwd,
    ws,
    repo,
    creds,
    credentialValues,
    refreshGitToken: appCredential !== null ? async () => (await refreshGit()).password : null,
    transcript,
    isReview,
    attachmentVerify,
    infoReportFile: isInfoBuild ? reportFile : null,
    skillInjectionFacts: skillInjection.facts,
    uploadedEvidence: uploadedVerifyEvidence,
    running,
    passState,
    handle: session.current,
    continueId: opener.continueId,
    provider,
    stream,
    watchdog,
    askChannel,
    stop,
    forgetHandle: () => deps.sessionHandles?.delete(stepId),
    stopHeartbeat: () => {
      if (opts.env?.CAIRN_ORB !== '1') clearInterval(heartbeat);
    },
    headAtStart,
    stepStartMs,
    reviewCheckout: checkout,
    readonlyWorkspace,
    coAuthor: tokenRes.coAuthor ?? null,
    appIdentity,
    identity: stepIdentity,
    runGit: withStepGit,
    now,
  });
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
