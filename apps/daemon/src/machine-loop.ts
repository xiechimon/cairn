import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
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
  type ManagedUpdateRuntime,
  ORPHAN_WORKTREE_TTL_MS,
  osPlatformOf,
  type RuntimeUpdateStatus,
  sleep,
} from '@cairn/shared';
import { reapCredentialProfiles } from '@cairn/shared/credential-profile';
import {
  collectLegacyHostKeys,
  type HostIdentitySources,
  probeHostIdentity,
} from '@cairn/shared/host-identity';
import { AgentReachProbe } from './agent-reach.js';
import { createAcpBackend, createGeminiBackend } from './backend/acp.js';
import {
  type AntigravityInstall,
  type AntigravityManaged,
  type AntigravityProbeOutcome,
  createAntigravityManaged,
} from './backend/antigravity-managed.js';
import { probeAntigravitySubscriptionModels } from './backend/antigravity-subscription-models.js';
import { createClaudeCodeBackend } from './backend/claude-code.js';
import { readCodexLogin } from './backend/codex-login.js';
import { serverPortOf } from './backend/confine.js';
import { createDevinUpdateNormalizer } from './backend/devin-acp.js';
import { createHostShellConfinement } from './backend/host-shell-confinement.js';
import type { ManagedRuntime } from './backend/managed-runtime.js';
import { type DaemonOtel, daemonOtelFromEnv } from './backend/otel.js';
import { createPiBackend, piSessionPolicyLine } from './backend/pi.js';
import { backfillRepositoryCaches } from './backend/repo-cache-backfill.js';
import {
  createClaudeManaged,
  createDevinManaged,
  createGeminiManaged,
} from './backend/runtime-channels.js';
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
import { createHostScreenFromEnv, type HostScreen } from './computer/host-screen.js';
import { ComputerInputFence } from './computer/input-fence.js';
import { closeOwnerChrome } from './computer/owner-chrome.js';
import { createPhones } from './computer/phones.js';
import { ComputerPresenceReporter, type ComputerPresenceSource } from './computer/presence.js';
import type { ComputerProvider, ScopedComputerProviders } from './computer/provider.js';
import { OutboundComputerScreens } from './computer/screen-channel.js';
import { createComputerScreenProvider } from './computer/screen-provider.js';
import { defaultStagingRoot, sweepStagedUploads } from './computer/staging.js';
import { VmDesktops } from './computer/vm-desktop.js';
import { VmRuntime } from './computer/vm-runtime.js';
import type { DaemonConfig } from './config.js';
import { createHostPermissionsProbe, type HostPermissionsProbe } from './host-permissions.js';
import { importAgentConfig } from './import-agent-config.js';
import { createImsgBridge } from './imsg-bridge.js';
import { StepJournal, type TranscriptBuffer } from './journal.js';
import type { DaemonLogger } from './log.js';
import { createMachineCapabilitiesProbe } from './machine-capabilities.js';
import {
  bindMachineClaim,
  type MachineApi,
  MachineApiError,
  MachineClient,
} from './machine-client.js';
import { enrollThroughBrowser } from './machine-enroll.js';
import { OrbLifecycle, resolveOrbCap } from './orb/lifecycle.js';
import type { OrbProvider } from './orb/provider.js';
import { createOrbProvider } from './orb/select.js';
import { relayOrbStopped, runOrbStep } from './orb/step.js';
import { ensurePrivateDir } from './private-fs.js';
import { STEP_TREE_ENV, StepReaper } from './process-tree.js';
import { setupProxy } from './proxy.js';
import { performRepoArchive } from './repo-archive.js';
import type { RunStepOptions } from './runner.js';
import {
  claudeConfigHome,
  migrateRuntimeHomes,
  runtimeHome,
  toolInstallRoot,
} from './runtime-homes.js';
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
  claudeManaged?: ManagedRuntime;
  devinManaged?: ManagedRuntime;
  antigravityManaged?: AntigravityManaged;
  geminiManaged?: ManagedRuntime;
  updateChecksEnabled?: () => boolean;
  updateCheckIntervalMs?: number;
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  readClaudeOauthExpiresAt?: () => number | null;
  capabilitiesProbe?: () => MachineCapabilities;
  hostIdentitySources?: HostIdentitySources;
  legacyRunnerHomes?: readonly string[];
  hostPermissionsProbe?: HostPermissionsProbe;
  fetchImpl?: typeof fetch;
  client?: MachineApi;
  claimTimeoutMs?: number;
  presenceIntervalMs?: number;
  presenceTimeoutMs?: number;
  devinEnsureRetryMs?: number;
  antigravityEnsureRetryMs?: number;
  antigravityReprobeMs?: number;
  antigravityUpdateCheckMs?: number;
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
  platform?: string;
  strandedUploadReplayMs?: number;
  strandedUploadMinAgeMs?: number;
}

export interface MachineHandle {
  machineId: string;
  stop(cause?: string): Promise<void>;
  done: Promise<void>;
}

