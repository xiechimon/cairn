import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';
import { routeOverrideSchema } from './routing-rule.js';

export const triggerSourceSchema = z.enum(['user', 'chief', 'schedule']);
export type TriggerSource = z.infer<typeof triggerSourceSchema>;

export const stopActorSchema = z.enum(['person', 'coordinator', 'mcp', 'system']);
export type StopActor = z.infer<typeof stopActorSchema>;

export const stopAttributionSchema = z.object({
  actor: stopActorSchema,
  reason: z.string().min(1),
});
export type StopAttribution = z.infer<typeof stopAttributionSchema>;

export const buildStopSchema = stopAttributionSchema.extend({ at: epochMs });
export type BuildStop = z.infer<typeof buildStopSchema>;

export const buildRecordSchema = z.object({
  id: recordId,
  todoId: recordId,
  withPlan: z.boolean(),
  prevPhase: phaseSchema.nullable(),
  triggerSource: triggerSourceSchema,
  planDocId: recordId.nullable(),
  errorMessage: z.string().nullable(),
  prUrl: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  diffHash: z.string().nullable(),
  reportAttachmentId: recordId.nullable().optional(),
  stop: buildStopSchema.nullable().optional(),
  createdAt: epochMs,
});
export type BuildRecord = z.infer<typeof buildRecordSchema>;

export const buildMergePermissionSchema = z.object({
  permitted: z.boolean(),
  missingTools: z.array(z.string()),
  prUrl: z.string().nullable(),
});
export type BuildMergePermission = z.infer<typeof buildMergePermissionSchema>;

export const startBuildsBodySchema = z.object({
  todoIds: z.array(recordId),
  assignment: z.unknown().optional(),
  withPlan: z.unknown().optional(),
  routeOverride: routeOverrideSchema.optional(),
});
export type StartBuildsBody = z.infer<typeof startBuildsBodySchema>;

export const mergeAcceptedResponseSchema = z.object({
  delegated: z.literal(true),
});
export type MergeAcceptedResponse = z.infer<typeof mergeAcceptedResponseSchema>;
