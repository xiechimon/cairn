import { type ChildProcess, spawn } from 'node:child_process';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  DeliveredImage,
  MachineCapabilities,
} from '@cairn/shared';
import {
  CLAIM_BACKOFF_CAP_MS,
  CLAIM_POLL_INTERVAL_MS,
  isBackendRuntimeId,
  ORPHAN_WORKTREE_TTL_MS,
} from '@cairn/shared';
import { createGeminiBackend } from './backend/acp.js';
import { createClaudeCodeBackend } from './backend/claude-code.js';
import { type DaemonOtel, daemonOtelFromEnv } from './backend/otel.js';
import { createPiBackend, piSessionPolicyLine } from './backend/pi.js';
import { type ClaudeCodeAuthProbe, probeClaudeCodeAuth } from './claude-code-auth.js';
import { type ClaudeBinInfo, probeClaudeBin } from './claude-code-bin.js';
import { readClaudeCodeReport } from './claude-code-models.js';
import type { DaemonConfig } from './config.js';
import { StepJournal } from './journal.js';
import type { DaemonLogger } from './log.js';
import { createMachineCapabilitiesProbe } from './machine-capabilities.js';
import { type MachineApi, MachineClient } from './machine-client.js';
import { setupProxy } from './proxy.js';
import { resumePendingUpload, runStep } from './runner.js';
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
  capabilitiesProbe?: () => MachineCapabilities;
  fetchImpl?: typeof fetch;
  client?: MachineApi;
  claimTimeoutMs?: number;
  presenceIntervalMs?: number;
  claimBackoffBaseMs?: number;
  proxyEnv?: NodeJS.ProcessEnv;
  capEnv?: NodeJS.ProcessEnv;
  heartbeatIntervalMs?: number;
  idleSleepPrevention?: boolean;
  orphanTtlMs?: number;
  hookTimeoutMs?: number;
  otel?: DaemonOtel | null;
}

export interface MachineHandle {
  machineId: string;
  stop(cause?: string): Promise<void>;
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nextBackoffMs(current: number, cap = CLAIM_BACKOFF_CAP_MS): number {
  return Math.min(current * 2, cap);
}

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
  ensureStateDirs(paths);
  loadOrCreateDeviceJson(paths);
  setupProxy(logger, opts.proxyEnv ?? process.env, config.serverUrl);

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

  logger.raw('Loading pi runtime…');
  const backend =
    opts.backend ??
    createPiBackend({
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
  if (opts.backend === undefined) {
    logger.machine(piSessionPolicyLine(process.env));
  }

  const claudeBin: ClaudeBinInfo | null = await probeClaudeBin();
  logger.machine(
    claudeBin
      ? `claude binary: ${claudeBin.path}${claudeBin.version !== null ? ` (${claudeBin.version})` : ''}${claudeBin.source === 'well-known' ? ' [well-known fallback]' : ''}`
      : 'claude binary: not found on PATH or well-known dirs',
  );
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

  const capabilitiesReport =
    opts.capabilitiesProbe ??
    createMachineCapabilitiesProbe({
      mcpConfigPath: config.mcpConfigPath,
      skillsDir: config.skillsDir,
    });

  let claudeBackend: AgentBackend | null = opts.claudeCodeBackend ?? null;
  let geminiBackend: AgentBackend | null = opts.geminiBackend ?? null;
  let claudeAnnounced = false;
  let geminiAnnounced = false;
  const backendFor = (agentProviderId: string | null | undefined): AgentBackend => {
    if (agentProviderId === 'gemini') {
      if (!geminiAnnounced) {
        logger.raw('Loading gemini runtime…');
        geminiAnnounced = true;
      }
      if (geminiBackend === null) geminiBackend = createGeminiBackend();
      return geminiBackend;
    }
    if (!isBackendRuntimeId(agentProviderId)) return backend;
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
  inMemoryToken = machineJson.token;
  const machineId = machineJson.machineId;

  await client.presence({
    cliVersion: DAEMON_VERSION,
    claudeCode: claudeReport(),
    capabilities: capabilitiesReport(),
  });
  logger.raw(`Online (machineId=${machineId}); polling ${config.serverUrl}`);

  let localCap = 1;
  let serverGates = false;
  const capEnv = opts.capEnv ?? process.env;
  const refreshCap = async (): Promise<void> => {
    try {
      const me = await client.me();
      serverGates = typeof me.maxConcurrent === 'number' && me.maxConcurrent >= 1;
      localCap = resolveLocalCap(capEnv, me.maxConcurrent);
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
  const sessionHandles = new Map<string, AgentSessionHandle>();
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

  const recovered = await client.recover();
  if (recovered.steps.length === 0) {
    logger.recover('no pending steps found');
  } else {
    logger.recover(`${recovered.steps.length} pending step(s) found — resuming`);
    for (const stepRecord of recovered.steps) {
      const entry = journal.get(stepRecord.id);
      if (entry?.claimed) {
        if (entry.state === 'awaiting-upload' && entry.doneBody != null) {
          await resumePendingUpload(stepDeps(), entry, { running: 1 });
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
        await runStep(stepDeps(), claimed, {
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

  const streamCtrl = new AbortController();
  const deliverSteer = async (stepId: string): Promise<void> => {
    try {
      const content = await client.steer(stepId);
      if (content === null) return;
      const live = sessionHandles.get(stepId);
      if (live === undefined) {
        logger.step(`steer dropped (no live session) step=${stepId}`);
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
      if (sessionHandles.get(stepId) !== live) {
        logger.step(`steer dropped (no live session) step=${stepId}`);
        return;
      }
      await live.steer(deliveryText, images);
      await client.steerAck?.(stepId);
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
  const deliverSync = async (cmd: import('@cairn/shared').MachineSyncCommand): Promise<void> => {
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
      } catch {}
      if (streamCtrl.signal.aborted) return;
      await sleep(backoff);
      backoff = nextBackoffMs(backoff);
    }
  })();

  const presenceTimer = setInterval(() => {
    void refreshCap();
    client
      .presence({
        cliVersion: DAEMON_VERSION,
        claudeCode: claudeReport(),
        capabilities: capabilitiesReport(),
      })
      .catch((err: unknown) => {
        logger.machine(`presence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, opts.presenceIntervalMs ?? 30_000);
  presenceTimer.unref?.();

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
      skillsDir: config.skillsDir,
      sessionHandles,
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
      const workersInFlight = inFlight.size - inFlightChief.size;
      if (!serverGates && workersInFlight > 0 && workersInFlight >= localCap) {
        await Promise.race(inFlight.values());
        continue;
      }
      let step: ClaimedStep | null = null;
      try {
        step = await client.claim(
          AbortSignal.any([claimCtrl.signal, AbortSignal.timeout(claimTimeoutMs)]),
          { maxWorkers: localCap },
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
      const launched = runStep(stepDeps(), step, {
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
