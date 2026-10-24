import { z } from 'zod';
import { personaRoleSchema } from './records/agent.js';
import { epochMs, recordId } from './records/common.js';
import { transcriptRowSchema } from './records/message.js';
import { planRowSchema } from './records/plan.js';
import { stepKindSchema } from './records/step.js';
import { tokenUsageSchema } from './records/token-usage.js';
import { skillInjectionSchema } from './skill-inject.js';

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
});

export type TrajectoryPack = z.infer<typeof trajectoryPackSchema>;
