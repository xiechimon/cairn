import { z } from 'zod';

export const machineHardwareSchema = z.object({
  cpuCores: z.number().int().positive(),
  memoryTotalMb: z.number().int().nonnegative().optional(),
  memoryAvailableMb: z.number().int().nonnegative(),
  loadAvg1: z.number().nonnegative(),
  diskFreeMb: z.number().int().nonnegative(),
});
export type MachineHardware = z.infer<typeof machineHardwareSchema>;

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

export function confinementDispatchReady(
  capabilities: MachineCapabilities | null | undefined,
): boolean {
  return capabilities?.osPlatform !== 'linux' || capabilities.confinement?.state === 'ready';
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

export const machineCapabilitiesSchema = z.object({
  osPlatform: machineOsPlatformSchema.optional(),
  mcpServers: z.array(z.string()),
  skills: z.array(z.string()),
  hardware: machineHardwareSchema.optional(),
  executor: machineExecutorSchema.optional(),
  computer: z.literal(true).optional(),
  ownComputer: z.literal(true).optional(),
  browser: z.literal(true).optional(),
  secretGateway: z.literal(true).optional(),
  codexLogin: codexLoginSchema.optional(),
  confinement: confinementReportSchema.optional(),
  agentReach: agentReachReportSchema.optional(),
  hostPermissions: hostPermissionsSchema.optional(),
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
  const confinement = confinementReportSchema.safeParse(rec.confinement);
  const hardware = machineHardwareSchema.safeParse(rec.hardware);
  const executor = machineExecutorSchema.safeParse(rec.executor);
  const codexLogin = codexLoginSchema.safeParse(rec.codexLogin);
  const agentReach = agentReachReportSchema.safeParse(rec.agentReach);
  const hostPermissions = hostPermissionsSchema.safeParse(rec.hostPermissions);
  return {
    ...base.data,
    ...(osPlatform.success ? { osPlatform: osPlatform.data } : {}),
    ...(confinement.success ? { confinement: confinement.data } : {}),
    ...(codexLogin.success ? { codexLogin: codexLogin.data } : {}),
    ...(agentReach.success ? { agentReach: agentReach.data } : {}),
    ...(hostPermissions.success ? { hostPermissions: hostPermissions.data } : {}),
    ...(hardware.success ? { hardware: hardware.data } : {}),
    ...(executor.success ? { executor: executor.data } : {}),
    ...(rec.computer === true ? { computer: true as const } : {}),
    ...(rec.ownComputer === true ? { ownComputer: true as const } : {}),
    ...(rec.browser === true ? { browser: true as const } : {}),
    ...(rec.secretGateway === true ? { secretGateway: true as const } : {}),
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
  kind: z.enum(['machine-offline', 'capability-missing']),
  missing: z.array(z.string()),
  platform: runnerOsSchema.optional(),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;
