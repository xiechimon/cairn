import { z } from 'zod';
import { THINKING_LEVELS, thinkingLevelSchema } from '../thinking-levels.js';
import { reportedModelSchema } from './model-source.js';

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

export const confinementIdentitySchema = z.object({
  invocation: z.uuid(),
  generation: z.number().int().positive(),
});
export const confinementReportSchema = z.discriminatedUnion('state', [
  confinementIdentitySchema
    .extend({
      state: z.enum(['checking', 'ready', 'not-applicable']),
      revision: z.number().int().positive(),
    })
    .strict(),
  confinementIdentitySchema
    .extend({
      state: z.literal('unavailable'),
      revision: z.number().int().positive(),
      reason: z.enum(['startup-failed', 'cleanup-failed', 'unsupported-platform']),
    })
    .strict(),
]);
export type ConfinementReport = z.infer<typeof confinementReportSchema>;

export const confinementCauseSchema = z
  .object({
    kind: z.enum([
      'not-own-unit',
      'bwrap-missing',
      'bwrap-too-old',
      'userns-denied',
      'home-overlay-failed',
      'seatbelt-missing',
      'seatbelt-probe-failed',
    ]),
    mountPoint: z.string().startsWith('/').max(4096).optional(),
  })
  .strict();
export type ConfinementCause = z.infer<typeof confinementCauseSchema>;

export function confinementEnforced(osPlatform: string | undefined): boolean {
  return osPlatform === 'linux' || osPlatform === 'darwin';
}

export function confinementDispatchReady(
  capabilities: MachineCapabilities | null | undefined,
): boolean {
  return (
    !confinementEnforced(capabilities?.osPlatform) || capabilities?.confinement?.state === 'ready'
  );
}

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
  })
  .strict();
export type DevinReport = z.infer<typeof devinReportSchema>;

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

export const VM_DOWNLOAD_PARTS = {
  runtime: 169_630_704,
  kernel: 676_287_269,
  init: 69_438_946,
  image: 569_818_183,
} as const;
export const VM_DOWNLOAD_BYTES = Object.values(VM_DOWNLOAD_PARTS).reduce((a, b) => a + b, 0);

export const vmDownloadSchema = z
  .object({
    state: z.enum(['absent', 'downloading', 'ready', 'failed']),
    doneBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
  })
  .strict();
export type VmDownload = z.infer<typeof vmDownloadSchema>;

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
  computerKind: z.enum(['host', 'vm']).optional(),
  vmDownload: vmDownloadSchema.optional(),
  secretGateway: z.literal(true).optional(),
  mcpConnectors: z.literal(true).optional(),
  codexLogin: codexLoginSchema.optional(),
  devin: devinReportSchema.optional(),
  antigravity: antigravityReportSchema.optional(),
  antigravityOAuthProfile: z.literal(true).optional(),
  antigravitySubscriptionModels: z.literal(true).optional(),
  confinement: confinementReportSchema.optional(),
  confinementCause: confinementCauseSchema.optional().catch(undefined),
  agentReach: agentReachReportSchema.optional(),
  scrapling: z.object({ version: z.string().min(1).max(32) }).optional(),
  hostPermissions: hostPermissionsSchema.optional(),
  phoneHost: z.literal(true).optional(),
  phones: z.array(machinePhoneReportSchema).optional(),
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
  const confinement = confinementReportSchema.safeParse(rec.confinement);
  const confinementCause = confinementCauseSchema.safeParse(rec.confinementCause);
  const hardware = machineHardwareSchema.safeParse(rec.hardware);
  const executor = machineExecutorSchema.safeParse(rec.executor);
  const codexLogin = codexLoginSchema.safeParse(rec.codexLogin);
  const devin = devinReportSchema.safeParse(rec.devin);
  const antigravity = antigravityReportSchema.safeParse(rec.antigravity);
  const agentReach = agentReachReportSchema.safeParse(rec.agentReach);
  const scrapling = machineCapabilitiesSchema.shape.scrapling.safeParse(rec.scrapling);
  const hostPermissions = hostPermissionsSchema.safeParse(rec.hostPermissions);
  const vmDownload = vmDownloadSchema.safeParse(rec.vmDownload);
  const phones = z.array(machinePhoneReportSchema).max(32).safeParse(rec.phones);
  const computerName = machineCapabilitiesSchema.shape.computerName.safeParse(rec.computerName);
  const reportedHostname = machineCapabilitiesSchema.shape.hostname.safeParse(rec.hostname);
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
    ...(confinement.success ? { confinement: confinement.data } : {}),
    ...(confinementCause.success ? { confinementCause: confinementCause.data } : {}),
    ...(codexLogin.success ? { codexLogin: codexLogin.data } : {}),
    ...(devin.success ? { devin: devin.data } : {}),
    ...(antigravity.success ? { antigravity: antigravity.data } : {}),
    ...(rec.antigravityOAuthProfile === true ? { antigravityOAuthProfile: true } : {}),
    ...(rec.antigravitySubscriptionModels === true ? { antigravitySubscriptionModels: true } : {}),
    ...(agentReach.success ? { agentReach: agentReach.data } : {}),
    ...(scrapling.success && scrapling.data !== undefined ? { scrapling: scrapling.data } : {}),
    ...(hostPermissions.success ? { hostPermissions: hostPermissions.data } : {}),
    ...(vmDownload.success ? { vmDownload: vmDownload.data } : {}),
    ...(hardware.success ? { hardware: hardware.data } : {}),
    ...(executor.success ? { executor: executor.data } : {}),
    ...(rec.computer === true ? { computer: true as const } : {}),
    ...(rec.ownComputer === true ? { ownComputer: true as const } : {}),
    ...(rec.ownComputerShell === true ? { ownComputerShell: true as const } : {}),
    ...(rec.browser === true ? { browser: true as const } : {}),
    ...(rec.browserSecretFill === true ? { browserSecretFill: true as const } : {}),
    ...(rec.stealthBrowser === true ? { stealthBrowser: true as const } : {}),
    ...(rec.screenHandoff === true ? { screenHandoff: true as const } : {}),
    ...(rec.computerKind === 'host' || rec.computerKind === 'vm'
      ? { computerKind: rec.computerKind }
      : {}),
    ...(rec.secretGateway === true ? { secretGateway: true as const } : {}),
    ...(rec.mcpConnectors === true ? { mcpConnectors: true as const } : {}),
    ...(rec.phoneHost === true ? { phoneHost: true as const } : {}),
    ...(phones.success && phones.data !== undefined ? { phones: phones.data } : {}),
  };
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
    ...(missing.executor === 'orb' ? ['Orb sandbox executor'] : []),
  ];
}

export const stepQueueBlockedSchema = z.object({
  kind: z.enum([
    'machine-offline',
    'machine-retired',
    'capability-missing',
    'sandbox-unavailable',
    'runtime-disabled',
    'model-unavailable',
    'local-path',
    'claude-rate-limited',
    'claude-logged-out',
    'devin-subscription',
    'antigravity-subscription',
    'account-switched',
    'coordinator-provider-missing',
    'coordinator-provider-no-key',
    'no-computer',
    'blocked-by',
  ]),
  missing: z.array(z.string()),
  platform: runnerOsSchema.optional(),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;
