import semver from 'semver';
import { z } from 'zod';
import { THINKING_LEVELS, thinkingLevelSchema } from '../thinking-levels.js';
import { reportedModelSchema, runtimeUpdateStatusSchema } from './model-source.js';

export const machineHardwareSchema = z.object({
  cpuCores: z.number().int().positive(),
  memoryTotalMb: z.number().int().nonnegative().optional(),
  memoryAvailableMb: z.number().int().nonnegative(),
  loadAvg1: z.number().nonnegative(),
  loadAvg5: z.number().nonnegative().optional(),
  cpuUtilization: z.number().min(0).max(1).optional(),
  memoryPressure: z.number().min(0).max(1).optional(),
  diskFreeMb: z.number().int().nonnegative(),
});
export type MachineHardware = z.infer<typeof machineHardwareSchema>;

export const MACHINE_STRAIN_REASONS = ['memory', 'cpu', 'disk'] as const;
export const machineStrainReasonSchema = z.enum(MACHINE_STRAIN_REASONS);
export type MachineStrainReason = z.infer<typeof machineStrainReasonSchema>;

export const STRAIN_MEMORY_AVAILABLE_RATIO = 0.1;
export const STRAIN_MEMORY_PRESSURE = 1 - STRAIN_MEMORY_AVAILABLE_RATIO;
export const STRAIN_CPU_UTILIZATION = 0.9;
export const STRAIN_DISK_FREE_MB = 5 * 1024;

function memoryPressureOf(hardware: MachineHardware): number | null {
  if (hardware.memoryPressure !== undefined) return hardware.memoryPressure;
  const total = hardware.memoryTotalMb;
  if (total === undefined || total <= 0) return null;
  return 1 - hardware.memoryAvailableMb / total;
}

export function machineStrain(hardware: MachineHardware | null | undefined): MachineStrainReason[] {
  if (hardware == null) return [];
  const reasons: MachineStrainReason[] = [];
  const pressure = memoryPressureOf(hardware);
  if (pressure !== null && pressure >= STRAIN_MEMORY_PRESSURE) reasons.push('memory');
  if (hardware.cpuUtilization !== undefined && hardware.cpuUtilization >= STRAIN_CPU_UTILIZATION) {
    reasons.push('cpu');
  }
  if (hardware.diskFreeMb < STRAIN_DISK_FREE_MB) reasons.push('disk');
  return reasons;
}

export const machineExecutorSchema = z.enum(['orb', 'host']);
export type MachineExecutor = z.infer<typeof machineExecutorSchema>;

const codexLoginSchema = z.object({
  state: z.enum(['ok', 'expired', 'absent', 'unknown']),
  expiresAt: z.number().int().nonnegative().optional(),
});

const machineOsPlatformSchema = z.enum(['linux', 'darwin', 'windows', 'other']);
export type MachineOsPlatform = z.infer<typeof machineOsPlatformSchema>;

export function osPlatformOf(nodePlatform: string): MachineOsPlatform {
  if (nodePlatform === 'linux' || nodePlatform === 'darwin') return nodePlatform;
  return nodePlatform === 'win32' ? 'windows' : 'other';
}

export const RUNNER_OS = ['linux', 'macos', 'windows'] as const;
export const runnerOsSchema = z.enum(RUNNER_OS);
export type RunnerOs = z.infer<typeof runnerOsSchema>;
export const RUNNER_OS_LABELS: Record<RunnerOs, string> = {
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
};

export function runnerOsOf(
  capabilities: { osPlatform?: MachineOsPlatform } | null | undefined,
): RunnerOs | null {
  const platform = capabilities?.osPlatform;
  if (platform === 'darwin') return 'macos';
  return platform === 'linux' || platform === 'windows' ? platform : null;
}

export const devinReportSchema = z
  .object({
    installed: z.boolean(),
    version: z.string().min(1).max(64).optional(),
    models: z.array(reportedModelSchema).optional(),
    update: runtimeUpdateStatusSchema.optional(),
  })
  .strict();
