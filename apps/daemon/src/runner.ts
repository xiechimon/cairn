import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  CommitIdentity,
  MachineHeartbeatBody,
  SkillInjectionFacts,
  WorktreeOps,
} from '@cairn/shared';
import {
  isBuildStepKind,
  mcpConnectorSecretValues,
  PLAN_FILE_NAME,
  type StepFailureCode,
  type StepFailureDetail,
} from '@cairn/shared';
import { AskChannel } from './ask-channel.js';
import { stepFailureOf } from './backend/errors.js';
import type { DaemonOtel } from './backend/otel.js';
import { RETRY_STORM_MAX } from './backend/pi-retry.js';
import { createDaemonSubagentExecutor } from './backend/subagent.js';
import { composeSessionBrief } from './brief-file.js';
import {
  CredentialRegistry,
  credentialSecretValues,
  guardCredentialOutputs,
} from './credential-output.js';
import { clearCredentials, pushCredential } from './credentials.js';
import { commitEnv } from './git.js';
import { type StepJournal, TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { bindMachineClaim, type MachineApi, MachineApiError } from './machine-client.js';
import { STEP_TREE_ENV, StepReaper } from './process-tree.js';
import type { StatePaths } from './state.js';
import { GitHubAppTokenUnavailableError } from './step-app-credential.js';
import { prepareStepEnv, READONLY_GIT_ENV } from './step-env.js';
import { reportStepProvenance, stepSkillsCatalog } from './step-executor-record.js';
import { finishStepRun } from './step-finish.js';
import { runLocalFolderActionStep } from './step-local-folder-action.js';
import { runLocalMergeStep } from './step-local-merge.js';
import { createStepPassControls } from './step-pass-controls.js';
import { newStepPassState } from './step-pass-events.js';
import { runStepPasses } from './step-pass-loop.js';
import { agentStepRefusal, prepareStepPromptDelivery } from './step-preflight.js';
import {
  composeWorkerSystemPrompt,
  isCodingTaskStep,
  planStepPrompt,
  prependFailedSetupHookContext,
  taskMetaOpts,
} from './step-prompt.js';
import { resolveStepProvider } from './step-provider.js';
import { createStepReporters } from './step-reporters.js';
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
  backendFor: (agentProviderId: string | null | undefined) => AgentBackend;
  devinHome?: () => string | undefined;
  antigravityAuth?: () => boolean;
  logger: DaemonLogger;
  paths: StatePaths;
  workspacesDir: string;
  mcpConfigPath: string;
  workspace?: WorktreeOps;
  sessionHandles?: Map<string, AgentSessionHandle>;
  settleSteers?: (stepId: string) => Promise<void>;
  stepImageSupport?: Map<string, boolean | null>;
  stepSteeringSupport?: Map<string, boolean>;
  stepTranscripts?: Map<string, TranscriptBuffer>;
  stepTreeMarkers?: Map<string, string>;
  stops?: StepStops;
  heartbeatIntervalMs?: number;
  skillsDir?: string;
  machineName?: string;
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
}

export const PROVIDER_NETWORK_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;
const STEP_REAP_GRACE_MS = 3_000;
const MIN_SECRET_REDACT_LENGTH = 8;

function extractPairSecretValues(value: string): string[] {
  if (!value.startsWith('{')) return [value];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'username' in parsed &&
      'password' in parsed &&
      typeof parsed.username === 'string' &&
      typeof parsed.password === 'string'
    ) {
      return [value, parsed.password];
    }
  } catch {}
  return [value];
}

