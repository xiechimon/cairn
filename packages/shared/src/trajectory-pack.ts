import { z } from 'zod';
import { blockerHandoffSchema } from './blocker-handoff-record.js';
import { failureAttributionSchema } from './failure-attribution.js';
import { personaRoleSchema } from './records/agent.js';
import { epochMs, recordId } from './records/common.js';
import { transcriptRowSchema } from './records/message.js';
import { planRowSchema } from './records/plan.js';
import { reviewVerdictSchema } from './records/review.js';
import { stepKindSchema } from './records/step.js';
import { tokenUsageSchema } from './records/token-usage.js';
import { verifyVerdictSchema } from './records/verify.js';
import { skillInjectionSchema } from './skill-inject.js';

export const mergeGateRunSchema = z.object({
  id: recordId,
  buildId: recordId,
  at: epochMs,
  headSha: z.string().nullable(),
  patchDigest: z.string().nullable(),
  ready: z.boolean(),
  blockerCodes: z.array(z.string()),
  merged: z.boolean(),
  mismatchIssue: z.number().int().positive().nullable(),
  action: z.object({
    status: z.enum(['written', 'failed', 'unchanged', 'not-requested']),
    autoMerge: z.literal('not-requested'),
  }),
  reviewers: z.array(
    z.object({
      stepId: recordId,
      kind: z.enum(['review', 'verify', 'decision']),
      modelId: z.string().nullable(),
      rawOutput: z.string().nullable(),
      verdict: z.union([reviewVerdictSchema, verifyVerdictSchema]).nullable(),
      outcome: z.string(),
    }),
  ),
});

export type MergeGateRun = z.infer<typeof mergeGateRunSchema>;

export const trajectoryPackSchema = z.object({
  buildId: recordId,
  input: z.object({
    spec: z.string(),
    sourceRef: z.string().nullable(),
    baseSha: z.string().min(1),
    persona: personaRoleSchema.nullable(),
    agentId: recordId,
    model: z.string().min(1),
    skillInjection: skillInjectionSchema.nullable(),
    blockerHandoff: blockerHandoffSchema.nullable(),
    harnessHash: z.string().min(1),
  }),
  process: z.object({
    steps: z.array(
      z.object({
        stepId: recordId,
        kind: stepKindSchema,
        transcript: z.array(transcriptRowSchema.omit({ id: true, createdAt: true })),
        checkpointCommit: z.string().nullable(),
      }),
    ),
    plans: z.array(planRowSchema),
    token_usage: z.array(tokenUsageSchema),
  }),
  judgments: z.object({
    plan: z.array(
      z.object({
        action: z.enum(['confirm', 'revision']),
        reason: z.string().nullable(),
      }),
    ),
    diff: z.array(
      z.object({
        action: z.enum(['approve', 'revision', 'restart']),
        reason: z.string().nullable(),
      }),
    ),
    gate_verdict: z.array(
      z.object({
        stepId: recordId,
        buildId: recordId,
        kind: z.enum(['review', 'verify', 'decision']),
        perspective: z.string().nullable(),
        outcome: z.enum([
          'pass',
          'block',
          'extraction_failed',
          'step_failed',
          'tampered',
          'unbound',
          'evidence_invalid',
        ]),
        patchDigest: z.string().nullable(),
        headSha: z.string().nullable(),
        expectedHeadSha: z.string(),
        createdAt: epochMs,
      }),
    ),
    gate_runs: z.array(mergeGateRunSchema).optional(),
    ciFixRounds: z.number().int().nonnegative(),
  }),
  outcome: z
    .object({
      merged: z.boolean().nullable(),
      revertedWithin7d: z.boolean().nullable(),
      fixedByLaterPr: z.boolean().nullable(),
      costTotal: z.number().nonnegative().nullable(),
    })
    .nullable(),
  attribution: failureAttributionSchema.nullable().default(null),
});

export type TrajectoryPack = z.infer<typeof trajectoryPackSchema>;
