import { z } from 'zod';
import { claudeLoginSchema } from './claude-login.js';
import { epochMs, recordId } from './common.js';
import { machineCapabilitiesSchema } from './machine-capabilities.js';

export const MACHINE_RUNTIMES = ['pi', 'claude-code', 'gemini', 'devin'] as const;
export type MachineRuntime = (typeof MACHINE_RUNTIMES)[number];

export const machineRunningThreadSchema = z.object({
  threadId: recordId,
  title: z.string(),
  projectId: recordId,
  startedAt: epochMs,
});
export type MachineRunningThread = z.infer<typeof machineRunningThreadSchema>;

export const MACHINE_FOLDER_PATH_MAX = 4096;
export const MACHINE_FOLDER_PINS_LIMIT = 64;

export const machineFolderPinStatusSchema = z.enum(['pending', 'confirmed', 'rejected', 'absent']);
export type MachineFolderPinStatus = z.infer<typeof machineFolderPinStatusSchema>;

export const machineFolderPinSchema = z.object({
  path: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX),
  status: machineFolderPinStatusSchema,
  enabled: z.boolean(),
});
export type MachineFolderPin = z.infer<typeof machineFolderPinSchema>;

export const machineFolderGrantsSchema = z.object({
  workspacesDir: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX).optional(),
  bindsGrants: z.literal(true).optional(),
  pins: z.array(machineFolderPinSchema).max(MACHINE_FOLDER_PINS_LIMIT),
});
export type MachineFolderGrants = z.infer<typeof machineFolderGrantsSchema>;

export const machineRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  hostname: z.string().optional(),
  teamId: recordId,
  online: z.boolean(),
  lastSeenAt: z.number().int().nullable().optional(),
  latestCliVersion: z.string().nullable(),
  kind: z.enum(['local', 'remote']),
  enabledRuntimes: z.array(z.string()),
  maxConcurrent: z.number().int().optional(),
  maxConcurrentOverridden: z.boolean().optional(),
  recommendedConcurrent: z.number().int().optional(),
  concurrencyRange: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  concurrencySource: z.enum(['measured', 'estimate', 'manual']).optional(),
  runningSteps: z.number().int().optional(),
  running: z.array(machineRunningThreadSchema).optional(),
  capabilities: machineCapabilitiesSchema.nullish(),
  browserOverride: z.boolean().nullable().optional(),
  desktopOverride: z.boolean().nullable().optional(),
  ownComputerEnabled: z.boolean().optional(),
  claudeLogin: claudeLoginSchema.optional(),
  folderGrants: machineFolderGrantsSchema.nullish(),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const machineFolderPinOpSchema = z.object({
  path: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX),
  op: z.enum(['pin', 'enable', 'disable', 'remove']),
});
export type MachineFolderPinOp = z.infer<typeof machineFolderPinOpSchema>;

export const patchMachineBodySchema = z.object({
  browserOverride: z.boolean().nullable().optional(),
  desktopOverride: z.boolean().nullable().optional(),
  enabledRuntimes: z.array(z.enum(MACHINE_RUNTIMES)).optional(),
  maxConcurrent: z.number().int().min(1).max(16).nullable().optional(),
  isDefault: z.literal(true).optional(),
  ownComputerEnabled: z.boolean().optional(),
  folderPins: z.array(machineFolderPinOpSchema).min(1).max(MACHINE_FOLDER_PINS_LIMIT).optional(),
});
export type PatchMachineBody = z.infer<typeof patchMachineBodySchema>;

export const evacuateMachineBodySchema = z.object({
  targetMachineId: recordId,
});
export type EvacuateMachineBody = z.infer<typeof evacuateMachineBodySchema>;
