import { z } from 'zod';
import { recordId } from './common.js';

export const machineHardwareSchema = z.object({
  cpuCores: z.number().int().positive(),
  memoryTotalMb: z.number().int().nonnegative().optional(),
  memoryAvailableMb: z.number().int().nonnegative(),
  loadAvg1: z.number().nonnegative(),
  diskFreeMb: z.number().int().nonnegative(),
});
export type MachineHardware = z.infer<typeof machineHardwareSchema>;

export const machineCapabilitiesSchema = z.object({
  mcpServers: z.array(z.string()),
  skills: z.array(z.string()),
  hardware: machineHardwareSchema.optional(),
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
  if (rec.hardware === undefined) return base.data;
  const hardware = machineHardwareSchema.safeParse(rec.hardware);
  return hardware.success ? { ...base.data, hardware: hardware.data } : base.data;
}

export const requiredCapabilitiesSchema = z.object({
  mcpServers: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
});
export type RequiredCapabilities = z.infer<typeof requiredCapabilitiesSchema>;

export function capabilityMissingLabels(missing: {
  mcpServers?: string[];
  models?: string[];
}): string[] {
  return [
    ...(missing.mcpServers ?? []).map((slug) => `MCP server "${slug}"`),
    ...(missing.models ?? []).map((id) => `model "${id}"`),
  ];
}

export const stepQueueBlockedSchema = z.object({
  kind: z.enum(['machine-offline', 'capability-missing']),
  missing: z.array(z.string()),
});
export type StepQueueBlocked = z.infer<typeof stepQueueBlockedSchema>;

export const agentMachineFitRowSchema = z.object({
  machineId: recordId,
  name: z.string(),
  online: z.boolean(),
  runtimeOk: z.boolean(),
  missing: z.array(z.string()).nullable(),
  mcpGaps: z.array(z.string()).nullable(),
  canRun: z.boolean(),
});
export type AgentMachineFitRow = z.infer<typeof agentMachineFitRowSchema>;

export const agentMachineFitResponseSchema = z.object({
  machines: z.array(agentMachineFitRowSchema),
});
export type AgentMachineFitResponse = z.infer<typeof agentMachineFitResponseSchema>;