export type DevinReport = z.infer<typeof devinReportSchema>;

export const geminiReportSchema = z
  .object({
    installed: z.boolean(),
    version: z.string().min(1).max(64).optional(),
    update: runtimeUpdateStatusSchema.optional(),
  })
  .strict();
export type GeminiReport = z.infer<typeof geminiReportSchema>;

export const antigravityModelSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  thinkingLevels: z.array(thinkingLevelSchema).max(THINKING_LEVELS.length).optional(),
  thinkingDefault: thinkingLevelSchema.optional(),
});

export const antigravityReportSchema = z
  .object({
    installed: z.boolean(),
    version: z.string().min(1).max(64).optional(),
    authenticated: z.boolean().optional(),
    source: z.enum(['local', 'managed']).optional(),
    models: z.array(antigravityModelSchema).max(500).optional(),
  })
  .strict();
export type AntigravityReport = z.infer<typeof antigravityReportSchema>;

export const doubaoModelSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  thinkingLevels: z.array(thinkingLevelSchema).max(THINKING_LEVELS.length).optional(),
  thinkingDefault: thinkingLevelSchema.optional(),
});
export type DoubaoModel = z.infer<typeof doubaoModelSchema>;

export const doubaoReportSchema = z
  .object({
    installed: z.boolean(),
    authenticated: z.boolean().optional(),
    platformSupported: z.boolean().optional(),
    version: z.string().min(1).max(64).optional(),
    models: z.array(doubaoModelSchema).max(2000).optional(),
    probedAt: z.number().int().nonnegative().optional(),
    switchedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DoubaoReport = z.infer<typeof doubaoReportSchema>;

export function pickNewerDoubaoReport(
  previous: DoubaoReport | undefined,
  incoming: DoubaoReport | undefined,
): DoubaoReport | undefined {
  if (incoming === undefined) return previous;
  if (previous === undefined) return incoming;
  const prevAt = previous.probedAt ?? 0;
  const nextAt = incoming.probedAt ?? 0;
  const chosen = prevAt > nextAt ? previous : incoming;
  const switchedAt = Math.max(previous.switchedAt ?? 0, incoming.switchedAt ?? 0);
  return switchedAt > 0 ? { ...chosen, switchedAt } : chosen;
}

export const agentReachReportSchema = z.object({
  version: z.string().min(1).max(32),
  channels: z
    .array(z.object({ channel: z.string().min(1).max(32), status: z.string().min(1).max(32) }))
    .max(64),
});
export type AgentReachReport = z.infer<typeof agentReachReportSchema>;

const permissionStateSchema = z.enum(['granted', 'not_required', 'denied', 'unknown']);
export type PermissionState = z.infer<typeof permissionStateSchema>;

export const hostPermissionsSchema = z
  .object({
    accessibility: permissionStateSchema,
    automation: permissionStateSchema,
    screenRecording: permissionStateSchema,
  })
  .strict();
export type HostPermissions = z.infer<typeof hostPermissionsSchema>;

export const MACHINE_PHONE_PLATFORMS = ['android', 'ios'] as const;
export type MachinePhonePlatform = (typeof MACHINE_PHONE_PLATFORMS)[number];

export const MACHINE_PHONE_LINK_STATES = [
  'seen',
  'unauthorized',
  'ready',
  'locked',
  'offline',
  'signing_expired',
] as const;
export type MachinePhoneLinkState = (typeof MACHINE_PHONE_LINK_STATES)[number];

export const machinePhoneReportSchema = z.object({
  deviceId: z.string().min(1).max(256),
  platform: z.enum(MACHINE_PHONE_PLATFORMS),
  name: z.string().min(1).max(200),
  link: z.enum(MACHINE_PHONE_LINK_STATES),
});
export type MachinePhoneReport = z.infer<typeof machinePhoneReportSchema>;

export const legacyConfinementReportSchema = z
  .object({
    state: z.enum(['checking', 'ready', 'not-applicable', 'unavailable']),
    invocation: z.uuid(),
    generation: z.number().int().positive(),
    revision: z.number().int().positive(),
    reason: z.enum(['startup-failed', 'cleanup-failed', 'unsupported-platform']).optional(),
  })
  .strict();

export const GITHUB_PUSH_REPO_STATES = ['write', 'no-write', 'unauthenticated', 'unknown'] as const;
export const githubPushRepoStateSchema = z.enum(GITHUB_PUSH_REPO_STATES);
export type GithubPushRepoState = z.infer<typeof githubPushRepoStateSchema>;

export const GITHUB_PUSH_LOGIN_STATES = ['ok', 'unauthenticated', 'unknown'] as const;
export const githubPushLoginStateSchema = z.enum(GITHUB_PUSH_LOGIN_STATES);
export type GithubPushLoginState = z.infer<typeof githubPushLoginStateSchema>;

export const GITHUB_PUSH_MAX_REPOS = 200;
export const GITHUB_PUSH_REPORT_MAX_AGE_MS = 15 * 60_000;

export const githubPushRepoEntrySchema = z
  .object({
    repo: z
      .string()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
    state: githubPushRepoStateSchema,
    checkedAt: z.number().int().nonnegative(),
  })
  .strict();
export type GithubPushRepoEntry = z.infer<typeof githubPushRepoEntrySchema>;

export const githubPushReportSchema = z
  .object({
    login: githubPushLoginStateSchema,
    checkedAt: z.number().int().nonnegative(),
    repos: z.array(githubPushRepoEntrySchema).max(GITHUB_PUSH_MAX_REPOS),
  })
  .strict();
export type GithubPushReport = z.infer<typeof githubPushReportSchema>;

export const RUNNER_AUTO_UPDATE_STATES = [
  'idle',
  'downloading',
  'waiting-idle',
  'swapping',
  'rolled-back',
  'unsupported',
  'failed',
] as const;
export const runnerAutoUpdateStateSchema = z.enum(RUNNER_AUTO_UPDATE_STATES);
export type RunnerAutoUpdateState = z.infer<typeof runnerAutoUpdateStateSchema>;

export const RUNNER_AUTO_UPDATE_REASONS = [
  'desktop-bundled',
  'homebrew',
  'docker',
  'development',
  'read-only',
  'no-asset',
  'offline',
  'checksum-mismatch',
  'smoke-failed',
  'blocked',
  'rollback-failed',
  'failed',
] as const;
export const runnerAutoUpdateReasonSchema = z.enum(RUNNER_AUTO_UPDATE_REASONS);
export type RunnerAutoUpdateReason = z.infer<typeof runnerAutoUpdateReasonSchema>;

export const runnerAutoUpdateReportSchema = z
  .object({
    supported: z.boolean(),
    state: runnerAutoUpdateStateSchema,
    targetVersion: z.string().min(1).max(64).nullable().optional(),
    reason: runnerAutoUpdateReasonSchema.nullable().optional(),
    failedVersion: z.string().min(1).max(64).nullable().optional(),
    restoredVersion: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();
export type RunnerAutoUpdateReport = z.infer<typeof runnerAutoUpdateReportSchema>;

export const machineCapabilitiesSchema = z.object({
  osPlatform: machineOsPlatformSchema.optional(),
  osDistribution: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/)
    .optional(),
  computerName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\P{C}+$/u)
    .optional(),
  hostname: z.string().min(1).max(253).optional(),
  mcpServers: z.array(z.string()),
  skills: z.array(z.string()),
  hardware: machineHardwareSchema.optional(),
  executor: machineExecutorSchema.optional(),
  computer: z.literal(true).optional(),
  ownComputer: z.literal(true).optional(),
  ownComputerShell: z.literal(true).optional(),
  browser: z.literal(true).optional(),
  browserSecretFill: z.literal(true).optional(),
  stealthBrowser: z.literal(true).optional(),
  screenHandoff: z.literal(true).optional(),
  ownerChrome: z.literal(true).optional(),
  computerKind: z.preprocess(
    (value) => (value === 'host' ? 'host' : undefined),
    z.literal('host').optional(),
  ),
  secretGateway: z.literal(true).optional(),
  mcpConnectors: z.literal(true).optional(),
  claimGeneration: z.literal(true).optional(),
  runnerProtocolVersion: z.number().int().nonnegative().max(1_000_000).optional(),
  runnerReleaseVersion: z.string().min(1).max(64).optional(),
  runnerAutoUpdate: runnerAutoUpdateReportSchema.optional(),
  codexLogin: codexLoginSchema.optional(),
  devin: devinReportSchema.optional(),
  gemini: geminiReportSchema.optional(),
  antigravity: antigravityReportSchema.optional(),
  doubao: doubaoReportSchema.optional(),
  antigravityOAuthProfile: z.literal(true).optional(),
  antigravitySubscriptionModels: z.literal(true).optional(),
  antigravityUsage: z.literal(true).optional(),
  agentReach: agentReachReportSchema.optional(),
  scrapling: z.object({ version: z.string().min(1).max(32) }).optional(),
  hostPermissions: hostPermissionsSchema.optional(),
  phoneHost: z.literal(true).optional(),
  phones: z.array(machinePhoneReportSchema).optional(),
  confinement: legacyConfinementReportSchema.optional(),
  githubPush: githubPushReportSchema.optional(),
});
export type MachineCapabilities = z.infer<typeof machineCapabilitiesSchema>;

export function parseReportedCapabilities(raw: unknown): MachineCapabilities | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const base = z
    .object({
      mcpServers: z.array(z.string()),
      skills: z.array(z.string()),
    })
    .safeParse({ mcpServers: rec.mcpServers, skills: rec.skills });
  if (!base.success) return undefined;
  const osPlatform = machineOsPlatformSchema.safeParse(rec.osPlatform);
  const osDistribution = machineCapabilitiesSchema.shape.osDistribution.safeParse(
    rec.osDistribution,
  );
  const hardware = machineHardwareSchema.safeParse(rec.hardware);
  const executor = machineExecutorSchema.safeParse(rec.executor);
  const codexLogin = codexLoginSchema.safeParse(rec.codexLogin);
  const devin = devinReportSchema.safeParse(rec.devin);
  const gemini = geminiReportSchema.safeParse(rec.gemini);
  const antigravity = antigravityReportSchema.safeParse(rec.antigravity);
  const doubao = doubaoReportSchema.safeParse(rec.doubao);
  const agentReach = agentReachReportSchema.safeParse(rec.agentReach);
  const scrapling = machineCapabilitiesSchema.shape.scrapling.safeParse(rec.scrapling);
  const hostPermissions = hostPermissionsSchema.safeParse(rec.hostPermissions);
  const phones = z.array(machinePhoneReportSchema).max(32).safeParse(rec.phones);
  const computerName = machineCapabilitiesSchema.shape.computerName.safeParse(rec.computerName);
  const reportedHostname = machineCapabilitiesSchema.shape.hostname.safeParse(rec.hostname);
  const runnerProtocolVersion = machineCapabilitiesSchema.shape.runnerProtocolVersion.safeParse(
    rec.runnerProtocolVersion,
  );
  const runnerReleaseVersion = machineCapabilitiesSchema.shape.runnerReleaseVersion.safeParse(
    rec.runnerReleaseVersion,
  );
  const runnerAutoUpdate = runnerAutoUpdateReportSchema.safeParse(rec.runnerAutoUpdate);
  const confinement = legacyConfinementReportSchema.safeParse(rec.confinement);
  const githubPush = githubPushReportSchema.safeParse(rec.githubPush);
  return {
    ...base.data,
    ...(osPlatform.success ? { osPlatform: osPlatform.data } : {}),
    ...(osDistribution.success && osDistribution.data !== undefined
      ? { osDistribution: osDistribution.data }
      : {}),
    ...(computerName.success && computerName.data !== undefined
      ? { computerName: computerName.data }
      : {}),
    ...(reportedHostname.success && reportedHostname.data !== undefined
      ? { hostname: reportedHostname.data }
      : {}),
    ...(codexLogin.success ? { codexLogin: codexLogin.data } : {}),
    ...(devin.success ? { devin: devin.data } : {}),
    ...(gemini.success ? { gemini: gemini.data } : {}),
    ...(antigravity.success ? { antigravity: antigravity.data } : {}),
    ...(doubao.success ? { doubao: doubao.data } : {}),
    ...(rec.antigravityOAuthProfile === true ? { antigravityOAuthProfile: true } : {}),
    ...(rec.antigravitySubscriptionModels === true ? { antigravitySubscriptionModels: true } : {}),
    ...(rec.antigravityUsage === true ? { antigravityUsage: true } : {}),
    ...(agentReach.success ? { agentReach: agentReach.data } : {}),
    ...(scrapling.success && scrapling.data !== undefined ? { scrapling: scrapling.data } : {}),
    ...(hostPermissions.success ? { hostPermissions: hostPermissions.data } : {}),
    ...(hardware.success ? { hardware: hardware.data } : {}),
    ...(executor.success ? { executor: executor.data } : {}),
    ...(rec.computer === true ? { computer: true as const } : {}),
    ...(rec.ownComputer === true ? { ownComputer: true as const } : {}),
    ...(rec.ownComputerShell === true ? { ownComputerShell: true as const } : {}),
    ...(rec.browser === true ? { browser: true as const } : {}),
    ...(rec.browserSecretFill === true ? { browserSecretFill: true as const } : {}),
    ...(rec.stealthBrowser === true ? { stealthBrowser: true as const } : {}),
    ...(rec.screenHandoff === true ? { screenHandoff: true as const } : {}),
    ...(rec.ownerChrome === true ? { ownerChrome: true as const } : {}),
    ...(rec.computerKind === 'host' ? { computerKind: 'host' as const } : {}),
    ...(rec.secretGateway === true ? { secretGateway: true as const } : {}),
    ...(rec.mcpConnectors === true ? { mcpConnectors: true as const } : {}),
    ...(rec.claimGeneration === true ? { claimGeneration: true as const } : {}),
    ...(runnerProtocolVersion.success && runnerProtocolVersion.data !== undefined
      ? { runnerProtocolVersion: runnerProtocolVersion.data }
      : {}),
    ...(runnerReleaseVersion.success && runnerReleaseVersion.data !== undefined
      ? { runnerReleaseVersion: runnerReleaseVersion.data }
      : {}),
    ...(runnerAutoUpdate.success ? { runnerAutoUpdate: runnerAutoUpdate.data } : {}),
    ...(rec.phoneHost === true ? { phoneHost: true as const } : {}),
    ...(phones.success && phones.data !== undefined ? { phones: phones.data } : {}),
    ...(confinement.success ? { confinement: confinement.data } : {}),
    ...(githubPush.success ? { githubPush: githubPush.data } : {}),
  };
}

export const RUNNER_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_RUNNER_PROTOCOL = 0;

export function runnerProtocolOf(
  capabilities: Pick<MachineCapabilities, 'runnerProtocolVersion'> | null | undefined,
): number {
  return capabilities?.runnerProtocolVersion ?? 0;
}

export function runnerOutOfWindow(
  capabilities: MachineCapabilities | null | undefined,
  floor: number,
): boolean {
  return runnerProtocolOf(capabilities) < floor;
}

export function runnerNeedsUpdate(capabilities: MachineCapabilities | null | undefined): boolean {
  return capabilities != null && runnerProtocolOf(capabilities) < RUNNER_PROTOCOL_VERSION;
}

export function runnerNeedsVersionUpdate(
  capabilities:
    | Pick<
        MachineCapabilities,
        'runnerProtocolVersion' | 'runnerReleaseVersion' | 'runnerAutoUpdate'
      >
    | null
    | undefined,
  targetVersion: string | null | undefined,
): boolean {
  if (capabilities == null) return false;
  if (runnerProtocolOf(capabilities) < RUNNER_PROTOCOL_VERSION) return true;
  if (targetVersion == null) return false;
  const parsedTarget = semver.valid(targetVersion);
  if (parsedTarget === null || parsedTarget === '0.0.0') return false;
  const current = capabilities.runnerReleaseVersion;
  if (current === undefined) {
    return (
      capabilities.runnerAutoUpdate?.supported === true &&
      capabilities.runnerAutoUpdate.state !== 'unsupported'
    );
  }
  const parsedCurrent = semver.valid(current);
  if (parsedCurrent === null || parsedCurrent === '0.0.0') {
    return (
      capabilities.runnerAutoUpdate?.supported === true &&
      capabilities.runnerAutoUpdate.state !== 'unsupported'
    );
  }
  return semver.lt(parsedCurrent, parsedTarget);
}

export function runsLegacyMacSandbox(
  capabilities: Pick<MachineCapabilities, 'osPlatform' | 'confinement'> | null | undefined,
): boolean {
  const state = capabilities?.confinement?.state;
  return capabilities?.osPlatform === 'darwin' && state !== undefined && state !== 'not-applicable';
}

export function parseStoredCapabilities(raw: unknown): MachineCapabilities | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return parseReportedCapabilities(raw) ?? null;
}

