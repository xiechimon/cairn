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

const machineOsPlatformSchema = z.enum(['linux', 'darwin', 'other']);

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
  return {
    ...base.data,
    ...(osPlatform.success ? { osPlatform: osPlatform.data } : {}),
    ...(confinement.success ? { confinement: confinement.data } : {}),
    ...(codexLogin.success ? { codexLogin: codexLogin.data } : {}),
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
});
export type RequiredCapabilities = z.infer<typeof requiredCapabilitiesSchema>;

export function capabilityMissingLabels(missing: {
  mcpServers?: string[];
  models?: string[];
  executor?: 'orb';
}): string[] {
  return [
    ...(missing.mcpServers ?? []).map((slug) => `MCP server "${slug}"`),
    ...(missing.models ?? []).map((id) => `model "${id}"`),
    ...(missing.executor === 'orb' ? ['Orb sandbox executor'] : []),
  ];
}

export const stepQueueBlockedSchema = z.object({
  kind: z.enum(['machine-offline', 'capability-missing']),
  missing: z.array(z.string()),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;
