import { z } from 'zod';
import type { StepKind } from './step.js';

export const ROUTE_USES = ['coordinator', 'session', 'review', 'digest', 'compaction'] as const;
export type RouteUse = (typeof ROUTE_USES)[number];
export const routeUseSchema = z.enum(ROUTE_USES);

const SESSION_STEP_KINDS: ReadonlySet<StepKind> = new Set(['plan', 'build', 'verify']);

export function isSessionStepKind(kind: StepKind): boolean {
  return SESSION_STEP_KINDS.has(kind);
}
