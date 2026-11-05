import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const POLICY_USES = ['session', 'review'] as const;
export type PolicyUse = (typeof POLICY_USES)[number];
export const policyUseSchema = z.enum(POLICY_USES);

export const workPolicyRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  use: policyUseSchema,
  tools: z.array(z.string()),
  mcpServers: z.array(z.string()),
  skillsAllowlist: z.array(z.string()).nullable(),
  defaultSkill: z.string().nullable(),
  secrets: z.array(z.string()),
  seededFromAgentId: recordId.nullable(),
  createdAt: epochMs,
  updatedAt: epochMs,
});
export type WorkPolicyRecord = z.infer<typeof workPolicyRecordSchema>;

export const patchWorkPolicyBodySchema = z
  .object({
    tools: z.array(z.string()).optional(),
    mcpServers: z.array(z.string()).optional(),
    skillsAllowlist: z.array(z.string()).nullable().optional(),
    defaultSkill: z.string().nullable().optional(),
    secrets: z.array(z.string()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
export type PatchWorkPolicyBody = z.infer<typeof patchWorkPolicyBodySchema>;
