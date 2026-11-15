import { z } from 'zod';
import { thinkingLevelSchema } from '../agent-backend.js';
import { FALLBACK_MODELS_MAX } from './agent.js';
import { epochMs, recordId } from './common.js';
import { type RunnerOs, requiredCapabilitiesSchema } from './machine-capabilities.js';
import { modelRefSchema } from './model-source.js';
import type { StepKind } from './step.js';
import { workPolicyRecordSchema } from './work-policy.js';

export const ROUTE_USES = [
  'coordinator',
  'session',
  'review',
  'digest',
  'compaction',
  'citation_check',
] as const;
export type RouteUse = (typeof ROUTE_USES)[number];
export const routeUseSchema = z.enum(ROUTE_USES);

const SESSION_STEP_KINDS: ReadonlySet<StepKind> = new Set(['plan', 'build', 'session', 'verify']);

export const routeOverrideSchema = z.object({
  machineId: recordId.optional(),
  requiredCapabilities: requiredCapabilitiesSchema.optional(),
});
export type RouteOverride = z.infer<typeof routeOverrideSchema>;

export function withPlatform(
  override: RouteOverride | null | undefined,
  os: RunnerOs | null,
): RouteOverride | null {
  const { requiredCapabilities, ...rest } = override ?? {};
  const { os: _previous, ...needs } = requiredCapabilities ?? {};
  const required = os === null ? needs : { ...needs, os };
  const next =
    Object.keys(required).length > 0 ? { ...rest, requiredCapabilities: required } : rest;
  return Object.keys(next).length > 0 ? next : null;
}

export function isSessionStepKind(kind: StepKind): boolean {
  return SESSION_STEP_KINDS.has(kind);
}

export const routingRuleRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  use: routeUseSchema,
  provider: z.string(),
  modelId: z.string(),
  thinkingLevel: z.string().nullable(),
  fallbackModels: z.array(modelRefSchema).nullable(),
  machineId: recordId.nullable(),
  requiredCapabilities: requiredCapabilitiesSchema.nullable(),
  seededFromAgentId: recordId.nullable(),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type RoutingRuleRecord = z.infer<typeof routingRuleRecordSchema>;

export const patchRoutingRuleBodySchema = z
  .object({
    provider: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    thinkingLevel: thinkingLevelSchema.nullable().optional(),
    fallbackModels: z.array(modelRefSchema).max(FALLBACK_MODELS_MAX).nullable().optional(),
    machineId: recordId.nullable().optional(),
    requiredCapabilities: requiredCapabilitiesSchema.nullable().optional(),
    mcpServers: z.array(z.string()).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
export type PatchRoutingRuleBody = z.infer<typeof patchRoutingRuleBodySchema>;

export const SESSION_DEFAULT_REASONS = ['claude-code', 'codex-login', 'provider', 'none'] as const;

export const sessionDefaultSchema = z.object({
  reason: z.enum(SESSION_DEFAULT_REASONS),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
});
export type SessionDefault = z.infer<typeof sessionDefaultSchema>;

export const COORDINATOR_DEFAULT_REASONS = ['anthropic-key', 'provider', 'none'] as const;

export const coordinatorDefaultSchema = z.object({
  reason: z.enum(COORDINATOR_DEFAULT_REASONS),
  provider: z.string().nullable(),
  modelId: z.string().nullable(),
});
export type CoordinatorDefault = z.infer<typeof coordinatorDefaultSchema>;

export const teamRoutingSettingsSchema = z.object({
  rules: z.array(routingRuleRecordSchema),
  policies: z.array(workPolicyRecordSchema),
  sessionDefault: sessionDefaultSchema.optional(),
  coordinatorDefault: coordinatorDefaultSchema.optional(),
});
export type TeamRoutingSettings = z.infer<typeof teamRoutingSettingsSchema>;
