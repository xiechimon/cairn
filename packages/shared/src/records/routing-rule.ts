import { z } from 'zod';
import { recordId } from './common.js';
import { requiredCapabilitiesSchema } from './machine-capabilities.js';
import type { StepKind } from './step.js';

export const ROUTE_USES = ['coordinator', 'session', 'review', 'digest', 'compaction'] as const;
export type RouteUse = (typeof ROUTE_USES)[number];
export const routeUseSchema = z.enum(ROUTE_USES);

const SESSION_STEP_KINDS: ReadonlySet<StepKind> = new Set(['plan', 'build', 'verify']);

export const routeOverrideSchema = z.object({
  machineId: recordId.optional(),
  requiredCapabilities: requiredCapabilitiesSchema.optional(),
});
export type RouteOverride = z.infer<typeof routeOverrideSchema>;

export function isSessionStepKind(kind: StepKind): boolean {
  return SESSION_STEP_KINDS.has(kind);
}