function redactionVariants(value: string | undefined, minLength = 1): string[] {
  if (!value || value.length < minLength) return [];
  const escaped = JSON.stringify(value).slice(1, -1);
  return escaped === value ? [value] : [escaped, value];
}

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
  const claimClient = bindMachineClaim(deps.client, stepId, claimed.step.generation);
  let reported = false;
  deps = {
    ...deps,
    client: new Proxy(claimClient, {
      get(target, key) {
        if (key === 'done')
          return async (...args: Parameters<MachineApi['done']>) => {
            await target.done(...args);
            reported = true;
          };
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === 'function' ? member.bind(target) : member;
      },
    }),
  };
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
      if (
        !(err instanceof MachineApiError) ||
        (err.status !== 410 && err.status !== 404 && err.status !== 409) ||
        stop.request !== null
      )
        return;
      deps.logger.step(`step ${stepId} no longer exists or is no longer ours — stopping`);
      stop.deliver({ discard: false }).catch((stopErr: unknown) => {
        deps.logger.step(
          `stop after heartbeat ${err.status} failed: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`,
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
    if (reported || !(await reportCrash(deps, claimed, error))) errors.push(error);
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

  const treeMarker = `${stepId}.${randomUUID()}`;
  const treeEnv: Record<string, string> = { ...opts.env, [STEP_TREE_ENV]: treeMarker };
  const reaper = new StepReaper({ env: STEP_TREE_ENV, value: treeMarker }, STEP_REAP_GRACE_MS);
  deps.stepTreeMarkers?.set(stepId, treeMarker);
  let reaped = false;
  const reapTree = async () => {
    reaped = true;
    try {
      await reaper.reap();
    } catch (error) {
      logger.step(
        `step tree reap failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  stepCleanups.push(async () => {
    if (!reaped) await reapTree();
  });
  stepCleanups.push(() => {
    deps.stepTreeMarkers?.delete(stepId);
  });

  const { activity, agentTodo } = createStepReporters({
    stepId,
    client: () => client,
    log: (line) => logger.step(line),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  const {
    isChief,
    isReview,
    verifyMeta,
    attachmentVerify,
    verifyEvidenceDirectory,
    reviewGate,
    prompt,
  } = planStepPrompt(claimed, opts.resume?.prompt, deps.paths);
  if (claimed.step.kind === 'plan') {
    mkdirSync(join(deps.paths.plansDir, convId), { recursive: true });
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
    treeMarker,
  });

  if (claimed.localMerge !== undefined) {
    await runLocalMergeStep(deps, claimed, claimed.localMerge, claimedEntry, {
      stopRequested: () => stop.request !== null,
      now,
      running,
    });
    return;
  }

  if (claimed.localFolderAction !== undefined) {
    await runLocalFolderActionStep(deps, claimed, claimed.localFolderAction, claimedEntry, {
      stopRequested: () => stop.request !== null,
      now,
      running,
    });
    return;
  }

  const fetchStepToken = async (refresh = false) => {
    try {
      return await client.token(stepId, claimed.step.generation, refresh ? { refresh } : undefined);
    } catch (error) {
      if (error instanceof MachineApiError && error.status === 503)
        throw new GitHubAppTokenUnavailableError(error.body);
      throw error;
    }
  };
  const tokenRes = await fetchStepToken().catch(async (error: unknown) => {
    if (!(error instanceof GitHubAppTokenUnavailableError)) throw error;
    await failStep(deps, heartbeat, stepId, error.message);
    return null;
  });
  if (tokenRes === null) return;
  const creds = pushCredential(tokenRes, claimed.project?.repo?.cloneUrl ?? null);
  stepCleanups.push(() => clearCredentials(creds));
  const gitExpiresAt =
    creds.git?.expiresAt ?? (creds.git?.kind === 'app' ? now() + 60 * 60_000 : Infinity);
  const stepSecretEntries: { value: string; expiresAt: number }[] = [
    ...[
      creds.claudeSubscriptionToken,
      creds.devinToken,
      ...credentialSecretValues(creds.antigravityToken),
    ].flatMap((value) =>
      redactionVariants(value).map((variant) => ({ value: variant, expiresAt: Infinity })),
    ),
    ...[
      creds.provider?.apiKey,
      ...Object.values(tokenRes.secrets ?? {}).flatMap(extractPairSecretValues),
      ...(tokenRes.httpSecrets ?? []).map((grant) => grant.value),
    ].flatMap((value) =>
      redactionVariants(value, MIN_SECRET_REDACT_LENGTH).map((variant) => ({
        value: variant,
        expiresAt: Infinity,
      })),
    ),
    ...(tokenRes.mcpConnectors ?? [])
      .flatMap((c) => mcpConnectorSecretValues(c.headers))
      .map((value) => ({ value, expiresAt: Infinity })),
    ...redactionVariants(creds.git?.password).map((value) => ({
      value,
      expiresAt: gitExpiresAt,
    })),
  ].sort((a, b) => b.value.length - a.value.length);
  const credentials = new CredentialRegistry(now, Math.max(128, stepSecretEntries.length + 16));
  stepCleanups.push(() => credentials.dispose());
  for (const entry of stepSecretEntries) credentials.remember(entry.value, entry.expiresAt);
  const redact = <T>(value: T): T => credentials.redact(value);
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
      reapTree,
    );
    return;
  }
  const refusal = agentStepRefusal({
    stepKind: claimed.step.kind,
    agentTools: agent.tools,
    runtimeId,
    hasSubscriptionToken: creds.claudeSubscriptionToken !== undefined,
    hasDevinToken: creds.devinToken !== undefined,
    hasAntigravityToken: creds.antigravityToken !== undefined,
    hasAntigravityHostAuth: deps.antigravityAuth?.() === true,
  });
  if (refusal !== null) {
    clearCredentials(creds);
    await failStep(deps, heartbeat, stepId, refusal, reapTree);
    return;
  }
  const backend = deps.backendFor(agent?.provider);
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
  const hostedGitCred = repo?.kind === 'hosted' ? creds.git : null;
  const setup = await setUpStepWorkspace({
    workspace: deps.workspace,
    claimed,
    repo,
    workspacesRoot: deps.workspacesDir,
    credentials: hostedGitCred,
    hookCredentials: attachmentVerify ? null : hostedGitCred,
    refresh: async () => {
      throw new Error('App credential refresh unavailable');
    },
    machineName: deps.machineName ?? hostname(),
    attachmentVerify,
    evidenceDirectory: verifyEvidenceDirectory,
    expectedHeadSha: verifyMeta?.expectedHeadSha,
    signal: stop.signal,
    env: attachmentVerify ? { ...treeEnv, ...READONLY_GIT_ENV } : treeEnv,
    cleanups: stepCleanups,
  });
  if ('error' in setup) {
    clearCredentials(creds);
    if (stop.request !== null) {
      deps.sessionHandles?.delete(stepId);
      deps.logger.step('stopped while waiting for workspace');
      await reapTree();
      try {
        await deps.client.done(stepId, {
          status: 'stopped',
          generation: claimed.step.generation,
        });
        deps.journal.remove(stepId);
      } catch (err) {
        deps.logger.step(
          `done(stopped) report unreachable: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearInterval(heartbeat);
      }
      return;
    }
    await failStep(deps, heartbeat, stepId, setup.error, reapTree);
    return;
  }
  const { ws, cwd, headAtStart, stepStartMs } = setup;
  if (deliveryPrompt !== null && ws?.hooks && ws.hooks.length > 0) {
    deliveryPrompt = prependFailedSetupHookContext(deliveryPrompt, ws.hooks, redact);
  }
  const uploadedVerifyEvidence = new Set<string>();

  const systemPrompt =
    isChief && claimed.chief
      ? claimed.chief.systemPrompt
      : composeWorkerSystemPrompt(agent.description, agent.memories, {
          ...taskMetaOpts(claimed),
          codingTask: isCodingTaskStep(claimed),
          attachments:
            claimed.remoteTools === undefined ||
            claimed.remoteTools.some((tool) => tool.name === 'attach_file'),
          ...(claimed.project !== undefined ? { project: claimed.project } : {}),
        });
  const remoteTools = claimed.remoteTools;
  const claimedMcp = claimed.mcpServers;
  const mcpEndpoints = stepMcpEndpoints(
    deps.mcpConfigPath,
    claimedMcp,
    (line) => logger.mcp(line),
    {
      connectors: tokenRes.mcpConnectors,
      withheld: tokenRes.withheldMcp,
    },
  );
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
    metered: true,
    creds,
    gitCredential: hostedGitCred,
    commitIdentity: appIdentity,
    repo,
    ws,
    cwd,
    redact,
    logger,
  });
  if ('error' in tooling) {
    await failStep(deps, heartbeat, stepId, tooling.error, reapTree);
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
      inherited: repo?.kind === 'hosted' ? { ...treeEnv, ...commitEnv(stepIdentity) } : treeEnv,
      git: attachmentVerify ? null : hostedGitCred,
      readonlyGit: attachmentVerify,
      runtimeId,
      agentConfig: { cairnHome: deps.paths.home },
      claudeSubscriptionToken:
        runtimeId === 'claude-code' ? creds.claudeSubscriptionToken : undefined,
      claudeCodeCoordinator: isChief && runtimeId === 'claude-code',
      devinToken: runtimeId === 'devin' ? creds.devinToken : undefined,
      devinHome: runtimeId === 'devin' ? deps.devinHome?.() : undefined,
      antigravityToken: runtimeId === 'antigravity' ? creds.antigravityToken : undefined,
    },
    stepCleanups,
  );
  if ('error' in stepEnv) {
    await failStep(deps, heartbeat, stepId, stepEnv.error, reapTree);
    return;
  }
  const subagentAbort = new AbortController();
  stepCleanups.push(() => subagentAbort.abort());
  let resolvedSessionOpts: ReturnType<typeof composeStepSessionOpts> | null = null;
  let daemonSubagent: ((params: Record<string, unknown>) => Promise<string>) | null = null;
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
      ...(isChief
        ? {
            executeSubagent: (params) => {
              if (daemonSubagent === null) {
                daemonSubagent = createDaemonSubagentExecutor({
                  backend,
                  parentSessionOpts: resolvedSessionOpts as ReturnType<
                    typeof composeStepSessionOpts
                  >,
                  parentSignal: subagentAbort.signal,
                  untrustedTurn: claimed.remoteToolsOnly === true,
                  scrubError: redact,
                });
              }
              return daemonSubagent(params);
            },
          }
        : {}),
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
    secrets: () => credentials.values(),
  });
  resolvedSessionOpts = sessionOpts;

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
    await failStep(deps, heartbeat, stepId, briefError, reapTree);
    return;
  }

  if (!isChief) {
    await reportStepProvenance({
      record: () => ({
        catalog: stepSkillsCatalog({
          skillsDir: deps.skillsDir,
          home: deps.paths.home,
          allowlist: sessionOpts.skillsAllowlist,
          injectedSkills: injectedForSession,
          teamSkillsDir,
          piWorktree: isPi ? cwd : null,
        }),
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
    credentialValues: () => credentials.values(),
    sessionHandles: deps.sessionHandles,
    networkRetryDelays,
  });
  provider = passes.provider;
  deps.sessionHandles?.delete(stepId);
  await deps.settleSteers?.(stepId);
  if (passes.openError !== null) {
    clearCredentials(creds);
    await failStep(
      deps,
      heartbeat,
      stepId,
      passes.openError,
      reapTree,
      passes.openFailureCode !== null
        ? {
            failureCode: passes.openFailureCode,
            ...(passes.openFailureDetail !== null
              ? { failureDetail: passes.openFailureDetail }
              : {}),
          }
        : undefined,
    );
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
    credentialValues: credentials.values(),
    refreshGitToken: null,
    transcript,
    isReview,
    attachmentVerify,
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
      clearInterval(heartbeat);
    },
    headAtStart,
    stepStartMs,
    reviewCheckout: checkout,
    appIdentity,
    identity: stepIdentity,
    runGit: withStepGit,
    env: treeEnv,
    now,
    reap: reapTree,
  });
}

