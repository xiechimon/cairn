import { z } from 'zod';

export const AUTONOMY_KINDS = ['issue-intake', 'gardener', 'auto-merge', 'scheduling'] as const;
export const autonomyKindSchema = z.enum(AUTONOMY_KINDS);
export type AutonomyKind = z.infer<typeof autonomyKindSchema>;

export const AUTONOMY_GATE_REASONS = [
  'disabled',
  'dormant',
  'in-flight-cap',
  'member-active',
  'cooldown',
  'budget',
  'budget-unreadable',
] as const;
export const autonomyGateReasonSchema = z.enum(AUTONOMY_GATE_REASONS);
export type AutonomyGateReason = z.infer<typeof autonomyGateReasonSchema>;

export const autonomySettingsSchema = z.object({
  enabled: z.boolean(),
  quietMinutes: z.number().int().min(0).max(1440),
  cooldownMinutes: z.number().int().min(0).max(1440),
  dailyBudgetUsd: z.number().min(0).max(10_000),
});
export type AutonomySettings = z.infer<typeof autonomySettingsSchema>;

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = {
  enabled: true,
  quietMinutes: 10,
  cooldownMinutes: 15,
  dailyBudgetUsd: 10,
};

export const patchAutonomyBodySchema = autonomySettingsSchema.partial().strict();
export type PatchAutonomyBody = z.infer<typeof patchAutonomyBodySchema>;

export const autonomyKindStateSchema = z.object({
  kind: autonomyKindSchema,
  lastStartedAt: z.number().nullable(),
  lastBlockedReason: autonomyGateReasonSchema.nullable(),
  lastEvaluatedAt: z.number().nullable(),
});
export type AutonomyKindState = z.infer<typeof autonomyKindStateSchema>;

export const autonomyRecordSchema = z.object({
  settings: autonomySettingsSchema,
  spentTodayUsd: z.number().nullable(),
  kinds: z.array(autonomyKindStateSchema),
});
export type AutonomyRecord = z.infer<typeof autonomyRecordSchema>;
