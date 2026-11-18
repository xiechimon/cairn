import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { setTimeout as waitTimeout } from 'node:timers/promises';
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
  osPlatformOf,
} from '@cairn/shared';
import { AgentReachProbe } from './agent-reach.js';
import { createAcpBackend, createGeminiBackend } from './backend/acp.js';
import {
  type AntigravityManaged,
  createAntigravityManaged,
} from './backend/antigravity-managed.js';
import { createClaudeCodeBackend } from './backend/claude-code.js';
import { readCodexLogin } from './backend/codex-login.js';
import { createSessionConfiner, type Launch } from './backend/confine-session.js';
import { ConfinementAvailability } from './backend/confinement-availability.js';
import { createDevinUpdateNormalizer } from './backend/devin-acp.js';
import { createDevinManaged, type DevinManaged } from './backend/devin-managed.js';
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
import type { ComputerDesktops } from './computer/desktops.js';
import { createComputerDispatcher } from './computer/dispatch.js';
import { HostComputerProvider } from './computer/host.js';
import { HostDesktops } from './computer/host-desktop.js';
import {
  AgentDesktopVerifier,
  agentDesktopBinary,
  createHostScreenFromEnv,
  type HostScreen,
} from './computer/host-screen.js';
import { ComputerInputFence } from './computer/input-fence.js';
import { ComputerPresenceReporter, type ComputerPresenceSource } from './computer/presence.js';
import type { ComputerProvider, ScopedComputerProviders } from './computer/provider.js';
import { OutboundComputerScreens } from './computer/screen-channel.js';
import { createComputerScreenProvider } from './computer/screen-provider.js';
import { VmDesktops } from './computer/vm-desktop.js';
import { VmRuntime } from './computer/vm-runtime.js';
import type { DaemonConfig } from './config.js';
import { FolderPins } from './folder-pins.js';
import { createHostPermissionsProbe, type HostPermissionsProbe } from './host-permissions.js';
import { StepJournal, type TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { createMachineCapabilitiesProbe } from './machine-capabilities.js';
import { type MachineApi, MachineApiError, MachineClient } from './machine-client.js';
import { enrollThroughBrowser } from './machine-enroll.js';
import { OrbLifecycle, resolveOrbCap } from './orb/lifecycle.js';
import type { OrbProvider } from './orb/provider.js';
import { createOrbProvider } from './orb/select.js';
import { relayOrbStopped, runOrbStep } from './orb/step.js';
import { ensurePrivateDir } from './private-fs.js';
import { setupProxy } from './proxy.js';
import { performRepoArchive } from './repo-archive.js';
import {
  ensureStateDirs,
  loadDevinModels,
  loadMachineJson,
  loadOrCreateDeviceJson,
  recordSession,
  resolveSessionFile,
  type StatePaths,
  saveDevinModels,
  saveMachineJson,
} from './state.js';
import { resolveStepImages, sweepStepAttachments } from './step-attachments.js';
import { resumePendingUpload } from './step-final-upload.js';
import { StepStops } from './step-stops.js';
import { DAEMON_VERSION } from './version.js';
import { agentReachEnabled, readScrapling, ScraplingProbe } from './web-tools.js';
import { WorkspaceManager } from './workspace.js';

export interface MachineLoopOpts {
  config: DaemonConfig;
  paths: StatePaths;
  logger: DaemonLogger;
  backend?: AgentBackend;
  claudeCodeBackend?: AgentBackend;
  geminiBackend?: AgentBackend;
  devinManaged?: DevinManaged;
  antigravityManaged?: AntigravityManaged;
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  readClaudeOauthExpiresAt?: () => number | null;
  capabilitiesProbe?: () => MachineCapabilities;
  hostPermissionsProbe?: HostPermissionsProbe;
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
  piHostLaunch?: () => Launch;
  confinementPlatform?: string;
  confinementPreflight?: ConstructorParameters<typeof ConfinementAvailability>[0]['launch'];
  seatbeltProbe?: ConstructorParameters<typeof ConfinementAvailability>[0]['seatbeltProbe'];
  confinementRecheckMs?: number;
  strandedUploadReplayMs?: number;
  strandedUploadMinAgeMs?: number;
}

export interface MachineHandle {
  machineId: string;
  stop(cause?: string): Promise<void>;
  done: Promise<void>;
  recheckConfinement(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CONFINEMENT_RECHECK_MS = 60_000;
const STRANDED_UPLOAD_REPLAY_MS = 30_000;
const STRANDED_UPLOAD_MIN_AGE_MS = 30_000;
const STRANDED_UPLOAD_MAX_ATTEMPTS = 40;
const CONFINEMENT_STOP_WAIT_MS = 15_000;

export function nextBackoffMs(current: number, cap = CLAIM_BACKOFF_CAP_MS): number {
  return Math.min(current * 2, cap);
}

export const PRESENCE_TIMEOUT_MS = 20_000;
export const GOODBYE_TIMEOUT_MS = 2_000;
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
  ensureStateDirs(paths);
  const confine = createSessionConfiner({
    daemonHome: config.home,
    extraDeniedRoots: (process.env[ENV_VARS.confineDeniedRoots] ?? '')
      .split(delimiter)
      .filter((path) => path !== ''),
    readable: [config.skillsDir, paths.teamSkillsCacheDir],
    handoffDirectories: [paths.plansDir],
    serverUrl: config.serverUrl,
  });
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
  const hostPermissionsProbe = opts.hostPermissionsProbe ?? createHostPermissionsProbe(capEnv);
  const hostScreen =
    opts.hostScreen ??
    createHostScreenFromEnv(capEnv, {
      onPermissionDenied: () => hostPermissionsProbe.refreshNow(),
    });
  const ownComputerHost = Boolean(capEnv.CAIRN_AGENT_DESKTOP);
  const agentDesktop = ownComputerHost
    ? new AgentDesktopVerifier({ binary: agentDesktopBinary(capEnv) })
    : undefined;
  const enrolledIdentity = { machineId: '' };
  const computerInputLocks = join(paths.home, 'computer-input');
  const inputFence = new ComputerInputFence(computerInputLocks, () => enrolledIdentity.machineId);
  const vmRoot = join(paths.home, 'vm');
  const desktops: ComputerDesktops | undefined =
    opts.orbComputer !== undefined
      ? undefined
      : platform === 'linux'
        ? new HostDesktops({
            root: join(paths.home, 'desktops'),
            toolsRoot: join(paths.home, 'tools'),
            env: capEnv,
            inputFence,
          })
        : platform === 'darwin'
          ? new VmDesktops({
              root: vmRoot,
              runtime: new VmRuntime({ root: vmRoot, env: capEnv }),
              env: capEnv,
              inputFence,
              log: (message) => logger.machine(message),
            })
          : undefined;
  const hostDesktops = desktops?.missingPrograms().length === 0 ? desktops : undefined;
  if (hostDesktops) ensurePrivateDir(computerInputLocks);
  if (hostDesktops instanceof HostDesktops) {
    await hostDesktops.prepareBrowser().then(
      (version) => logger.machine(`CloakBrowser prepared build ${version}`),
      (error: unknown) => {
        logger.machine(error instanceof Error ? error.message : 'CloakBrowser preparation failed');
      },
    );
  }
  const orbComputer = opts.orbComputer ?? hostDesktops;
  const agentReach = new AgentReachProbe(undefined, undefined, () => agentReachEnabled(paths.home));
  const scrapling = new ScraplingProbe(() => readScrapling(paths.home));
  const devinManaged =
    opts.devinManaged ?? createDevinManaged({ log: (line) => logger.machine(line) });
  let devinInstalling = false;
  let devinInstalled = false;
  let devinModels = loadDevinModels(paths);
  const antigravityManaged =
    opts.antigravityManaged ?? createAntigravityManaged({ log: (line) => logger.machine(line) });
  let sendPresenceNow: (() => Promise<void>) | null = null;
  void antigravityManaged
    .ensure()
    .then((install) => {
      if (install !== null && sendPresenceNow !== null) return sendPresenceNow();
    })
    .catch((error: unknown) => {
      logger.machine(
        `antigravity managed setup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  const capabilitiesReport = (): MachineCapabilities => {
    const reach = agentReach.current();
    const scraper = scrapling.current();
    const hostPermissions = hostPermissionsProbe.current();
    const vmDownload = hostDesktops instanceof VmDesktops ? hostDesktops.vmDownload() : undefined;
    return {
      ...capabilitiesProbe(),
      osPlatform: osPlatformOf(platform),
      confinement: availability?.observation(),
      ...(availability?.cause !== undefined && availability.report?.state === 'unavailable'
        ? { confinementCause: availability.cause }
        : {}),
      codexLogin: readCodexLogin(paths.agentRuntimeDir),
      devin: (() => {
        const install = devinManaged.current();
        return install === null
          ? { installed: false }
          : {
              installed: true,
              version: install.version,
              ...(devinModels.length > 0 ? { models: devinModels } : {}),
            };
      })(),
      antigravity: (() => {
        const install = antigravityManaged.current();
        return install === null
          ? { installed: false }
          : {
              installed: true,
              version: install.version,
              authenticated: install.authenticated,
              source: install.source,
              models: install.models,
            };
      })(),
      executor: orbProvider.kind,
      mcpConnectors: true,
      ...(orbComputer ? { computer: true as const } : {}),
      ...(hostDesktops?.offersBrowser()
        ? { browser: true as const, browserSecretFill: true as const }
        : {}),
      ...(hostDesktops?.offersStealthBrowser() ? { stealthBrowser: true as const } : {}),
      ...(hostDesktops ? { computerKind: hostDesktops.kind, screenHandoff: true as const } : {}),
      ...(vmDownload !== undefined ? { vmDownload } : {}),
      ...(hostComputer ? { ownComputerShell: true as const } : {}),
      ...(ownComputerHost ? { ownComputerHost: true as const } : {}),
      ...(agentDesktop?.current() ? { ownComputer: true as const } : {}),
      ...(reach !== undefined ? { agentReach: reach } : {}),
      ...(scraper !== undefined ? { scrapling: scraper } : {}),
      ...(hostPermissions !== undefined ? { hostPermissions } : {}),
    };
  };

  let claudeBackend: AgentBackend | null = opts.claudeCodeBackend ?? null;
  let geminiBackend: AgentBackend | null = opts.geminiBackend ?? null;
  let devinBackend: AgentBackend | null = null;
  let antigravityBackend: AgentBackend | null = null;
  let claudeAnnounced = false;
  let geminiAnnounced = false;
  const backendFor = (agentProviderId: string | null | undefined): AgentBackend => {
    if (agentProviderId === 'antigravity') {
      const install = antigravityManaged.current();
      if (install === null) {
        throw new Error(
          'Antigravity runtime is not installed yet: install agy or wait for managed setup, then retry the step',
        );
      }
      antigravityBackend ??= createAcpBackend({
        harness: 'antigravity',
        command: install.binPath,
        args: install.args,
        permissions: 'allow-once',
        sessionResume: true,
        allowHostMcp: true,
        skills: { skillsDir: config.skillsDir, cwd: config.home },
        onSkillsLog: (msg) => logger.skills(msg),
        ...(confine !== null && confine !== undefined ? { confine } : {}),
      });
      return antigravityBackend;
    }
    if (agentProviderId === 'devin') {
      const install = devinManaged.current();
      if (install === null) {
        throw new Error(
          'Devin managed binary is not installed yet: the ACP registry download is still in progress or failed; retry the step shortly',
        );
      }
      devinBackend ??= createAcpBackend({
        harness: 'devin',
        command: install.binPath,
        args: install.args,
        permissions: 'allow-once',
        steering: 'mid-turn',
        sessionResume: true,
        allowHostMcp: true,
        usageEvents: true,
        onDevinModels: (models) => {
          devinModels = models;
          try {
            saveDevinModels(paths, models);
          } catch (error) {
            logger.machine(
              `devin model catalog persist failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
        skills: { skillsDir: config.skillsDir, cwd: config.home },
        onSkillsLog: (msg) => logger.skills(msg),
        createUpdateNormalizer: createDevinUpdateNormalizer,
        gate: { log: (msg) => logger.gate(msg) },
        ...(confine !== null && confine !== undefined ? { confine } : {}),
      });
      return devinBackend;
    }
    if (agentProviderId === 'gemini') {
      if (!geminiAnnounced) {
        logger.raw('Loading gemini runtime…');
        geminiAnnounced = true;
      }
      if (geminiBackend === null)
        geminiBackend = createGeminiBackend({
          gate: { folderRoots: () => folderPins.roots(), log: (msg) => logger.gate(msg) },
          skills: { skillsDir: config.skillsDir, cwd: config.home },
          onSkillsLog: (msg) => logger.skills(msg),
          ...(confine !== null ? { confine } : {}),
        });
      return geminiBackend;
    }
    if (!isBackendRuntimeId(agentProviderId)) {
      if (backend === undefined) {
        logger.raw('Loading pi runtime…');
        backend = createPiBackend({
          agentDir: paths.agentRuntimeDir,
          sessionDir: paths.chatSessionsDir,
          skills: { skillsDir: config.skillsDir, cwd: config.home },
          folderRoots: () => folderPins.roots(),
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
          ...(confine !== null ? { confine } : {}),
          ...(opts.piHostLaunch !== undefined ? { hostLaunch: opts.piHostLaunch } : {}),
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
        ...(claudeBin !== null ? { executablePath: claudeBin.path } : {}),
        ...(confine !== null ? { confine } : {}),
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
    provider: createComputerScreenProvider(
      hostDesktops
        ? {
            holdComputer: (scopeKey, use, browserScope) =>
              hostDesktops.hold(scopeKey, use, browserScope),
            socketPath: (scopeKey, kind) => hostDesktops.socketPath(scopeKey, kind),
            ...(hostDesktops instanceof VmDesktops
              ? { terminalCommand: (scopeKey: string) => hostDesktops.terminalCommand(scopeKey) }
              : {}),
          }
        : {},
    ),
    log: (msg) => logger.machine(msg),
  });

  const folderPins = new FolderPins(config.workspacesDir);
  let networkFailures = 0;
  let connectionId: string | null = null;
  const presenceReporter = new ComputerPresenceReporter({
    source: opts.computerPresence ?? hostDesktops,
    body: () => ({
      connectionId,
      cliVersion: DAEMON_VERSION,
      claudeCode: claudeReport(),
      capabilities: capabilitiesReport(),
      folders: {
        workspacesDir: folderPins.workspacesRoot(),
        pins: folderPins.report(),
      },
    }),
    timeoutMs: opts.presenceTimeoutMs ?? PRESENCE_TIMEOUT_MS,
    send: async (body, signal) => {
      const response = await client.presence(body, signal);
      folderPins.setPins(response.folderPins ?? []);
      if (response.installDevin === true && !devinInstalling && !devinInstalled) {
        devinInstalling = true;
        void devinManaged
          .ensure()
          .then(
            (install) => {
              devinInstalled = install !== null;
            },
            (error: unknown) => {
              logger.machine(
                `devin managed install failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            },
          )
          .finally(() => {
            devinInstalling = false;
          });
      }
    },
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
    ...(opts.seatbeltProbe !== undefined ? { seatbeltProbe: opts.seatbeltProbe } : {}),
    me: () => client.me(),
    send: () => presenceReporter.send(),
  });
  sendPresenceNow = () => presenceReporter.send();
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
    for (let backoff = opts.claimBackoffBaseMs ?? 1_000; ; backoff = nextBackoffMs(backoff)) {
      try {
        await availability.recheck();
        break;
      } catch (error) {
        if (error instanceof MachineApiError && error.status < 500) throw error;
        logger.machine(
          `server not reachable at startup, retrying: ${error instanceof Error ? error.message : String(error)}`,
        );
        await sleep(backoff);
      }
    }
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
  const steerAcks = new Map<string, Set<Promise<void>>>();
  const deliveredSteerSends = new Map<string, number>();
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
  const desktopSweepTimer = hostDesktops
    ? setInterval(() => {
        void hostDesktops
          .sweep()
          .catch((error: unknown) => logger.machine(`desktop idle stop failed: ${String(error)}`));
      }, 60_000)
    : undefined;
  desktopSweepTimer?.unref?.();

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
      if (
        fetched?.steerSentAt !== undefined &&
        deliveredSteerSends.get(stepId) === fetched.steerSentAt
      ) {
        await client.steerAck?.(stepId, { steerSentAt: fetched.steerSentAt });
        logger.step(`steer replay skipped (already delivered) step=${stepId}`);
        return;
      }
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
            content: `图片未被模型读取：追加消息中的 ${resolved.skippedNoVision} 张图片未以图片形式交付（当前模型不支持图片输入），已改用文字转录或本地文件交付`,
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
      const ackBody =
        answers.length > 0 ||
        fetched?.messageIds !== undefined ||
        fetched?.steerSentAt !== undefined
          ? {
              ...(answers.length > 0
                ? { answerIds: answers.map((answer) => answer.requestId), via: 'steer' as const }
                : {}),
              ...(fetched?.messageIds !== undefined ? { messageIds: fetched.messageIds } : {}),
              ...(fetched?.steerSentAt !== undefined ? { steerSentAt: fetched.steerSentAt } : {}),
            }
          : undefined;
      const delivery = live.steer(deliveryText, images).then(() => {
        if (fetched?.steerSentAt !== undefined) {
          deliveredSteerSends.set(stepId, fetched.steerSentAt);
        }
        return client.steerAck?.(stepId, ackBody);
      });
      const pending = steerAcks.get(stepId) ?? new Set<Promise<void>>();
      steerAcks.set(stepId, pending);
      pending.add(delivery);
      try {
        await delivery;
      } finally {
        pending.delete(delivery);
        if (pending.size === 0) steerAcks.delete(stepId);
      }
      logger.step(`steer delivered step=${stepId}`);
    } catch (err) {
      logger.step(`steer delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const deliveredStops = new Set<string>();
  const deliverStop = async (stepId: string): Promise<void> => {
    try {
      const discard = await client.stop(stepId);
      if (discard === null || deliveredStops.has(stepId)) return;
      const run = stops.get(stepId);
      if (run === undefined) {
        logger.step(`stop dropped (no live session) step=${stepId}`);
        return;
      }
      await run.deliver({ discard });
      deliveredStops.add(stepId);
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
    cairnOrigins: [
      config.serverUrl,
      ...(capEnv.CAIRN_WEB_ORIGINS ?? '').split(',').filter((origin) => origin.trim() !== ''),
    ],
  });
  void (async () => {
    let backoff = 1_000;
    let announced = false;
    let reportedDown = false;
    while (!streamCtrl.signal.aborted) {
      try {
        await client.stream(
          streamCtrl.signal,
          (ev) => {
            if (ev.type === 'hello') connectionId = ev.connectionId;
            if (ev.type === 'shutdown') void stop();
            if (ev.type === 'steer') void deliverSteer(ev.stepId);
            if (ev.type === 'stop') void deliverStop(ev.stepId);
            if (ev.type === 'repo.archive') {
              void performRepoArchive({ client, logger }, ev.archive);
            }
            if (ev.type === 'computer') void computerDispatcher.dispatch(ev.call);
            if (ev.type === 'computer.cancel') computerDispatcher.cancel(ev.callId);
            if (ev.type === 'computer.screen') void screens.dispatch(ev.channel);
          },
          () => {
            if (!announced) {
              announced = true;
              reportedDown = false;
              logger.wake('push channel connected');
              for (const stepId of sessionHandles.keys()) {
                void deliverSteer(stepId);
                void deliverStop(stepId);
              }
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
    const currentAg = antigravityManaged.current();
    if (currentAg === null || !currentAg.authenticated) {
      void antigravityManaged.probe().catch(() => {});
    }
    void probeAuthAndRemember()
      .then(() => presenceReporter.send())
      .catch((err: unknown) => {
        logger.machine(`presence failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, opts.presenceIntervalMs ?? 30_000);
  presenceTimer.unref?.();

  const recheckConfinement = async () => {
    await availability.recheck();
    await probeHarnesses();
    await recover();
    resumeClaims?.();
  };
  const confinementTimer = setInterval(() => {
    if (stopping || availability.ready || !availability.recoverable) return;
    void recheckConfinement().catch((err: unknown) => {
      logger.machine(
        `confinement recheck failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }, opts.confinementRecheckMs ?? CONFINEMENT_RECHECK_MS);
  confinementTimer.unref?.();

  let resumeClaims: (() => void) | undefined;
  let stopping = false;
  const claimCtrl = new AbortController();
  const claimTimeoutMs = opts.claimTimeoutMs ?? CLAIM_POLL_INTERVAL_MS + 15_000;

  function stepDeps() {
    return {
      client,
      journal,
      backendFor,
      devinHome: () => devinManaged.current()?.home,
      antigravityAuth: () => antigravityManaged.current()?.authenticated === true,
      orbProxyUrl: capEnv.CAIRN_ORB_PROXY_URL,
      logger,
      paths,
      workspace,
      workspacesDir: config.workspacesDir,
      mcpConfigPath: config.mcpConfigPath,
      skillsDir: config.skillsDir,
      sessionHandles,
      settleSteers: async (stepId: string) => {
        const pending = steerAcks.get(stepId);
        if (pending === undefined) return;
        let settled = false;
        await Promise.race([
          Promise.allSettled([...pending]).then(() => {
            settled = true;
          }),
          waitTimeout(5_000, undefined, { ref: false }),
        ]);
        if (!settled)
          logger.step(`steer acknowledgment timed out step=${stepId}; unread input remains queued`);
      },
      stepImageSupport,
      stepSteeringSupport,
      stepTranscripts,
      stops,
      machineName: config.name,
      ...(daemonOtel !== null ? { otel: daemonOtel } : {}),
      ...(opts.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: opts.heartbeatIntervalMs }
        : {}),
    };
  }

  const inFlight = new Map<string, Promise<void>>();
  const strandedMinAgeMs = opts.strandedUploadMinAgeMs ?? STRANDED_UPLOAD_MIN_AGE_MS;
  const strandedAttempts = new Map<string, number>();
  let replayingStranded = false;
  const replayStrandedUploads = async () => {
    if (replayingStranded || stopping || !availability?.ready) return;
    replayingStranded = true;
    try {
      for (const entry of journal.pending()) {
        if (
          entry.state !== 'awaiting-upload' ||
          entry.doneBody == null ||
          inFlight.has(entry.stepId) ||
          Date.now() - entry.updatedAt < strandedMinAgeMs
        )
          continue;
        const attempts = (strandedAttempts.get(entry.stepId) ?? 0) + 1;
        strandedAttempts.set(entry.stepId, attempts);
        if (attempts > STRANDED_UPLOAD_MAX_ATTEMPTS) {
          if (attempts === STRANDED_UPLOAD_MAX_ATTEMPTS + 1) {
            logger.recover(`step ${entry.stepId} could not be re-delivered — leaving its journal`);
          }
          continue;
        }
        await resumePendingUpload(stepDeps(), entry, {
          running: 1,
          failOnRejectedDone: orbProvider.kind === 'orb' && entry.kind !== 'chief',
        });
      }
    } finally {
      replayingStranded = false;
    }
  };
  const strandedTimer = setInterval(() => {
    void replayStrandedUploads().catch((err: unknown) => {
      logger.machine(
        `re-delivering a finished step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }, opts.strandedUploadReplayMs ?? STRANDED_UPLOAD_REPLAY_MS);
  strandedTimer.unref?.();
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
    clearInterval(confinementTimer);
    clearInterval(strandedTimer);
    clearInterval(orphanTimer);
    orbCleanupStopped = true;
    clearInterval(closedOrbTimer);
    clearInterval(orbTimer);
    clearInterval(desktopSweepTimer);
    clearInterval(stepScratchTimer);
    streamCtrl.abort();
    claimCtrl.abort();
    void screens.close();
    caffeinate?.kill();
    await Promise.race([
      availability?.settled(),
      waitTimeout(CONFINEMENT_STOP_WAIT_MS, undefined, { ref: false }),
    ]);
    await presenceReporter.close();
    if (connectionId !== null && client.offline) {
      await client
        .offline({ connectionId }, AbortSignal.timeout(GOODBYE_TIMEOUT_MS))
        .catch((err: unknown) => {
          logger.machine(`goodbye failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    await computerDispatcher.close();
    hostDesktops?.close();
  }

  return {
    machineId,
    stop,
    done,
    recheckConfinement,
  };
}
