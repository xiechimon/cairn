import { z } from 'zod';
import { blockerHandoffSchema } from '../blocker-handoff-record.js';
import { recordId } from '../records/common.js';
import { PROJECT_REPO_KINDS } from '../records/project.js';
import { stepRecordSchema } from '../records/step.js';
import { taskRequestSchema } from '../records/task-request.js';
import { taskDecisionSchema } from '../records/todo.js';
import { remoteToolDefSchema } from './chief-tools.js';

export const CLAIM_PAYLOAD_VERSION = 1 as const;
export const claimPayloadVersionSchema = z.literal(CLAIM_PAYLOAD_VERSION);
export type ClaimPayloadVersion = z.infer<typeof claimPayloadVersionSchema>;

export const machineClaimBodySchema = z.object({
  verifyAttachments: z.literal(true).optional(),
  maxWorkers: z.number().int().min(1).optional(),
  role: z.literal('coordinator').optional(),
});
export type MachineClaimBody = z.infer<typeof machineClaimBodySchema>;

export const localMergeCommandSchema = z.object({
  projectId: recordId,
  buildId: recordId,
  defaultBranch: z.string().min(1),
  workBranch: z.string().min(1),
  judgedBase: z.string().regex(/^[0-9a-f]{40}$/),
  judgedHead: z.string().regex(/^[0-9a-f]{40}$/),
  judgedPatchDigest: z.string().regex(/^pd2:[0-9a-f]{64}$/),
  localChecks: z.array(
    z
      .string()
      .min(1)
      .refine((command) => command.trim().length > 0),
  ),
  message: z.string().min(1),
  identity: z.object({ name: z.string().min(1), email: z.string().min(1) }),
});
export type LocalMergeCommand = z.infer<typeof localMergeCommandSchema>;

export const localFolderActionCommandSchema = z.object({
  action: z.enum(['undo', 'merge']),
  projectId: recordId,
  buildId: recordId,
});
export type LocalFolderActionCommand = z.infer<typeof localFolderActionCommandSchema>;

export const LOCAL_TOOL_CREATE_TAG = 'create_tag';

export const claimedStepV1Schema = z.object({
  payloadVersion: claimPayloadVersionSchema.optional(),
  localMerge: localMergeCommandSchema.optional(),
  localFolderAction: localFolderActionCommandSchema.optional(),
  step: stepRecordSchema,
  conversationId: recordId,
  session: z.object({
    action: z.enum(['new', 'continue']),
    sessionId: z.string().nullable(),
    priorMachineId: z.string().optional(),
  }),
  instruction: z.string().nullable().optional(),
  answerIds: z.array(z.string().min(1)).optional(),
  todo: z
    .object({
      id: recordId,
      seqNum: z.number().int(),
      title: z.string(),
      spec: z.string(),
      meta: z
        .object({
          titleFinal: z.boolean(),
          vocab: z.array(z.object({ name: z.string() })),
        })
        .optional(),
      sourceKind: z.string().nullable().optional(),
      sourceRef: z.string().nullable().optional(),
      request: taskRequestSchema.optional(),
      blockerHandoff: blockerHandoffSchema.optional(),
      decisions: z.array(taskDecisionSchema).optional(),
      output: z.string().nullable().optional(),
    })
    .optional(),
  project: z
    .object({
      id: recordId,
      name: z.string(),
      instructions: z.string().optional(),
      repo: z
        .object({
          kind: z.enum(PROJECT_REPO_KINDS),
          cloneUrl: z.string(),
          baseBranch: z.string().nullable().optional(),
        })
        .nullable(),
    })
    .optional(),
  agent: z
    .object({
      id: recordId,
      displayName: z.string(),
      description: z.string().nullable(),
      provider: z.string().nullable(),
      modelId: z.string().nullable(),
      thinkingLevel: z.string().nullable(),
      memories: z.array(z.object({ title: z.string(), content: z.string() })).optional(),
      skillsAllowlist: z.array(z.string()).nullable().optional(),
      defaultSkill: z.string().nullable().optional(),
      injectedSkills: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
    })
    .nullable(),
  chief: z
    .object({
      threadId: recordId,
      systemPrompt: z.string(),
      trigger: z.enum(['user', 'gate', 'settle', 'failed', 'wake']),
      history: z.string().optional(),
    })
    .optional(),
  remoteTools: z.array(remoteToolDefSchema).optional(),
  localTools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
  remoteToolsOnly: z.literal(true).optional(),
});

export const claimedStepSchema = claimedStepV1Schema;
export type ClaimedStep = z.infer<typeof claimedStepSchema>;

export function claimPayloadVersionOf(
  payload: Pick<ClaimedStep, 'payloadVersion'>,
): ClaimPayloadVersion {
  return payload.payloadVersion ?? CLAIM_PAYLOAD_VERSION;
}

export const machineClaimResponseSchema = z.object({
  step: claimedStepSchema.nullable(),
});
export type MachineClaimResponse = z.infer<typeof machineClaimResponseSchema>;