export function mergeReportedCapabilities(
  previous: MachineCapabilities | null | undefined,
  reported: MachineCapabilities,
): MachineCapabilities {
  let next = reported;
  if (next.osPlatform === undefined && previous?.osPlatform !== undefined) {
    next = { ...next, osPlatform: previous.osPlatform };
  }
  if (next.hardware === undefined && previous?.hardware !== undefined) {
    next = { ...next, hardware: previous.hardware };
  }
  const mergedDoubao = pickNewerDoubaoReport(previous?.doubao, next.doubao);
  if (mergedDoubao !== undefined && mergedDoubao !== next.doubao) {
    next = { ...next, doubao: mergedDoubao };
  }
  return next;
}

export const requiredCapabilitiesSchema = z.object({
  mcpServers: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  executor: z.literal('orb').optional(),
  os: runnerOsSchema.optional(),
});
export type RequiredCapabilities = z.infer<typeof requiredCapabilitiesSchema>;

export function capabilityMissingLabels(missing: {
  mcpServers?: string[];
  models?: string[];
  executor?: 'orb';
  os?: RunnerOs;
}): string[] {
  return [
    ...(missing.os !== undefined ? [RUNNER_OS_LABELS[missing.os]] : []),
    ...(missing.mcpServers ?? []).map((slug) => `MCP server "${slug}"`),
    ...(missing.models ?? []).map((id) => `model "${id}"`),
    ...(missing.executor === 'orb' ? ['Container executor'] : []),
  ];
}

export const stepQueueBlockedSchema = z.object({
  kind: z.enum([
    'machine-offline',
    'machine-retired',
    'runner-outdated',
    'capability-missing',
    'runtime-disabled',
    'model-unavailable',
    'local-path',
    'claude-rate-limited',
    'claude-logged-out',
    'devin-subscription',
    'antigravity-subscription',
    'doubao-subscription',
    'doubao-login-required',
    'account-switched',
    'coordinator-provider-missing',
    'coordinator-provider-no-key',
    'no-computer',
    'blocked-by',
    'github-push-missing',
  ]),
  missing: z.array(z.string()),
  platform: runnerOsSchema.optional(),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;
