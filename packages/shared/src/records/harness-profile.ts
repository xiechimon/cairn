import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const HARNESS_PROFILE_MODES = ['independent', 'unified', 'paused'] as const;
export type HarnessProfileMode = (typeof HARNESS_PROFILE_MODES)[number];
export const harnessProfileModeSchema = z.enum(HARNESS_PROFILE_MODES);

export const HARNESS_PROFILE_CAPABILITIES = [
  'instructions',
  'skills',
  'mcpDefinitions',
  'packages',
  'safeSettings',
] as const;
export type HarnessProfileCapability = (typeof HARNESS_PROFILE_CAPABILITIES)[number];
export const harnessProfileCapabilitySchema = z.enum(HARNESS_PROFILE_CAPABILITIES);

export const HARNESS_PROFILE_TARGETS = ['pi', 'claude-code', 'codex'] as const;
export type HarnessProfileTarget = (typeof HARNESS_PROFILE_TARGETS)[number];
export const harnessProfileTargetSchema = z.enum(HARNESS_PROFILE_TARGETS);

export const harnessProfileRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  mode: harnessProfileModeSchema,
  capabilities: z.array(harnessProfileCapabilitySchema),
  targets: z.array(harnessProfileTargetSchema),
  version: z.number().int().min(0),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type HarnessProfileRecord = z.infer<typeof harnessProfileRecordSchema>;

export const patchHarnessProfileBodySchema = z
  .object({
    mode: harnessProfileModeSchema.optional(),
    capabilities: z.array(harnessProfileCapabilitySchema).optional(),
    targets: z.array(harnessProfileTargetSchema).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
export type PatchHarnessProfileBody = z.infer<typeof patchHarnessProfileBodySchema>;

export function profileServesCapability(
  profile: Pick<HarnessProfileRecord, 'mode' | 'capabilities'> | null,
  capability: HarnessProfileCapability,
): boolean {
  if (profile === null) return false;
  if (profile.mode !== 'unified') return false;
  return profile.capabilities.includes(capability);
}