const STRANDED_UPLOAD_REPLAY_MS = 30_000;
const STRANDED_UPLOAD_MIN_AGE_MS = 30_000;
const STRANDED_UPLOAD_MAX_ATTEMPTS = 40;
const STEP_REAP_GRACE_MS = 3_000;

export function nextBackoffMs(current: number, cap = CLAIM_BACKOFF_CAP_MS): number {
  return Math.min(current * 2, cap);
}

export const PRESENCE_TIMEOUT_MS = 20_000;
export const GOODBYE_TIMEOUT_MS = 2_000;
const MANAGED_ENSURE_RETRY_MS = 5 * 60_000;
const ANTIGRAVITY_REPROBE_MS = 10 * 60_000;
const ANTIGRAVITY_UPDATE_CHECK_MS = 60 * 60_000;
export const DISPATCHER_RESET_FAILURE_THRESHOLD = 3;

export const PORT_BASE_ENV = 'CAIRN_PORT_BASE';

export const PORT_BASE_FLOOR = 20_000;
export const PORT_BASE_STRIDE = 100;

export function portBaseForSlot(slot: number): number {
  return PORT_BASE_FLOOR + (slot - 1) * PORT_BASE_STRIDE;
}

export async function runMachine(opts: MachineLoopOpts): Promise<MachineHandle> {
  const { config, paths, logger } = opts;
  const migratedHomes = migrateRuntimeHomes(paths.home);
  for (const moved of migratedHomes) logger.machine(`runtime home moved: ${moved}`);
  ensureStateDirs(paths);
  try {
    reapCredentialProfiles(paths.home);
  } catch {
    logger.machine('Could not clean abandoned credential profiles');
  }
  const imported = importAgentConfig({
    cairnHome: paths.home,
    realHome: process.env[ENV_VARS.agentImportHome],
  });
  if (imported !== null) {
    logger.machine(
      `agent config import: ${imported.copied.length} copied, ` +
        `${imported.skipped.length} skipped, ${imported.failed.length} failed`,
    );
    for (const failure of imported.failed) {
      logger.machine(`agent config import failed: ${failure.item}: ${failure.reason}`);
    }
  }
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
  const platform = opts.platform ?? process.platform;
  const claudeSeed: ClaudeBinInfo | null = await probeClaudeBin();
  let claudeAuth: ClaudeCodeAuthProbe | null = null;
  let claudeLogin: ClaudeLogin | null = null;
  let loginProbe: Promise<ClaudeCodeAuthProbe> | null = null;
  const claudeHome = claudeConfigHome(paths.home);
  let sendPresenceNow: (() => Promise<void>) | null = null;
  const installStop = new AbortController();
  const installFetch: typeof fetch = (url, init) =>
    fetch(url, {
      ...init,
      signal: AbortSignal.any(
        init?.signal != null ? [init.signal, installStop.signal] : [installStop.signal],
      ),
    });
  const pendingInstalls = new Set<Promise<unknown>>();
  const trackInstall = <T>(install: Promise<T>): Promise<T> => {
    pendingInstalls.add(
      install.then(
        () => {},
        () => {},
      ),
    );
    return install;
  };
  const reportableUpdate = (status: RuntimeUpdateStatus): RuntimeUpdateStatus | undefined =>
    status.availableVersion != null || status.phase === 'updating' || status.phase === 'failed'
      ? status
      : undefined;
  const claudeManaged =
    opts.claudeManaged ??
    createClaudeManaged({
      root: toolInstallRoot(paths.home, 'claude'),
      log: (line) => logger.machine(line),
      fetchImpl: installFetch,
      ...(opts.updateChecksEnabled !== undefined
        ? { updateChecksEnabled: opts.updateChecksEnabled }
        : {}),
      ...(opts.updateCheckIntervalMs !== undefined
        ? { checkIntervalMs: opts.updateCheckIntervalMs }
        : {}),
      onChange: () => void sendPresenceNow?.(),
      resolveSeed: () =>
        claudeSeed === null
          ? null
          : {
              version: claudeSeed.version,
              command: claudeSeed.path,
              args: [],
              binPath: claudeSeed.path,
              source: claudeSeed.source === 'override' ? 'override' : 'bundled',
            },
    });
  const activeClaudeBin = (): ClaudeBinInfo | null => {
    const active = claudeManaged.current();
    if (active === null) return null;
    return {
      path: active.binPath,
      version: active.version !== '' ? active.version : null,
      source: active.source,
    };
  };
  const readExpiresAt =
    opts.readClaudeOauthExpiresAt ?? (() => readDefaultClaudeOauthExpiresAt(claudeHome));
  const probeAuthAndRemember = (): Promise<ClaudeCodeAuthProbe> => {
    if (loginProbe) return loginProbe;
    const pending = (async () => {
      const currentClaude = activeClaudeBin();
      const probe = await (
        opts.claudeCodeAuthProbe ??
        (() =>
          probeClaudeCodeAuth({
            ...(currentClaude !== null ? { command: currentClaude.path } : {}),
            env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
          }))
      )();
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
  const claudeReport = () => {
    const update = reportableUpdate(claudeManaged.status());
    return readClaudeCodeReport(claudeHome, {
      bin: activeClaudeBin(),
      ...(claudeAuth !== null ? { auth: claudeAuth } : {}),
      ...(claudeLogin !== null ? { login: claudeLogin } : {}),
      ...(update !== undefined ? { update } : {}),
    });
  };

  await probeAuthAndRemember();

  const capEnv = opts.capEnv ?? process.env;
  const orbProvider = opts.orbProvider ?? createOrbProvider(capEnv, paths.home);
  const capabilitiesProbe =
    opts.capabilitiesProbe ??
    createMachineCapabilitiesProbe({
      mcpConfigPath: config.mcpConfigPath,
      skillsDir: config.skillsDir,
    });
  const extraDeniedRoots = (process.env[ENV_VARS.confineDeniedRoots] ?? '')
    .split(delimiter)
    .filter((path) => path !== '');
  const serverPort = serverPortOf(new URL(config.serverUrl));
  const stagingRoot = defaultStagingRoot();
  const hostConfinement =
    capEnv.CAIRN_OWN_COMPUTER === '1'
      ? createHostShellConfinement({
          deniedRoots: [config.home, join(homedir(), '.cairn'), ...extraDeniedRoots],
          ...(serverPort !== null ? { serverPort } : {}),
          agentDesktop: capEnv.CAIRN_AGENT_DESKTOP ?? null,
          stagingRoot,
        })
      : undefined;
  const hostComputer =
    opts.hostComputer ??
    (hostConfinement !== undefined
      ? new HostComputerProvider({ confinement: hostConfinement })
      : undefined);
  const hostPermissionsProbe = opts.hostPermissionsProbe ?? createHostPermissionsProbe(capEnv);
  const cairnOrigins = [
    config.serverUrl,
    ...(capEnv.CAIRN_WEB_ORIGINS ?? '').split(',').filter((origin) => origin.trim() !== ''),
  ];
  const hostScreen =
    opts.hostScreen ??
    createHostScreenFromEnv(capEnv, {
      stateDir: join(paths.home, 'agent-desktop'),
      onPermissionDenied: () => hostPermissionsProbe.refreshNow(),
      cairnOrigins,
    });
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
    opts.devinManaged ??
    createDevinManaged({
      root: toolInstallRoot(paths.home, 'devin'),
      home: runtimeHome(paths.home, 'devin'),
      log: (line) => logger.machine(line),
      fetchImpl: installFetch,
      ...(opts.updateChecksEnabled !== undefined
        ? { updateChecksEnabled: opts.updateChecksEnabled }
        : {}),
      ...(opts.updateCheckIntervalMs !== undefined
        ? { checkIntervalMs: opts.updateCheckIntervalMs }
        : {}),
      onChange: () => void sendPresenceNow?.(),
    });
  let devinInstalling = false;
  let devinEnsured = false;
  let devinEnsureRetryAt = 0;
  let devinModels = loadDevinModels(paths);
  const activeAntigravityVersions = new Map<string, number>();
  const antigravityManaged =
    opts.antigravityManaged ??
    createAntigravityManaged({
      root: toolInstallRoot(paths.home, 'antigravity'),
      protectedVersions: () => activeAntigravityVersions.keys(),
      log: (line) => logger.machine(line),
      fetchImpl: installFetch,
    });
  const geminiManaged =
    opts.geminiManaged ??
    createGeminiManaged({
      root: toolInstallRoot(paths.home, 'gemini'),
      log: (line) => logger.machine(line),
      fetchImpl: installFetch,
      ...(opts.updateChecksEnabled !== undefined
        ? { updateChecksEnabled: opts.updateChecksEnabled }
        : {}),
      ...(opts.updateCheckIntervalMs !== undefined
        ? { checkIntervalMs: opts.updateCheckIntervalMs }
        : {}),
      onChange: () => void sendPresenceNow?.(),
    });
  const managedRuntimes: Record<ManagedUpdateRuntime, ManagedRuntime> = {
    'claude-code': claudeManaged,
    devin: devinManaged,
    gemini: geminiManaged,
  };
  const checkRuntimeUpdates = () => {
    for (const runtime of Object.values(managedRuntimes)) {
      if (runtime.current() === null) continue;
      void trackInstall(runtime.checkForUpdate()).catch((error: unknown) => {
        logger.machine(
          `runtime update check failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
  };
  const phones = createPhones({
    home: paths.home,
    log: (msg) => logger.machine(msg),
    onStale: () => void sendPresenceNow?.(),
    adbPath: platform === 'darwin' ? undefined : null,
  });
  void trackInstall(antigravityManaged.ensure())
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
      codexLogin: readCodexLogin(paths.agentRuntimeDir),
      devin: (() => {
        const install = devinManaged.current();
        const update = reportableUpdate(devinManaged.status());
        return install === null
          ? { installed: false, ...(update !== undefined ? { update } : {}) }
          : {
              installed: true,
              version: install.version,
              ...(devinModels.length > 0 ? { models: devinModels } : {}),
              ...(update !== undefined ? { update } : {}),
            };
      })(),
      ...(() => {
        const install = geminiManaged.current();
        const update = reportableUpdate(geminiManaged.status());
        if (install === null && update === undefined) return {};
        return {
          gemini:
            install === null
              ? { installed: false, ...(update !== undefined ? { update } : {}) }
              : {
                  installed: true,
                  version: install.version,
                  ...(update !== undefined ? { update } : {}),
                },
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
      antigravityOAuthProfile: true,
      ...(client.claimAntigravityModelProbe && client.finishAntigravityModelProbe
        ? { antigravitySubscriptionModels: true as const }
        : {}),
      mcpConnectors: true,
      ...(orbComputer ? { computer: true as const } : {}),
      ...(hostDesktops?.offersBrowser()
        ? { browser: true as const, browserSecretFill: true as const }
        : {}),
      ...(hostDesktops?.offersStealthBrowser() ? { stealthBrowser: true as const } : {}),
      ...(hostDesktops ? { computerKind: hostDesktops.kind, screenHandoff: true as const } : {}),
      ...(vmDownload !== undefined ? { vmDownload } : {}),
      ...(hostComputer ? { ownComputerShell: true as const } : {}),
      ...(hostScreen ? { ownComputer: true as const } : {}),
      ...(phones.usable() ? { phoneHost: true as const } : {}),
      ...(phones.reports().length > 0 ? { phones: phones.reports() } : {}),
      ...(reach !== undefined ? { agentReach: reach } : {}),
      ...(scraper !== undefined ? { scrapling: scraper } : {}),
      ...(hostPermissions !== undefined ? { hostPermissions } : {}),
    };
  };

  let claudeBackend: AgentBackend | null = opts.claudeCodeBackend ?? null;
  let geminiBackend: AgentBackend | null = opts.geminiBackend ?? null;
  let devinBackend: AgentBackend | null = null;
  let antigravityBackend: { key: string; backend: AgentBackend } | null = null;
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
      const runtimeKey = JSON.stringify([install.binPath, install.args]);
      if (antigravityBackend === null || antigravityBackend.key !== runtimeKey) {
        const runtimeVersion = install.version;
        antigravityBackend = {
          key: runtimeKey,
          backend: createAcpBackend({
            harness: 'antigravity',
            command: install.binPath,
            args: install.args,
            permissions: 'allow-once',
            sessionResume: true,
            allowHostMcp: true,
            usageEvents: true,
            skills: { skillsDir: config.skillsDir, cwd: config.home },
            onSkillsLog: (msg) => logger.skills(msg),
            acquireRuntime: () => {
              activeAntigravityVersions.set(
                runtimeVersion,
                (activeAntigravityVersions.get(runtimeVersion) ?? 0) + 1,
              );
              return () => {
                const next = (activeAntigravityVersions.get(runtimeVersion) ?? 1) - 1;
                if (next > 0) activeAntigravityVersions.set(runtimeVersion, next);
                else activeAntigravityVersions.delete(runtimeVersion);
              };
            },
          }),
        };
      }
      return antigravityBackend.backend;
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
        command: install.command,
        args: install.args,
        resolveLaunch: () => {
          const lease = devinManaged.acquire();
          return lease === null
            ? null
            : { command: lease.command, args: lease.args, release: lease.release };
        },
        permissions: 'allow-once',
        steering: 'mid-turn',
        sessionResume: true,
        allowHostMcp: true,
        usageEvents: true,
        onDevinModels: (models) => {
          devinModels = models.map((model) => {
            const learned = devinModels.find((known) => known.id === model.id);
            if (model.thinkingLevels !== undefined || learned?.thinkingLevels === undefined)
              return model;
            const { thinkingLevels, thinkingDefault } = learned;
            return thinkingDefault === undefined
              ? { ...model, thinkingLevels }
              : { ...model, thinkingLevels, thinkingDefault };
          });
          try {
            saveDevinModels(paths, devinModels);
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
      });
      return devinBackend;
    }
    if (agentProviderId === 'gemini') {
      if (!geminiAnnounced) {
        logger.raw('Loading gemini runtime…');
        geminiAnnounced = true;
      }
      const install = geminiManaged.current();
      if (install === null) {
        void trackInstall(geminiManaged.ensure()).catch((error: unknown) => {
          logger.machine(
            `gemini managed install failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        throw new Error(
          'Gemini managed install is not ready yet: the npm download is still in progress or failed; retry the step shortly',
        );
      }
      if (geminiBackend === null)
        geminiBackend = createGeminiBackend({
          executablePath: install.command,
          executableArgs: install.args,
          resolveLaunch: () => {
            const lease = geminiManaged.acquire();
            return lease === null
              ? null
              : { command: lease.command, args: lease.args, release: lease.release };
          },
          gate: { log: (msg) => logger.gate(msg) },
          skills: { skillsDir: config.skillsDir, cwd: config.home },
          onSkillsLog: (msg) => logger.skills(msg),
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
          resolveSessionFile: (sid) => resolveSessionFile(paths, sid),
          onSession: (sid, file) => {
            if (file) recordSession(paths, sid, file);
          },
          onMcpLog: (msg) => logger.mcp(msg),
          onSkillsLog: (msg) => logger.skills(msg),
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
        resolveExecutable: () => {
          const lease = claudeManaged.acquire();
          return lease === null
            ? null
            : {
                path: lease.binPath,
                version: lease.version !== '' ? lease.version : null,
                release: lease.release,
              };
        },
        teamSkillsCacheDir: paths.teamSkillsCacheDir,
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
  const loadedFromDisk = machineJson !== null;
  const probedHost = probeHostIdentity(
    paths.home,
    opts.hostIdentitySources,
    opts.legacyRunnerHomes,
  );
  const hostKey = probedHost?.hostKey ?? machineJson?.hostKey ?? null;
  const legacyHostKeys = collectLegacyHostKeys(hostKey, [
    ...(probedHost?.legacyHostKeys ?? []),
    machineJson?.hostKey,
  ]);
  if (machineJson && machineJson.serverUrl !== config.serverUrl) {
    logger.machine(
      `enrolled against ${machineJson.serverUrl} but polling ${config.serverUrl} — if auth fails, re-enroll: logout, then start --api-key <k> --team <id>`,
    );
  }
  if (!machineJson) {
    if (!config.apiKey || !config.teamId) {
      const enrolled = await enrollThroughBrowser(
        client,
        paths,
        config.serverUrl,
        config.name,
        {
          now: () => Date.now(),
          sleep,
          log: (line) => logger.raw(line),
        },
        hostKey ?? undefined,
        legacyHostKeys,
      );
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
        hostKey: hostKey ?? undefined,
        ...(legacyHostKeys.length > 0 ? { legacyHostKeys } : {}),
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
  if (!loadedFromDisk && hostKey !== null && machineJson.hostKey !== hostKey) {
    machineJson = { ...machineJson, hostKey };
    saveMachineJson(paths, machineJson);
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

  let networkFailures = 0;
  let connectionId: string | null = null;
  const presenceReporter = new ComputerPresenceReporter({
    source: opts.computerPresence ?? hostDesktops,
    body: () => ({
      connectionId,
      cliVersion: DAEMON_VERSION,
      claudeCode: claudeReport(),
      capabilities: capabilitiesReport(),
      hostKey: hostKey ?? undefined,
      ...(legacyHostKeys.length > 0 ? { legacyHostKeys } : {}),
    }),
    timeoutMs: opts.presenceTimeoutMs ?? PRESENCE_TIMEOUT_MS,
    send: async (body, signal) => {
      const response = await client.presence(body, signal);
      if (hostKey !== null && machineJson !== null && machineJson.hostKey === undefined) {
        machineJson = { ...machineJson, hostKey };
        saveMachineJson(paths, machineJson);
      }
      phones.setConsented(response.phones ?? []);
      if (
        response.installDevin === true &&
        !devinInstalling &&
        Date.now() >= devinEnsureRetryAt &&
        (!devinEnsured || devinManaged.current() === null)
      ) {
        devinInstalling = true;
        devinEnsureRetryAt = Date.now() + (opts.devinEnsureRetryMs ?? MANAGED_ENSURE_RETRY_MS);
        void trackInstall(devinManaged.ensure())
          .then(
            (install) => {
              devinEnsured = install !== null;
              if (install !== null) {
                devinEnsureRetryAt = 0;
                if (sendPresenceNow !== null) return sendPresenceNow();
              }
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
  sendPresenceNow = () => presenceReporter.send();
  const probeHarnesses = async () => {
    const claudeBin = activeClaudeBin();
    logger.machine(
      claudeBin
        ? `claude binary: ${claudeBin.path}${claudeBin.version !== null ? ` (${claudeBin.version})` : ''} [${claudeBin.source}]`
        : 'claude binary: no managed install (SDK platform package missing)',
    );

    if (claudeAuth === null) await probeAuthAndRemember();
    checkRuntimeUpdates();
  };
  try {
    for (let backoff = opts.claimBackoffBaseMs ?? 1_000; ; backoff = nextBackoffMs(backoff)) {
      try {
        await client.me();
        await presenceReporter.send();
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

  const orbCap = resolveOrbCap(capEnv);
  const idleStop = Number(capEnv.CAIRN_ORB_IDLE_STOP_MS);
  const orbs = new OrbLifecycle(orbProvider, {
    max: orbCap,
    onStopped: (handle) => relayOrbStopped(stepDeps(), handle),
    log: (message) => logger.workspace(message),
    ...(Number.isFinite(idleStop) && idleStop > 0 ? { idleStopMs: idleStop } : {}),
  });

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
  const stepTreeMarkers = new Map<string, string>();
  const stops = new StepStops();
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

  await Promise.all(
    journal.treeMarkers().map(async (value) => {
      try {
        const reaped = await new StepReaper(
          { env: STEP_TREE_ENV, value },
          STEP_REAP_GRACE_MS,
        ).reap();
        if (reaped > 0)
          logger.recover(`reaped ${reaped} leftover processes for step tree marker=${value}`);
      } catch (error) {
        logger.recover(
          `leftover step tree reap failed marker=${value}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  const sweepStepScratch = () => {
    try {
      const removed = sweepStepAttachments(paths.stepAttachmentsDir, { now: Date.now() });
      if (removed.length > 0) {
        logger.workspace(`step-attachments recycled: ${removed.length} (${removed.join(', ')})`);
      }
      const stagedRemoved = sweepStagedUploads(stagingRoot, { now: Date.now() });
      if (stagedRemoved.length > 0) {
        logger.workspace(
          `staged-uploads recycled: ${stagedRemoved.length} (${stagedRemoved.join(', ')})`,
        );
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

  const inFlight = new Map<string, Promise<void>>();
  const launchStepRun = (claimed: ClaimedStep, options: RunStepOptions) => {
    const stepId = claimed.step.id;
    const launched = runOrbStep(orbs, stepDeps(), claimed, options)
      .catch((err: unknown) => {
        logger.step(
          `runStep crashed (step may need recover): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        inFlight.delete(stepId);
        workerSlots.delete(stepId);
      });
    inFlight.set(stepId, launched);
  };

  let recoveryPending = true;
  const recover = async () => {
    if (!recoveryPending) return;
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
          launchStepRun(claimed, {
            resume: { sessionId: entry.sessionId, prompt: entry.prompt },
            running: inFlight.size + 1,
            ...(entry.stopRequest != null ? { stopRequest: entry.stopRequest } : {}),
            ...(claimed.step.kind === 'chief' ? {} : { env: workerEnv(stepRecord.id) }),
          });
        } else {
          logger.recover(`step ${stepRecord.id} has no local journal — reporting failed`);
          await client.done(stepRecord.id, {
            status: 'failed',
            errorMessage: 'daemon journal lost across restart',
            generation: stepRecord.generation,
          });
        }
      }
    }
  };
  await recover();

  const streamCtrl = new AbortController();
  const deliverSteer = async (stepId: string): Promise<void> => {
    const client = bindMachineClaim(
      stepDeps().client,
      stepId,
      journal.get(stepId)?.claimed?.step.generation,
    );
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
    const client = bindMachineClaim(
      stepDeps().client,
      stepId,
      journal.get(stepId)?.claimed?.step.generation,
    );
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
    ...(hostConfinement ? { hostConfinement } : {}),
    stagingRoot,
    ...(hostScreen ? { screen: hostScreen } : {}),
    ...(orbComputer ? { orb: orbComputer } : {}),
    phones,
    cairnOrigins,
    stepTreeMarkers,
  });
  const imsgBridge = createImsgBridge({ api: client, logger, home: config.home });
  const deliverAntigravityModelProbe = async (
    requestId: string,
    connectionId: string,
    signal: AbortSignal,
  ) => {
    if (!client.claimAntigravityModelProbe || !client.finishAntigravityModelProbe) return;
    try {
      const token = await client.claimAntigravityModelProbe(
        requestId,
        connectionId,
        AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
      );
      const install = antigravityManaged.current();
      const result =
        install === null
          ? ({ status: 'failed', failure: 'not-found' } as const)
          : await (() => {
              const version = install.version;
              activeAntigravityVersions.set(
                version,
                (activeAntigravityVersions.get(version) ?? 0) + 1,
              );
              return probeAntigravitySubscriptionModels(install, token, paths.home, signal)
                .catch(() => ({ status: 'failed', failure: 'upstream' }) as const)
                .finally(() => {
                  const next = (activeAntigravityVersions.get(version) ?? 1) - 1;
                  if (next > 0) activeAntigravityVersions.set(version, next);
                  else activeAntigravityVersions.delete(version);
                });
            })();
      await client.finishAntigravityModelProbe(
        requestId,
        connectionId,
        result,
        AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      );
    } catch {
      if (!signal.aborted) logger.machine('Antigravity subscription model probe delivery failed');
    }
  };
  const MAX_CONCURRENT_ANTIGRAVITY_VERIFIES = 4;
  let activeAntigravityVerifies = 0;
  let presenceQueuedAfterVerify = false;
  const runAntigravityVerify = async (checkId: string) => {
    if (
      stopping ||
      streamCtrl.signal.aborted ||
      activeAntigravityVerifies >= MAX_CONCURRENT_ANTIGRAVITY_VERIFIES
    ) {
      return;
    }
    activeAntigravityVerifies += 1;
    const started = performance.now();
    try {
      let outcome: AntigravityProbeOutcome;
      try {
        if (antigravityManaged.probeDetailed !== undefined) {
          outcome = await antigravityManaged.probeDetailed();
        } else {
          const probed = await antigravityManaged.probe();
          outcome = probed !== null ? { kind: 'ok', install: probed } : { kind: 'not-installed' };
        }
      } catch (err: unknown) {
        outcome = {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (stopping || streamCtrl.signal.aborted) return;
      const durationMs = Math.min(Math.max(0, Math.round(performance.now() - started)), 300_000);
      const probed = outcome.kind === 'ok' ? outcome.install : null;
      const version =
        probed !== null && probed.version.length > 0 ? probed.version.slice(0, 64) : undefined;
      const models =
        probed !== null
          ? probed.models
              .filter((model) => model.id.length > 0 && model.name.length > 0)
              .slice(0, 500)
              .map((model) => ({
                ...model,
                id: model.id.slice(0, 256),
                name: model.name.slice(0, 256),
              }))
          : undefined;
      const installed =
        outcome.kind === 'ok'
          ? true
          : outcome.kind === 'timeout'
            ? true
            : outcome.kind === 'not-installed'
              ? false
              : antigravityManaged.current() !== null;
      const signal = AbortSignal.any([streamCtrl.signal, AbortSignal.timeout(15_000)]);
      await client
        .reportAntigravityVerify?.(
          {
            checkId,
            installed,
            authenticated: probed?.authenticated === true,
            ...(outcome.kind === 'timeout' ? { timedOut: true } : {}),
            ...(version !== undefined ? { version } : {}),
            ...(probed !== null ? { source: probed.source } : {}),
            ...(models !== undefined ? { models } : {}),
            durationMs,
            ...(outcome.kind === 'error' ? { error: outcome.message.slice(0, 500) } : {}),
          },
          signal,
        )
        .catch((reportErr: unknown) =>
          logger.machine(
            `antigravity verify report failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`,
          ),
        );
      if (sendPresenceNow !== null && !presenceQueuedAfterVerify) {
        presenceQueuedAfterVerify = true;
        void sendPresenceNow()
          .catch(() => {})
          .finally(() => {
            presenceQueuedAfterVerify = false;
          });
      }
    } finally {
      activeAntigravityVerifies -= 1;
    }
  };
  void (async () => {
    let backoff = 1_000;
    let announced = false;
    let reportedDown = false;
    while (!streamCtrl.signal.aborted) {
      const streamSession = new AbortController();
      const probeSignal = AbortSignal.any([streamCtrl.signal, streamSession.signal]);
      try {
        await client.stream(
          streamCtrl.signal,
          (ev) => {
            if (ev.type === 'hello') connectionId = ev.connectionId;
            if (ev.type === 'shutdown') void stop();
            if (ev.type === 'steer') void deliverSteer(ev.stepId);
            if (ev.type === 'stop') void deliverStop(ev.stepId);
            if (ev.type === 'task.stop') {
              const handle = sessionHandles.get(ev.stepId);
              logger.step(
                `background task stop requested step=${ev.stepId} task=${ev.taskId} session=${handle === undefined ? 'none' : handle.stopTask === undefined ? 'unsupported' : 'live'}`,
              );
              void handle
                ?.stopTask?.(ev.taskId)
                .then(() => logger.step(`background task stop delivered task=${ev.taskId}`))
                .catch((err: unknown) =>
                  logger.step(
                    `background task stop failed: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
            }
            if (ev.type === 'repo.archive') {
              void performRepoArchive({ client, logger }, ev.archive);
            }
            if (ev.type === 'antigravity.models' && connectionId !== null) {
              void deliverAntigravityModelProbe(ev.requestId, connectionId, probeSignal);
            }
            if (ev.type === 'antigravity.verify') {
              void runAntigravityVerify(ev.checkId);
            }
            if (ev.type === 'computer') void computerDispatcher.dispatch(ev.call);
            if (ev.type === 'computer.screen') void screens.dispatch(ev.channel);
            if (ev.type === 'runtime.update') {
              const runtime = managedRuntimes[ev.runtime];
              void trackInstall(runtime.update()).catch((error: unknown) => {
                logger.machine(
                  `${ev.runtime} update failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              });
            }
            if (ev.type === 'im.attach' || ev.type === 'im.detach' || ev.type === 'im.send') {
              imsgBridge.handle(ev);
            }
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
      } finally {
        streamSession.abort();
      }
      if (streamCtrl.signal.aborted) return;
      await sleep(backoff);
      backoff = nextBackoffMs(backoff);
    }
  })();

  let antigravityRetryAt = 0;
  let antigravityReprobeAt = Date.now() + (opts.antigravityReprobeMs ?? ANTIGRAVITY_REPROBE_MS);
  let antigravityUpdateCheckAt =
    Date.now() + (opts.antigravityUpdateCheckMs ?? ANTIGRAVITY_UPDATE_CHECK_MS);
  const presenceTimer = setInterval(() => {
    const currentAg = antigravityManaged.current();
    const now = Date.now();
    if (currentAg === null) {
      if (now >= antigravityRetryAt) {
        antigravityRetryAt = now + (opts.antigravityEnsureRetryMs ?? MANAGED_ENSURE_RETRY_MS);
        void trackInstall(antigravityManaged.ensure())
          .then((install) => {
            if (install === null) return;
            antigravityRetryAt = 0;
            antigravityUpdateCheckAt =
              Date.now() + (opts.antigravityUpdateCheckMs ?? ANTIGRAVITY_UPDATE_CHECK_MS);
            if (sendPresenceNow !== null) return sendPresenceNow();
          })
          .catch((error: unknown) => {
            logger.machine(
              `antigravity managed ensure failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }
    } else if (now >= antigravityUpdateCheckAt) {
      antigravityUpdateCheckAt =
        now + (opts.antigravityUpdateCheckMs ?? ANTIGRAVITY_UPDATE_CHECK_MS);
      antigravityReprobeAt = now + (opts.antigravityReprobeMs ?? ANTIGRAVITY_REPROBE_MS);
      void trackInstall(antigravityManaged.ensure())
        .then((install) => {
          if (install !== null && install.version !== currentAg.version && sendPresenceNow !== null)
            return sendPresenceNow();
        })
        .catch((error: unknown) => {
          logger.machine(
            `antigravity managed update check failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    } else if (!currentAg.authenticated || now >= antigravityReprobeAt) {
      if (currentAg.authenticated) {
        antigravityReprobeAt = now + (opts.antigravityReprobeMs ?? ANTIGRAVITY_REPROBE_MS);
      }
      const before: AntigravityInstall = currentAg;
      void antigravityManaged
        .probe()
        .then((after) => {
          if (stopping || sendPresenceNow === null) return;
          const changed =
            after === null ||
            before.authenticated !== after.authenticated ||
            before.version !== after.version ||
            JSON.stringify(before.models) !== JSON.stringify(after.models);
          if (changed) return sendPresenceNow();
        })
        .catch(() => {});
    }
    checkRuntimeUpdates();
    void probeAuthAndRemember()
      .then(() => presenceReporter.send())
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
      stepTreeMarkers,
      stops,
      machineName: config.name,
      ...(daemonOtel !== null ? { otel: daemonOtel } : {}),
      ...(opts.heartbeatIntervalMs !== undefined
        ? { heartbeatIntervalMs: opts.heartbeatIntervalMs }
        : {}),
    };
  }

  const strandedMinAgeMs = opts.strandedUploadMinAgeMs ?? STRANDED_UPLOAD_MIN_AGE_MS;
  const strandedAttempts = new Map<string, number>();
  let replayingStranded = false;
  const replayStrandedUploads = async () => {
    if (replayingStranded || stopping) return;
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
      if (orbProvider.kind === 'orb' && inFlight.size >= orbCap) {
        await Promise.race(inFlight.values());
        continue;
      }
      let step: ClaimedStep | null = null;
      try {
        step = await client.claim(
          AbortSignal.any([claimCtrl.signal, AbortSignal.timeout(claimTimeoutMs)]),
          orbProvider.kind === 'orb' ? { maxWorkers: orbCap } : undefined,
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
      const stepEnv = step.step.kind === 'chief' ? undefined : workerEnv(stepId);
      launchStepRun(step, {
        running: inFlight.size + 1,
        ...(stepEnv !== undefined ? { env: stepEnv } : {}),
      });
    }
    await Promise.allSettled([...inFlight.values()]);
  })();

  async function stop(cause?: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.machine(`Shutting down…${cause ? ` (${cause})` : ''}`);
    clearInterval(presenceTimer);
    clearInterval(strandedTimer);
    clearInterval(orphanTimer);
    orbCleanupStopped = true;
    clearInterval(closedOrbTimer);
    clearInterval(orbTimer);
    clearInterval(desktopSweepTimer);
    clearInterval(stepScratchTimer);
    streamCtrl.abort();
    claimCtrl.abort();
    imsgBridge.stop();
    installStop.abort();
    void screens.close();
    caffeinate?.kill();
    await Promise.allSettled([...pendingInstalls]);
    await presenceReporter.close();
    if (connectionId !== null && client.offline) {
      await client
        .offline({ connectionId }, AbortSignal.timeout(GOODBYE_TIMEOUT_MS))
        .catch((err: unknown) => {
          logger.machine(`goodbye failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    await computerDispatcher.close();
    await closeOwnerChrome();
    hostDesktops?.close();
  }

  return {
    machineId,
    stop,
    done,
  };
}
