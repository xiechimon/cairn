import { z } from 'zod';
import { claudeLoginSchema } from './claude-login.js';
import { recordId } from './common.js';
import { machineCapabilitiesSchema } from './machine-capabilities.js';

export const MACHINE_RUNTIMES = ['pi', 'claude-code', 'gemini'] as const;
export type MachineRuntime = (typeof MACHINE_RUNTIMES)[number];

export const machineRecordSchema = z.object({
  id: recordId,
  name: z.string(),
  teamId: recordId,
  online: z.boolean(),
  latestCliVersion: z.string().nullable(),
  kind: z.enum(['local', 'remote']),
  enabledRuntimes: z.array(z.string()),
  maxConcurrent: z.number().int().optional(),
  maxConcurrentOverridden: z.boolean().optional(),
  recommendedConcurrent: z.number().int().optional(),
  concurrencyRange: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
  concurrencySource: z.enum(['measured', 'estimate', 'manual']).optional(),
  runningSteps: z.number().int().optional(),
  capabilities: machineCapabilitiesSchema.nullish(),
  claudeLogin: claudeLoginSchema.optional(),
});
export type MachineRecord = z.infer<typeof machineRecordSchema>;

export const patchMachineBodySchema = z.object({
  enabledRuntimes: z.array(z.enum(MACHINE_RUNTIMES)).optional(),
  maxConcurrent: z.number().int().min(1).max(16).nullable().optional(),
});
export type PatchMachineBody = z.infer<typeof patchMachineBodySchema>;

export const MACHINE_ADD_DIALOG_COPY = {
  cloudHint: '在云服务器上运行？改用 API key 注册',
  getKeyLink: '获取 API key →',
} as const;

export const evacuateMachineBodySchema = z.object({
  targetMachineId: recordId,
});
export type EvacuateMachineBody = z.infer<typeof evacuateMachineBodySchema>;
