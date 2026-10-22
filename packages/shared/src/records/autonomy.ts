// 后台自动任务的触发闸（#1491，spec 28 §5「token 失控」）：issue 进料、园丁
// （#1407）、自治合并（#1405）共用一道闸。阈值存项目设置（project.autonomy
// 列），被拦的原因存 autonomy_state，设置页读出来给人看。词表三端同源。

import { z } from 'zod';

/** 走这道闸的后台任务种类。冷却、被拦原因按 项目 × 种类 分开记。 */
export const AUTONOMY_KINDS = ['issue-intake', 'gardener', 'auto-merge'] as const;
export const autonomyKindSchema = z.enum(AUTONOMY_KINDS);
export type AutonomyKind = z.infer<typeof autonomyKindSchema>;

/** 被拦原因，固定词表，顺序 = 判定顺序（首个不过即返回）：
 * - disabled：项目没开后台自动任务。
 * - dormant：自上次本类任务开跑后 main 没有新提交（读失败不算休眠）。
 * - in-flight-cap：项目在飞的自动任务已到上限。
 * - member-active：人在 quietMinutes 分钟内有过写操作，让路。
 * - cooldown：同类任务距上次开跑不足 cooldownMinutes 分钟。
 * - budget：当天（UTC）该项目自动任务的花费已到 dailyBudgetUsd。
 * - budget-unreadable：花费读不到，按不过处理。 */
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

/** 项目的闸设置。分钟数与预算取 0 = 关掉这一道（enabled 关 = 整个不跑）。 */
export const autonomySettingsSchema = z.object({
  enabled: z.boolean(),
  /** 人最近一次写操作后，多少分钟内后台任务让路。 */
  quietMinutes: z.number().int().min(0).max(1440),
  /** 同类任务两次开跑至少隔多少分钟。 */
  cooldownMinutes: z.number().int().min(0).max(1440),
  /** 每个 UTC 日该项目自动任务的花费上限（USD）。 */
  dailyBudgetUsd: z.number().min(0).max(10_000),
});
export type AutonomySettings = z.infer<typeof autonomySettingsSchema>;

/** 缺省值（project.autonomy 为 null 时）：开着（总开关仍是各任务自己的 env，
 * 例：进料默认关），阈值偏保守。 */
export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = {
  enabled: true,
  quietMinutes: 10,
  cooldownMinutes: 15,
  dailyBudgetUsd: 10,
};

/** `PATCH /api/projects/{id}/autonomy`：缺键 = 不动，未知键 400。 */
export const patchAutonomyBodySchema = autonomySettingsSchema.partial().strict();
export type PatchAutonomyBody = z.infer<typeof patchAutonomyBodySchema>;

/** 某种任务在某项目上的最近一次判定。 */
export const autonomyKindStateSchema = z.object({
  kind: autonomyKindSchema,
  /** 最近一次开跑的时刻（epoch ms）；null = 还没开跑过。 */
  lastStartedAt: z.number().nullable(),
  /** 最近一次判定被拦的原因；null = 最近一次放行了。 */
  lastBlockedReason: autonomyGateReasonSchema.nullable(),
  lastEvaluatedAt: z.number().nullable(),
});
export type AutonomyKindState = z.infer<typeof autonomyKindStateSchema>;

/** `GET /api/projects/{id}/autonomy` 与 PATCH 的应答。 */
export const autonomyRecordSchema = z.object({
  settings: autonomySettingsSchema,
  /** 当天（UTC）已花的自动任务费用；读不到 = null。 */
  spentTodayUsd: z.number().nullable(),
  kinds: z.array(autonomyKindStateSchema),
});
export type AutonomyRecord = z.infer<typeof autonomyRecordSchema>;
