import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  DeliveredImage,
  MachineCapabilities,
} from '@cairn/shared';
import {
  appendAnswers,
  CLAIM_BACKOFF_CAP_MS,
  CLAIM_POLL_INTERVAL_MS,
  type ClaudeLogin,
  classifyClaudeCodeLogin,
  ENV_VARS,
  isBackendRuntimeId,
  MACHINE_ORB_CONVERSATIONS_LIMIT,
  ORPHAN_WORKTREE_TTL_MS,
} from '@cairn/shared';
import { AgentReachProbe } from './agent-reach.js';
import { configuredAcpBackends, createGeminiBackend } from './backend/acp.js';
import { createClaudeCodeBackend } from './backend/claude-code.js';
import { readCodexLogin } from './backend/codex-login.js';
import { ConfinementAvailability } from './backend/confinement-availability.js';
import { type DaemonOtel, daemonOtelFromEnv } from './backend/otel.js';
import { createPiBackend, piSessionPolicyLine } from './backend/pi.js';
import { backfillRepositoryCaches } from './backend/repo-cache-backfill.js';
import {
  type ClaudeCodeAuthProbe,
  probeClaudeCodeAuth,
  readDefaultClaudeOauthExpiresAt,
} from './claude-code-auth.js';
import { type ClaudeBinInfo, probeClaudeBin } from './claude-code-bin.js';
import { readClaudeCodeReport } from './claude-code-models.js';
import { createComputerDispatcher } from './computer/dispatch.js';
import { HostComputerProvider } from './computer/host.js';
import { createHostScreenFromEnv, type HostScreen } from './computer/host-screen.js';
import { ComputerInputFence } from './computer/input-fence.js';
import { OrbComputerProvider } from './computer/orb.js';
import { ComputerPresenceReporter, type ComputerPresenceSource } from './computer/presence.js';
import type { ComputerProvider, ScopedComputerProviders } from './computer/provider.js';
import { OutboundComputerScreens } from './computer/screen-channel.js';
import { createComputerScreenProvider } from './computer/screen-provider.js';
import type { DaemonConfig } from './config.js';
import { StepJournal, type TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { createMachineCapabilitiesProbe } from './machine-capabilities.js';
import { type MachineApi, MachineApiError, MachineClient } from './machine-client.js';
import { enrollThroughBrowser } from './machine-enroll.js';
import { ComputerOrbs, computerImageOffersBrowser } from './orb/computer.js';
import { OrbLifecycle, resolveOrbCap } from './orb/lifecycle.js';
import type { OrbProvider } from './orb/provider.js';
import { createComputerOrbProvider, createOrbProvider } from './orb/select.js';
import { relayOrbStopped, runOrbStep } from './orb/step.js';
import { ensurePrivateDir } from './private-fs.js';
import { setupProxy } from './proxy.js';
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
import { resumePendingUpload } from './step-final-upload.js';
import { StepStops } from './step-stops.js';
import { performSync } from './sync.js';
import { DAEMON_VERSION } from './version.js';
import { WorkspaceManager } from './workspace.js';

export interface MachineLoopOpts {
  config: DaemonConfig;
  paths: StatePaths;
  logger: DaemonLogger;
  backend?: AgentBackend;
  claudeCodeBackend?: AgentBackend;
  geminiBackend?: AgentBackend;
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  readClaudeOauthExpiresAt?: () => number | null;
  capabilitiesProbe?: () => MachineCapabilities;
  fetchImpl?: typeof fetch;
  client?: MachineApi;
  claimTimeoutMs?: number;
  presenceIntervalMs?: number;
  presenceTimeoutMs?: number;
  computerPresence?: ComputerPresenceSource;
  claimBackoffBaseMs?: number;
  proxyEnv?: NodeJS.ProcessEnv;
  capEnv?: NodeJS.ProcessEnv;
  orbProvider?: OrbProvider;
  hostComputer?: ComputerProvider;
  hostScreen?: HostScreen;
  orbComputer?: ScopedComputerProviders;
  heartbeatIntervalMs?: number;
  idleSleepPrevention?: boolean;
  orphanTtlMs?: number;
  hookTimeoutMs?: number;
  otel?: DaemonOtel | null;
  confinementPlatform?: string;
  confinementPreflight?: ConstructorParameters<typeof ConfinementAvailability>[0]['launch'];
}

export interface MachineHandle {
  machineId: string;
  stop(cause?: string): Promise<void>;
  done: Promise<void>;
  recheckConfinement(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nextBackoffMs(current: number, cap = CLAIM_BACKOFF_CAP_MS): number {
  return Math.min(current * 2, cap);
}

export const PRESENCE_TIMEOUT_MS = 20_000;
export const DISPATCHER_RESET_FAILURE_THRESHOLD = 3;

export const DAEMON_MAX_CONCURRENT_ENV = 'CAIRN_DAEMON_MAX_CONCURRENT';

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

export const PORT_BASE_ENV = 'CAIRN_PORT_BASE';

export const PORT_BASE_FLOOR = 20_000;
export const PORT_BASE_STRIDE = 100;

export function portBaseForSlot(slot: number): number {
  return PORT_BASE_FLOOR + (slot - 1) * PORT_BASE_STRIDE;
}

export async function runMachine(opts: MachineLoopOpts): Promise<MachineHandle> {
  const { config, paths, logger } = opts;
  const acpBackends = configuredAcpBackends(process.env.CAIRN_ACP_AGENTS);
  ensureStateDirs(paths);
  loadOrCreateDeviceJson(paths);
  const proxyHandle = setupProxy(logger, opts.proxyEnv ?? process.env, config.serverUrl);

  let daemonOtel: DaemonOtel | null = opts.otel ?? null;
  if (opts.otel === undefined) {
    try {
      daemonOtel = daemonOtelFromEnv(process.env);
    } catch (error) {
      logger.machine(
        `otel config ignored: ${error instanceof Error ? error.message : String(error)}`,
      );
      daemonOtel = null;
    }
  }

  let backend: AgentBackend | undefined = opts.backend;
  const platformOverride =
    opts.capEnv?.[ENV_VARS.confinementPlatform] ?? process.env[ENV_VARS.confinementPlatform];
  const platform = opts.confinementPlatform ?? platformOverride ?? process.platform;
  let claudeBin: ClaudeBinInfo | null = platform === 'darwin' ? await probeClaudeBin() : null;
  let availability: ConfinementAvailability | undefined;
  let claudeAuth: ClaudeCodeAuthProbe | null = null;
  let claudeLogin: ClaudeLogin | null = null;
  let loginProbe: Promise<ClaudeCodeAuthProbe> | null = null;
  const readExpiresAt = opts.readClaudeOauthExpiresAt ?? readDefaultClaudeOauthExpiresAt;
  const probeAuthAndRemember = (): Promise<ClaudeCodeAuthProbe> => {
    if (platform !== 'darwin' && !availability?.ready)
      return Promise.resolve({ state: 'unknown', reason: 'confinement unavailable' });
    if (loginProbe) return loginProbe;
    const pending = (async () => {
      const probe = await (opts.claudeCodeAuthProbe ?? probeClaudeCodeAuth)();
      claudeAuth = probe;
      const expiresAt =
        probe.state === 'logged-in' &&
        probe.method === 'claude.ai' &&
        probe.provider === 'firstParty'
          ? readExpiresAt()
          : null;
      claudeLogin = classifyClaudeCodeLogin(probe.state, expiresAt, Date.now());
      return probe;
    })();
    loginProbe = pending.finally(() => {
      loginProbe = null;
    });
    return loginProbe;
  };
  const claudeReport = () =>
    readClaudeCodeReport(undefined, {
      bin: claudeBin,
      ...(claudeAuth !== null ? { auth: claudeAuth } : {}),
      ...(claudeLogin !== null ? { login: claudeLogin } : {}),
    });

  if (platform === 'darwin') await probeAuthAndRemember();

  const capEnv = opts.capEnv ?? process.env;
  const orbProvider = opts.orbProvider ?? createOrbProvider(capEnv, paths.home);
  const capabilitiesProbe =
    opts.capabilitiesProbe ??
    createMachineCapabilitiesProbe({
      mcpConfigPath: config.mcpConfigPath,
      skillsDir: config.skillsDir,
    });
  const hostComputer =
    opts.hostComputer ??
    (capEnv.CAIRN_OWN_COMPUTER === '1' ? new HostComputerProvider() : undefined);
  const hostScreen = opts.hostScreen ?? createHostScreenFromEnv(capEnv);
  const enrolledIdentity = { machineId: '' };
  const computerHost = createComputerOrbProvider(capEnv, orbProvider);
  const computerOrbs =
    opts.orbComputer === undefined && computerHost
      ? new ComputerOrbs({
          stateFile: join(paths.home, 'orb-state', 'computers.json'),
          runtimeRoot: computerHost.runtimeRoot,
        })
      : undefined;
  const computerInputLocks = join(paths.home, 'computer-input');
  if (computerOrbs) ensurePrivateDir(computerInputLocks);
  const orbComputer =
    opts.orbComputer ??
    (computerOrbs && computerHost
      ? new OrbComputerProvider({
          orbs: computerOrbs,
          runtimeRoot: computerHost.runtimeRoot,
          inputFence: new ComputerInputFence(computerInputLocks, () => enrolledIdentity.machineId),
          release: {
            publish: () => computerHost.publishRelease(),
            authenticated: (machine, release) =>
              computerHost.retainComputerRelease(machine, release),
          },
          onError: (message) => logger.machine(message),
        })
      : undefined);
  const agentReach = new AgentReachProbe();
  const capabilitiesReport = (): MachineCapabilities => {
    const reach = agentReach.current();
    return {
      ...capabilitiesProbe(),
      osPlatform: platform === 'linux' || platform === 'darwin' ? platform : 'other',
      confinement: availability?.observation(),
      codexLogin: readCodexLogin(paths.agentRuntimeDir),
      executor: orbProvider.kind,
      ...(orbComputer ? { computer: true as const } : {}),
      ...(orbComputer && computerImageOffersBrowser() ? { browser: true as const } : {}),
      ...(hostComputer ? { ownComputer: true as const } : {}),
      ...(reach !== undefined ? { agentReach: reach } : {}),
    };
  };

  let claudeBackend: AgentBackend | null = opts.claudeCodeBackend ?? null;
  let geminiBackend: AgentBackend | null = opts.geminiBackend ?? null;
  let claudeAnnounced = false;
  let geminiAnnounced = false;
  const backendFor = (
    agentProviderId: string | null | undefined,
    agentId?: string,
  ): AgentBackend => {
    const acp = agentId !== undefined ? acpBackends.get(agentId) : undefined;
    if (acp) {
      logger.machine(`ACP adapter ${acp.capabilities.name} selected for agent ${agentId}`);
      return acp;
    }
    if (agentProviderId === 'gemini') {
      if (!geminiAnnounced) {
        logger.raw('Loading gemini runtime…');
        geminiAnnounced = true;
      }
      if (geminiBackend === null) geminiBackend = createGeminiBackend();
      return geminiBackend;
    }
    if (!isBackendRuntimeId(agentProviderId)) {
      if (backend === undefined) {
        logger.raw('Loading pi runtime…');
        backend = createPiBackend({
          agentDir: paths.agentRuntimeDir,
          sessionDir: paths.chatSessionsDir,
          skills: { skillsDir: config.skillsDir, cwd: config.home },
          resolveSessionFile: (sid) => resolveSessionFile(paths, sid),
          onSession: (sid, file) => {
            if (file) recordSession(paths, sid, file);
          },
          onMcpLog: (msg) => logger.mcp(msg),
          onSkillsLog: (msg) => logger.skills(msg),
          onGateLog: (msg) => logger.gate(msg),
          onTrustLog: (msg) => logger.trust(msg),
          onOtelLog: (msg) => logger.prefixed('otel', msg),
          onCompactionLog: (msg) => logger.step(msg),
          machineName: config.name,
        });
        logger.machine(piSessionPolicyLine(process.env));
      }
      return backend;
    }
    if (!claudeAnnounced) {
      logger.raw('Loading claude-code runtime…');
      claudeAnnounced = true;
    }
    if (claudeBackend === null) {
      claudeBackend = createClaudeCodeBackend({
        skills: { skillsDir: config.skillsDir, cwd: config.home },
        onSkillsLog: (msg) => logger.skills(msg),
        machineName: config.name,
        ...(claudeBin !== null ? { executablePath: claudeBin.path } : {}),
        teamSkillsCacheDir: paths.teamSkillsCacheDir,
        ...(claudeBin !== null ? { executableVersion: claudeBin.version } : {}),
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

  let machineJson = loadMachineJson(paths);
  if (machineJson && machineJson.serverUrl !== config.serverUrl) {
    logger.machine(
      `enrolled against ${machineJson.serverUrl} but polling ${config.serverUrl} — if auth fails, re-enroll: logout, then start --api-key <k> --team <id>`,
    );
  }
  if (!machineJson) {
    if (!config.apiKey || !config.teamId) {
      const enrolled = await enrollThroughBrowser(client, paths, config.serverUrl, config.name, {
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        log: (line) => logger.raw(line),
      });
      machineJson = {
        machineId: enrolled.machineId,
        token: enrolled.token,
        teamId: enrolled.teamId,
        serverUrl: enrolled.serverUrl,
      };
      logger.raw(`Enrolled in team ${machineJson.teamId} (machine ${machineJson.machineId})`);
    } else {
      const enrolled = await client.enroll({
        apiKey: config.apiKey,
        teamId: config.teamId,
        name: config.name,
        cliVersion: DAEMON_VERSION,
        claudeCode: claudeReport(),
        capabilities: capabilitiesReport(),
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
  }
  inMemoryToken = machineJson.token;
  const machineId = machineJson.machineId;
  enrolledIdentity.machineId = machineId;
  const screens = new OutboundComputerScreens({
    serverUrl: config.serverUrl,
    getToken: () => inMemoryToken,
    provider: createComputerScreenProvider({
      runtimeRoot: computerHost ? () => computerHost.runtimeRoot : '/run/cairn-orb',
      ...(computerOrbs ? { ensureComputer: (scopeKey) => computerOrbs.ensure(scopeKey) } : {}),
    }),
  });

  let networkFailures = 0;
  const presenceReporter = new ComputerPresenceReporter({
    source: opts.computerPresence ?? computerOrbs,
    body: () => ({
      cliVersion: DAEMON_VERSION,
      claudeCode: claudeReport(),
      capabilities: capabilitiesReport(),
    }),
    timeoutMs: opts.presenceTimeoutMs ?? PRESENCE_TIMEOUT_MS,
    send: (body, signal) => client.presence(body, signal),
    onSuccess: () => {
      networkFailures = 0;
    },
    onFailure: (err) => {
      if (err instanceof MachineApiError) {
        if (err.status === 409) availability?.invalidate();
        networkFailures = 0;
      } else {
        networkFailures += 1;
        if (networkFailures >= DISPATCHER_RESET_FAILURE_THRESHOLD) {
          networkFailures = 0;
          proxyHandle.reset();
          logger.machine(
            `http dispatcher reset after ${DISPATCHER_RESET_FAILURE_THRESHOLD} network failures`,
          );
        }
      }
    },
    onError: (err) => {
      logger.machine(`presence failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  availability = new ConfinementAvailability({
    home: paths.home,
    platform,
    launch: opts.confinementPreflight,
    me: () => client.me(),
    send: () => presenceReporter.send(),
  });
  const probeHarnesses = async () => {
    if (!availability?.ready) return;
    if (platform !== 'darwin') claudeBin = await probeClaudeBin();
    logger.machine(
      claudeBin
        ? `claude binary: ${claudeBin.path}${claudeBin.version !== null ? ` (${claudeBin.version})` : ''}${claudeBin.source === 'well-known' ? ' [well-known fallback]' : ''}`
        : 'claude binary: not found on PATH or well-known dirs',
    );

    if (claudeAuth === null) await probeAuthAndRemember();
  };
  try {
    await availability.recheck();
    await probeHarnesses();
  } catch (error) {
    await presenceReporter.close();
    throw error;
  }
  logger.raw(`Online (machineId=${machineId}); polling ${config.serverUrl}`);

  let localCap = 1;
  let serverGates = false;
  const idleStop = Number(capEnv.CAIRN_ORB_IDLE_STOP_MS);
  const orbs = new OrbLifecycle(orbProvider, {
    max: resolveOrbCap(capEnv, localCap),
    onStopped: (handle) => relayOrbStopped(stepDeps(), handle),
    log: (message) => logger.workspace(message),
    ...(Number.isFinite(idleStop) && idleStop > 0 ? { idleStopMs: idleStop } : {}),
  });
  const refreshCap = async (): Promise<void> => {
    try {
      const me = await client.me();
      serverGates = typeof me.maxConcurrent === 'number' && me.maxConcurrent >= 1;
      localCap = resolveLocalCap(capEnv, me.maxConcurrent);
      if (orbProvider.kind === 'orb') {
        localCap = resolveOrbCap(capEnv, localCap);
        orbs.setMax(localCap);
      }
    } catch (err) {
      logger.machine(
        `me failed (keeping cap ${localCap}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  await refreshCap();

  let caffeinate: ChildProcess | undefined;
  if (opts.idleSleepPrevention !== false && process.platform === 'darwin') {
    try {
      caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
      caffeinate.unref();
      logger.raw('Idle-sleep prevention active (caffeinate)');
    } catch {}
  }

  const journal = new StepJournal(paths.outboxDir);
  const workspace = new WorkspaceManager({
    logger,
    ...(opts.orphanTtlMs !== undefined ? { orphanTtlMs: opts.orphanTtlMs } : {}),
    ...(opts.hookTimeoutMs !== undefined ? { hookTimeoutMs: opts.hookTimeoutMs } : {}),
  });
  await backfillRepositoryCaches(config.workspacesDir, (message) => logger.workspace(message));
  const sessionHandles = new Map<string, AgentSessionHandle>();
  const stepImageSupport = new Map<string, boolean | null>();
  const stepSteeringSupport = new Map<string, boolean>();
  const stepTranscripts = new Map<string, TranscriptBuffer>();
  const stops = new StepStops();
  const inFlightChief = new Set<string>();
  const workerSlots = new Map<string, number>();
  const assignWorkerSlot = (stepId: string): number => {
    const used = new Set(workerSlots.values());
    let slot = 1;
    while (used.has(slot)) slot += 1;
    workerSlots.set(stepId, slot);
    return slot;
  };
  const workerEnv = (stepId: string): Record<string, string> => ({
    [PORT_BASE_ENV]: String(portBaseForSlot(assignWorkerSlot(stepId))),
  });

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
  const removedOutboxFiles = journal.sweepOrphanFiles({
    now: Date.now(),
    ttlMs: opts.orphanTtlMs ?? ORPHAN_WORKTREE_TTL_MS,
  });
  if (removedOutboxFiles.length > 0)
    logger.workspace(`orphan outbox files removed: ${removedOutboxFiles.length}`);
  sweepOrphans();
  const orphanTimer = setInterval(sweepOrphans, 24 * 60 * 60 * 1000);
  orphanTimer.unref?.();

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

  let sweepingOrbs = false;
  let pollingClosedOrbs = false;
  let orbCleanupStopped = false;
  let closedConversationIds: string[] = [];
  const sweepOrbs = () => {
    if (sweepingOrbs || orbCleanupStopped || orbProvider.kind !== 'orb') return;
    sweepingOrbs = true;
    const closed = closedConversationIds;
    closedConversationIds = [];
    void orbs
      .sweep({
        activeConversationIds: journal.pending().map((entry) => entry.conversationId),
        closedConversationIds: closed,
      })
      .catch((error: unknown) => logger.workspace(`orb cleanup failed: ${String(error)}`))
      .finally(() => {
        sweepingOrbs = false;
      });
  };
  const pollClosedOrbs = () => {
    if (
      pollingClosedOrbs ||
      orbCleanupStopped ||
      orbProvider.kind !== 'orb' ||
      !client.closedOrbConversations
    )
      return;
    pollingClosedOrbs = true;
    const request = client.closedOrbConversations.bind(client);
    void (async () => {
      const ids = (await orbProvider.list()).map((orb) => orb.conversationId);
      for (let offset = 0; offset < ids.length; offset += MACHINE_ORB_CONVERSATIONS_LIMIT) {
        const closed = await request(ids.slice(offset, offset + MACHINE_ORB_CONVERSATIONS_LIMIT));
        closedConversationIds.push(...closed);
      }
    })()
      .catch((error: unknown) => logger.workspace(`closed orb poll failed: ${String(error)}`))
      .finally(() => {
        pollingClosedOrbs = false;
        sweepOrbs();
      });
  };
  pollClosedOrbs();
  sweepOrbs();
  const closedOrbTimer = setInterval(pollClosedOrbs, 60_000);
  closedOrbTimer.unref?.();
  const orbTimer = setInterval(sweepOrbs, 1_000);
  orbTimer.unref?.();
  const computerSweepTimer = computerOrbs
    ? setInterval(() => {
        if (computerOrbs.known().length === 0) return;
        void computerOrbs
          .sweep()
          .catch((error: unknown) => logger.workspace(`computer sweep failed: ${String(error)}`));
      }, 60_000)
    : undefined;
  computerSweepTimer?.unref?.();

  let recoveryPending = true;
  const recover = async () => {
    if (!availability?.ready || !recoveryPending) return;
    recoveryPending = false;
    const recovered = await client.recover();
    if (recovered.steps.length === 0) {
      logger.recover('no pending steps found');
    } else {
      logger.recover(`${recovered.steps.length} pending step(s) found — resuming`);
      for (const stepRecord of recovered.steps) {
        const entry = journal.get(stepRecord.id);
        if (entry?.claimed) {
          if (entry.state === 'awaiting-upload' && entry.doneBody != null) {
            await resumePendingUpload(stepDeps(), entry, {
              running: 1,
              failOnRejectedDone: orbProvider.kind === 'orb' && entry.kind !== 'chief',
            });
            continue;
          }
          const priorMachineId = entry.claimed.session.priorMachineId;
          const stillPriorSession =
            priorMachineId !== undefined &&
            entry.sessionId !== null &&
            entry.sessionId === entry.claimed.session.sessionId;
          const claimed: ClaimedStep = {
            ...entry.claimed,
            session: {
              action: entry.sessionId ? 'continue' : 'new',
              sessionId: entry.sessionId,
              ...(stillPriorSession ? { priorMachineId } : {}),
            },
          };
          await runOrbStep(orbs, stepDeps(), claimed, {
            resume: { sessionId: entry.sessionId, prompt: entry.prompt },
            running: 1,
            ...(entry.stopRequest != null ? { stopRequest: entry.stopRequest } : {}),
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
  };
  await recover();

  const streamCtrl = new AbortController();
  const deliverSteer = async (stepId: string): Promise<void> => {
    if (stepSteeringSupport.get(stepId) === false) {
      logger.step(`steer left queued (backend does not support steering) step=${stepId}`);
      return;
    }
    try {
      const live = sessionHandles.get(stepId);
      if (live === undefined) {
        logger.step(`steer dropped (no live session) step=${stepId}`);
        return;
      }
      const fetched = await client.steer(stepId);
      const answers = fetched?.answers ?? [];
      const content = appendAnswers(fetched?.content ?? '', answers);
      if (content === '') return;
      let deliveryText = content;
      let images: DeliveredImage[] | undefined;
      try {
        const resolved = await resolveStepImages({
          text: content,
          stepId,
          client,
          materializeDir: paths.stepAttachmentsDir,
          log: (line) => logger.step(line),
          imageSupport: stepImageSupport.get(stepId) ?? null,
        });
        deliveryText = resolved.text;
        if (resolved.images.length > 0) images = [...resolved.images];
        if (resolved.skippedNoVision > 0) {
          const row = {
            id: `image-skip-steer-${stepId}-${randomUUID()}`,
            role: 'system' as const,
            content: `图片未被模型读取：追加消息中的 ${resolved.skippedNoVision} 张图片未交付，当前模型不支持图片输入。步骤继续执行。`,
            createdAt: Date.now(),
          };
          stepTranscripts.get(stepId)?.upsert(row);
          await client.transcriptRow?.(stepId, row).catch((err: unknown) => {
            logger.step(
              `image notice relay failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      } catch (err) {
        logger.step(
          `steer attachment resolve failed (delivering raw text): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (sessionHandles.get(stepId) !== live) {
        logger.step(`steer dropped (no live session) step=${stepId}`);
        return;
      }
      await live.steer(deliveryText, images);
      await client.steerAck?.(
        stepId,
        answers.length > 0
          ? { answerIds: answers.map((answer) => answer.requestId), via: 'steer' }
          : undefined,
      );
      logger.step(`steer delivered step=${stepId}`);
    } catch (err) {
      logger.step(`steer delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const deliverStop = async (stepId: string): Promise<void> => {
    try {
      const discard = await client.stop(stepId);
      if (discard === null) return;
      const run = stops.get(stepId);
      if (run === undefined) {
        logger.step(`stop dropped (no live session) step=${stepId}`);
        return;
      }
      await run.deliver({ discard });
      logger.step(`stop delivered step=${stepId}`);
    } catch (err) {
      logger.step(`stop delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const computerDispatcher = createComputerDispatcher({
    client,
    logger,
    ...(hostComputer ? { host: hostComputer } : {}),
    ...(hostScreen ? { screen: hostScreen } : {}),
    ...(orbComputer ? { orb: orbComputer } : {}),
  });
  const deliverSync = async (cmd: import('@cairn/shared').MachineSyncCommand): Promise<void> => {
    await performSync({ client, logger }, cmd);
  };
  void (async () => {
    let backoff = 1_000;
    let announced = false;
    let reportedDown = false;
    while (!streamCtrl.signal.aborted) {
      try {
        await client.stream(
          streamCtrl.signal,
          (ev) => {
            if (ev.type === 'shutdown') void stop();
            if (ev.type === 'steer') void deliverSteer(ev.stepId);
            if (ev.type === 'stop') void deliverStop(ev.stepId);
            if (ev.type === 'sync') void deliverSync(ev.sync);
            if (ev.type === 'computer') void computerDispatcher.dispatch(ev.call);
            if (ev.type === 'computer.screen') void screens.dispatch(ev.channel);
          },
          () => {
            if (!announced) {
              announced = true;
              reportedDown = false;
              logger.wake('push channel connected');
            }
          },
        );
        backoff = 1_000;
      } catch (err) {
        if (!reportedDown && !streamCtrl.signal.aborted) {
          reportedDown = true;
          announced = false;
          logger.wake(`push channel down: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (streamCtrl.signal.aborted) return;
      await sleep(backoff);
      backoff = nextBackoffMs(backoff);
    }
  })();

  const presenceTimer = setInterval(() => {
    void refreshCap();
    void probeAuthAndRemember()
      .then(() => presenceReporter.send())
      .catch((err: unknown) => {
        logger.machine(`presence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, opts.presenceIntervalMs ?? 30_000);
  presenceTimer.unref?.();

  let resumeClaims: (() => void) | undefined;
  let stopping = false;
  const claimCtrl = new AbortController();
  const claimTimeoutMs = opts.claimTimeoutMs ?? CLAIM_POLL_INTERVAL_MS + 15_000;

  function stepDeps() {
    return {
      client,
      journal,
      backendFor,
      orbProxyUrl: capEnv.CAIRN_ORB_PROXY_URL,
      logger,
      paths,
      workspace,
      workspacesDir: config.workspacesDir,
      mcpConfigPath: config.mcpConfigPath,
      skillsDir: config.skillsDir,
      sessionHandles,
      stepImageSupport,
      stepSteeringSupport,
      stepTranscripts,
      stops,
      machineName: config.name,
      claudeCodeAuthProbe: probeAuthAndRemember,
      ...(daemonOtel !== null ? { otel: daemonOtel } : {}),
      ...(opts.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: opts.heartbeatIntervalMs }
        : {}),
    };
  }

  const inFlight = new Map<string, Promise<void>>();
  const done = (async () => {
    const backoffBase = opts.claimBackoffBaseMs ?? 1_000;
    let backoff = backoffBase;
    while (!stopping) {
      if (!availability?.ready) {
        await new Promise<void>((resolve) => {
          resumeClaims = resolve;
        });
        continue;
      }
      const workersInFlight = inFlight.size - inFlightChief.size;
      if (
        (orbProvider.kind === 'orb' && inFlight.size >= localCap) ||
        (!serverGates && workersInFlight > 0 && workersInFlight >= localCap)
      ) {
        await Promise.race(inFlight.values());
        continue;
      }
      let step: ClaimedStep | null = null;
      try {
        step = await client.claim(
          AbortSignal.any([claimCtrl.signal, AbortSignal.timeout(claimTimeoutMs)]),
          { maxWorkers: localCap, confinement: availability.report },
        );
        backoff = backoffBase;
      } catch (err) {
        if (stopping) break;
        logger.machine(
          `claim failed: ${err instanceof Error ? err.message : String(err)} (backoff ${backoff}ms)`,
        );
        await sleep(backoff);
        backoff = Math.min(backoff * 2, CLAIM_BACKOFF_CAP_MS);
        continue;
      }
      if (!step || stopping) continue;
      logger.raw(`claim step=${step.step.id}`);
      const stepId = step.step.id;
      if (inFlight.has(stepId)) {
        logger.step(`claim for step ${stepId} already running here — keeping the run in flight`);
        continue;
      }
      if (step.step.kind === 'chief') inFlightChief.add(stepId);
      const stepEnv = step.step.kind === 'chief' ? undefined : workerEnv(stepId);
      const launched = runOrbStep(orbs, stepDeps(), step, {
        running: inFlight.size + 1,
        ...(stepEnv !== undefined ? { env: stepEnv } : {}),
      })
        .catch((err: unknown) => {
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
    resumeClaims?.();
    logger.machine(`Shutting down…${cause ? ` (${cause})` : ''}`);
    clearInterval(presenceTimer);
    clearInterval(orphanTimer);
    orbCleanupStopped = true;
    clearInterval(closedOrbTimer);
    clearInterval(orbTimer);
    clearInterval(computerSweepTimer);
    clearInterval(stepScratchTimer);
    streamCtrl.abort();
    claimCtrl.abort();
    void screens.close();
    caffeinate?.kill();
    await presenceReporter.close();
    await computerDispatcher.close();
    if (orbComputer instanceof OrbComputerProvider) await orbComputer.close();
  }

  return {
    machineId,
    stop,
    done,
    async recheckConfinement() {
      await availability.recheck();
      await probeHarnesses();
      await recover();
      resumeClaims?.();
    },
  };
}
