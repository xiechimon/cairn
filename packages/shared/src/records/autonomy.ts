import { z } from 'zod';

export const ACTION_TIERS = ['guarded', 'full'] as const;
export const actionTierSchema = z.enum(ACTION_TIERS);
export type ActionTier = z.infer<typeof actionTierSchema>;

export const storedAutonomySettingsSchema = z.object({
  actionTier: actionTierSchema.nullish(),
});
export type StoredAutonomySettings = z.infer<typeof storedAutonomySettingsSchema>;

export const DEFAULT_AUTONOMY_SETTINGS: StoredAutonomySettings = {
  actionTier: 'full',
};

export const patchAutonomyBodySchema = storedAutonomySettingsSchema.strict();
export type PatchAutonomyBody = z.infer<typeof patchAutonomyBodySchema>;

export const teamAutonomySchema = z.object({ actionTier: actionTierSchema });
export type TeamAutonomy = z.infer<typeof teamAutonomySchema>;

export const patchTeamAutonomyBodySchema = teamAutonomySchema.partial().strict();
export type PatchTeamAutonomyBody = z.infer<typeof patchTeamAutonomyBodySchema>;

export const autonomyRecordSchema = z.object({
  actionTier: actionTierSchema,
  actionTierOverride: actionTierSchema.nullable(),
});
export type AutonomyRecord = z.infer<typeof autonomyRecordSchema>;
