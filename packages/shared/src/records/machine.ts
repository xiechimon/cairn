import { z } from 'zod';
import { claudeLoginSchema } from './claude-login.js';
import { epochMs, recordId } from './common.js';
import { machineCapabilitiesSchema, machineStrainReasonSchema } from './machine-capabilities.js';

export const MACHINE_HOST_KEY_PATTERN = /^[a-f0-9]{64}$/;
export const hostKeySchema = z.string().regex(MACHINE_HOST_KEY_PATTERN);

export const MACHINE_RUNTIMES = ['pi', 'claude-code', 'gemini', 'devin', 'antigravity'] as const;
export type MachineRuntime = (typeof MACHINE_RUNTIMES)[number];

export const machineRunningThreadSchema = z.object({
  threadId: recordId,
  title: z.string(),
  projectId: recordId,
  startedAt: epochMs,
  lastProgressAt: epochMs.optional(),
});
export type MachineRunningThread = z.infer<typeof machineRunningThreadSchema>;

export const machineQueuedThreadSchema = z.object({
  threadId: recordId,
  title: z.string(),
  projectId: recordId,
  reason: z.enum(['quota', 'waiting']),
  retryAt: epochMs.nullable(),
});
export type MachineQueuedThread = z.infer<typeof machineQueuedThreadSchema>;

export const machineRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  hostname: z.string().optional(),
  teamId: recordId,
  online: z.boolean(),
  starting: z.boolean().optional(),
  lastSeenAt: z.number().int().nullable().optional(),
  latestCliVersion: z.string().nullable(),
  kind: z.enum(['local', 'remote']),
  enabledRuntimes: z.array(z.string()),
  runningSteps: z.number().int().optional(),
  running: z.array(machineRunningThreadSchema).optional(),
  queued: z.array(machineQueuedThreadSchema).optional(),
  strain: z.array(machineStrainReasonSchema).optional(),
  capabilities: machineCapabilitiesSchema.nullish(),
  claudeLogin: claudeLoginSchema.optional(),
  tokenReauthRequired: z.boolean().optional(),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const rotateMachineTokenResponseSchema = z.object({
  delivery: z.enum(['pushed', 'offline']),
  machine: machineRecordSchema,
});
export type RotateMachineTokenResponse = z.infer<typeof rotateMachineTokenResponseSchema>;

export function isRegisteredMachine(row: {
  kind: string;
  online: boolean;
  lastSeenAt?: number | null | undefined;
}): boolean {
  return row.kind !== 'local' || row.online || row.lastSeenAt != null;
}

export const patchMachineBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^\P{C}+$/u)
    .optional(),
  enabledRuntimes: z.array(z.enum(MACHINE_RUNTIMES)).optional(),
  isDefault: z.literal(true).optional(),
});
export type PatchMachineBody = z.infer<typeof patchMachineBodySchema>;