async function reportCrash(
  deps: RunStepDeps,
  claimed: ClaimedStep,
  error: unknown,
): Promise<boolean> {
  const stepId = claimed.step.id;
  const message = error instanceof Error ? error.message : String(error);
  const structured = stepFailureOf(error);
  deps.logger.step(`crashed after claim, reporting failure: ${message}`);
  try {
    await deps.client.done(stepId, {
      status: 'failed',
      errorMessage: `Runner error: ${message}`,
      ...(structured !== null ? structured : {}),
      generation: claimed.step.generation,
    });
    deps.journal.remove(stepId);
    return true;
  } catch (reportError) {
    deps.logger.step(
      `done(failed) after crash unreachable: ${reportError instanceof Error ? reportError.message : String(reportError)}`,
    );
    return false;
  }
}

async function failStep(
  deps: RunStepDeps,
  heartbeat: ReturnType<typeof setInterval>,
  stepId: string,
  message: string,
  reap?: () => Promise<void>,
  failure?: { failureCode: StepFailureCode; failureDetail?: StepFailureDetail },
): Promise<void> {
  deps.sessionHandles?.delete(stepId);
  deps.logger.step(`failed: ${message}`);
  await reap?.();
  try {
    await deps.client.done(stepId, {
      status: 'failed',
      errorMessage: message,
      ...(failure !== undefined ? failure : {}),
      generation: deps.journal.get(stepId)?.claimed?.step.generation,
    });
    deps.journal.remove(stepId);
  } catch (err) {
    deps.logger.step(
      `done(failed) report unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}
