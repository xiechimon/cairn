import { z } from 'zod';
import { modelUsageSchema, providerConfigSchema, toolCallRecordSchema } from '../agent-backend.js';
import { agentTodoReportSchema } from '../agent-todo.js';
import {
  ANTIGRAVITY_TOKEN_REGEX,
  antigravityOAuthStepCredentialSchema,
  antigravityProbedModelSchema,
} from '../antigravity-subscription.js';
import { backgroundTaskSchema } from '../background-task.js';
import { blockerHandoffSchema } from '../blocker-handoff-record.js';
import { MACHINE_TOKEN_PATTERN } from '../brand.js';
import { claudeRateLimitReportSchema } from '../records/claude-rate-limit.js';
import { epochMs, recordId } from '../records/common.js';
import { hostKeySchema, machineRecordSchema } from '../records/machine.js';
import { antigravityModelSchema, GITHUB_PUSH_MAX_REPOS } from '../records/machine-capabilities.js';
import {
  answerDeliveryViaSchema,
  messageRoleSchema,
  transcriptRowSchema,
} from '../records/message.js';
import { claudeCodeReportSchema, managedUpdateRuntimeSchema } from '../records/model-source.js';
import { PROJECT_REPO_KINDS } from '../records/project.js';
import { providerFailureSchema } from '../records/provider.js';
import { reviewVerdictSchema } from '../records/review.js';
import { stepActivityReportSchema, stepRecordSchema } from '../records/step.js';
import { taskRequestSchema } from '../records/task-request.js';
import { taskDecisionSchema } from '../records/todo.js';
import { verifyVerdictSchema } from '../records/verify.js';
import { skillInjectionFactsSchema } from '../skill-injection-check.js';
import {
  type StepFailureDetail,
  stepFailureCodeSchema,
  stepFailureDetailSchema,
} from '../task-failure.js';
import {
  machineToolRelayBodySchema,
  machineToolRelayResponseSchema,
  remoteToolDefSchema,
} from './chief-tools.js';
import {
  computerCallSchema,
  machineComputerFramesBodySchema,
  machineComputerFramesResponseSchema,
} from './computer.js';
import { computerPresenceListSchema } from './computer-presence.js';
import { computerScreenRequestSchema } from './computer-screen.js';
import { machineJsonSchema } from './executor.js';

const legacyHostKeysSchema = z.array(hostKeySchema).max(8);
const retireMachineTokenSchema = z.string().regex(MACHINE_TOKEN_PATTERN);

export const machineEnrollBodySchema = z.object({
  teamId: recordId,
  name: z.string().optional(),
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  capabilities: z.unknown().optional(),
  hostKey: hostKeySchema.optional(),
  legacyHostKeys: legacyHostKeysSchema.optional(),
});
export type MachineEnrollBody = z.infer<typeof machineEnrollBodySchema>;

export const machineEnrollResponseSchema = machineJsonSchema.omit({ hostKey: true });
export type MachineEnrollResponse = z.infer<typeof machineEnrollResponseSchema>;

export const MACHINE_ENROLL_TTL_MS = 600_000;

export const machineEnrollStartBodySchema = z.object({
  teamId: recordId.optional(),
  name: z.string().optional(),
  hostKey: hostKeySchema.optional(),
  legacyHostKeys: legacyHostKeysSchema.optional(),
});
export const machineEnrollStartResponseSchema = z.object({
  enrollId: z.string(),
  url: z.string(),
  code: z.string().optional(),
  pollSecret: z.string().optional(),
});

export const machineEnrollPollBodySchema = z.object({
  enrollId: z.string(),
  pollSecret: z.string().min(1).max(256).optional(),
});
export const machineEnrollPollResponseSchema = z.union([
  z.object({
    status: z.literal('pending'),
    name: z.string().optional(),
    code: z.string().optional(),
  }),
  z.object({
    status: z.literal('authorized'),
    machine: machineEnrollResponseSchema.optional(),
    name: z.string().optional(),
  }),
  z.object({ status: z.literal('expired') }),
]);
export type MachineEnrollPollResponse = z.infer<typeof machineEnrollPollResponseSchema>;

export function enrollDisplayName(name: string | undefined): string | undefined {
  if (name === undefined || name.trim() === '' || name.length > 253 || /\p{C}/u.test(name))
    return undefined;
  return name;
}

export const machineEnrollConfirmBodySchema = z.union([
  z.object({ enrollId: z.string(), retireToken: retireMachineTokenSchema.optional() }),
  z.object({ code: z.string().max(32), retireToken: retireMachineTokenSchema.optional() }),
]);

export function normalizeEnrollCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export const machineMeResponseSchema = machineRecordSchema;

export const machinePresenceBodySchema = z.object({
  computers: computerPresenceListSchema.optional(),
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  capabilities: z.unknown().optional(),
  connectionId: z.string().min(1).max(64).nullable().optional(),
  hostKey: hostKeySchema.optional(),
  legacyHostKeys: legacyHostKeysSchema.optional(),
});
export type MachinePresenceBody = z.infer<typeof machinePresenceBodySchema>;
export const machineOkResponseSchema = z.object({ ok: z.literal(true) });

export const machinePresencePhoneSchema = z.object({
  deviceId: z.string().min(1).max(256),
  phoneId: z.string().min(1).max(64),
});
export type MachinePresencePhone = z.infer<typeof machinePresencePhoneSchema>;

export const machinePresenceResponseSchema = machineOkResponseSchema.extend({
  installDevin: z.boolean().optional(),
  phones: z.array(machinePresencePhoneSchema).max(32).optional(),
  githubRepos: z.array(z.string().min(3).max(200)).max(GITHUB_PUSH_MAX_REPOS).optional(),
  update: z.object({ targetVersion: z.string().min(1).max(64) }).optional(),
});
export type MachinePresenceResponse = z.infer<typeof machinePresenceResponseSchema>;

export const machineOfflineBodySchema = z.object({ connectionId: z.string().min(1).max(64) });
export type MachineOfflineBody = z.infer<typeof machineOfflineBodySchema>;
export const machineOfflineResponseSchema = z.object({ applied: z.boolean() });
export type MachineOfflineResponse = z.infer<typeof machineOfflineResponseSchema>;

export const machineRecoverResponseSchema = z.object({
  steps: z.array(stepRecordSchema),
});
export type MachineRecoverResponse = z.infer<typeof machineRecoverResponseSchema>;

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

export const localMergeInstructionSchema = z.object({
  kind: z.literal('local-merge'),
  command: localMergeCommandSchema,
});

export function parseLocalMergeInstruction(
  prompt: string | null | undefined,
): LocalMergeCommand | null {
  if (prompt == null || !prompt.startsWith('{')) return null;
  try {
    const parsed = localMergeInstructionSchema.safeParse(JSON.parse(prompt));
    return parsed.success ? parsed.data.command : null;
  } catch {
    return null;
  }
}

export const localMergeResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('merged'), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  z.object({ outcome: z.enum(['held', 'recheck', 'checks-failed']), reason: z.string().min(1) }),
]);
export type LocalMergeResult = z.infer<typeof localMergeResultSchema>;
export const localMergeReportSchema = z.object({
  command: localMergeCommandSchema,
  result: localMergeResultSchema,
});
export type LocalMergeReport = z.infer<typeof localMergeReportSchema>;

export const machineLocalMergeRecheckBodySchema = z.object({
  command: localMergeCommandSchema,
});
export type MachineLocalMergeRecheckBody = z.infer<typeof machineLocalMergeRecheckBodySchema>;

export const machineLocalMergeRecheckResponseSchema = z.object({
  authorized: z.boolean(),
  reason: z.string().min(1).optional(),
});
export type MachineLocalMergeRecheckResponse = z.infer<
  typeof machineLocalMergeRecheckResponseSchema
>;

export const plainFolderStatusSchema = z.enum([
  'merged',
  'conflict',
  'undone',
  'no-changes',
  'disabled',
  'missing-folder',
  'folder-replaced',
  'disk-full',
  'snapshot-missing',
  'partial-unknown',
]);
export type PlainFolderStatus = z.infer<typeof plainFolderStatusSchema>;

export const plainFolderStepMetaSchema = z.object({
  mode: z.enum(['isolated', 'in-place']),
  status: plainFolderStatusSchema,
  undoable: z.boolean(),
  conflictFiles: z.array(z.string()).optional(),
  reason: z.string().optional(),
});
export type PlainFolderStepMeta = z.infer<typeof plainFolderStepMetaSchema>;

export const buildChangesPlainFolderStateSchema = z.object({
  mode: z.enum(['isolated', 'in-place']),
  status: plainFolderStatusSchema,
  undoable: z.boolean(),
  undoPending: z.boolean(),
  conflictFiles: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type BuildChangesPlainFolderState = z.infer<typeof buildChangesPlainFolderStateSchema>;

export const localFolderActionCommandSchema = z.object({
  action: z.enum(['undo', 'merge']),
  projectId: recordId,
  buildId: recordId,
});
export type LocalFolderActionCommand = z.infer<typeof localFolderActionCommandSchema>;

export const localFolderActionInstructionSchema = z.object({
  kind: z.literal('local-folder-action'),
  command: localFolderActionCommandSchema,
});

export function parseLocalFolderActionInstruction(
  prompt: string | null | undefined,
): LocalFolderActionCommand | null {
  if (prompt == null || !prompt.startsWith('{')) return null;
  try {
    const parsed = localFolderActionInstructionSchema.safeParse(JSON.parse(prompt));
    return parsed.success ? parsed.data.command : null;
  } catch {
    return null;
  }
}

export const localFolderActionOutcomeSchema = z.enum([
  'undone',
  'merged',
  'already-undone',
  'already-merged',
  'no-changes',
  'conflict',
  'missing-folder',
  'folder-replaced',
  'disabled',
  'disk-full',
  'snapshot-missing',
  'partial-unknown',
  'failed',
]);
export type LocalFolderActionOutcome = z.infer<typeof localFolderActionOutcomeSchema>;

export const localFolderActionResultSchema = z.object({
  outcome: localFolderActionOutcomeSchema,
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  conflictFiles: z.array(z.string()).optional(),
  reason: z.string().optional(),
});
export type LocalFolderActionResult = z.infer<typeof localFolderActionResultSchema>;

export const localFolderActionReportSchema = z.object({
  command: localFolderActionCommandSchema,
  result: localFolderActionResultSchema,
});
export type LocalFolderActionReport = z.infer<typeof localFolderActionReportSchema>;

const MIB = 1024 * 1024;

export { type DeliverableKind, deliverableKindSchema } from '../records/report.js';

export const DELIVERABLE_LIMITS = {
  maxFiles: 5,
  maxTotalBytes: 50 * MIB,
  maxPageBytes: 2 * MIB,
  maxSlidesBytes: 20 * MIB,
  maxImageBytes: 10 * MIB,
  maxRowsPerClaim: 10,
  maxNameChars: 120,
  maxSkipped: 20,
} as const;

export const claimedStepSchema = z.object({
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
export type ClaimedStep = z.infer<typeof claimedStepSchema>;

export const LOCAL_TOOL_CREATE_TAG = 'create_tag';

export const machineClaimResponseSchema = z.object({
  step: claimedStepSchema.nullable(),
});
export type MachineClaimResponse = z.infer<typeof machineClaimResponseSchema>;

export const machineAntigravityModelProbeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    models: z.array(antigravityProbedModelSchema).min(1).max(2000),
  }),
  z.object({
    status: z.literal('failed'),
    failure: z.enum(['auth', 'not-found', 'timeout', 'upstream']),
  }),
]);
export type MachineAntigravityModelProbeResult = z.infer<
  typeof machineAntigravityModelProbeResultSchema
>;

const modelProbeConnectionId = z.string().min(1).max(64);
export const machineAntigravityModelProbeBodySchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('claim'), connectionId: modelProbeConnectionId }),
  z.object({
    phase: z.literal('result'),
    connectionId: modelProbeConnectionId,
    result: machineAntigravityModelProbeResultSchema,
  }),
]);
export const machineAntigravityModelProbeCredentialSchema = z.object({
  token: z.string().regex(ANTIGRAVITY_TOKEN_REGEX),
});

export const subscriptionQuotaWindowSchema = z.object({
  name: z.string().min(1).max(64),
  utilization: z.number().min(0).max(1),
  resetsAt: z.number().int().nullable(),
  observedAt: z.number().int().nonnegative(),
});

export const machineAntigravityUsageProbeClaimSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('oauth'), credential: antigravityOAuthStepCredentialSchema }),
  z.object({ mode: z.literal('host') }),
]);
export type MachineAntigravityUsageProbeClaim = z.infer<
  typeof machineAntigravityUsageProbeClaimSchema
>;

export const machineAntigravityUsageProbeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    windows: z.array(subscriptionQuotaWindowSchema).max(32),
  }),
  z.object({
    status: z.literal('failed'),
    failure: providerFailureSchema,
  }),
]);
export type MachineAntigravityUsageProbeResult = z.infer<
  typeof machineAntigravityUsageProbeResultSchema
>;

export const machineAntigravityUsageProbeClaimBodySchema = z.object({
  connectionId: modelProbeConnectionId,
});
export const machineAntigravityUsageProbeResultBodySchema = z.object({
  connectionId: modelProbeConnectionId,
  result: machineAntigravityUsageProbeResultSchema,
});

export const antigravityCheckIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const machineStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wake') }),
  z.object({ type: z.literal('hello'), connectionId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('shutdown') }),
  z.object({ type: z.literal('steer'), stepId: recordId }),
  z.object({ type: z.literal('stop'), stepId: recordId }),
  z.object({
    type: z.literal('task.stop'),
    stepId: recordId,
    taskId: backgroundTaskSchema.shape.taskId,
  }),
  z.object({ type: z.literal('antigravity.models'), requestId: z.string().uuid() }),
  z.object({ type: z.literal('antigravity.usage'), requestId: z.string().uuid() }),
  z.object({ type: z.literal('antigravity.verify'), checkId: antigravityCheckIdSchema }),
  z.object({ type: z.literal('computer'), call: computerCallSchema }),
  z.object({ type: z.literal('computer.screen'), channel: computerScreenRequestSchema }),
  z.object({ type: z.literal('runtime.update'), runtime: managedUpdateRuntimeSchema }),
  z.object({ type: z.literal('token.rotate'), rotationId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('im.attach'), connId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('im.detach'), connId: z.string().min(1).max(128) }),
  z.object({
    type: z.literal('im.send'),
    connId: z.string().min(1).max(128),
    sendId: z.string().min(1).max(128),
    message: z.object({
      chatKey: z.string().min(1).max(512),
      text: z.string().max(64 * 1024),
      replyToMessageId: z.string().max(256).optional(),
      buttons: z
        .array(z.array(z.object({ label: z.string().max(256), value: z.string().max(256) })))
        .max(8)
        .optional(),
    }),
  }),
]);
export type MachineStreamEvent = z.infer<typeof machineStreamEventSchema>;

export const machineAntigravityVerifyBodySchema = z.object({
  checkId: antigravityCheckIdSchema,
  installed: z.boolean(),
  authenticated: z.boolean(),
  timedOut: z.boolean().optional(),
  version: z.string().min(1).max(64).optional(),
  source: z.enum(['local', 'managed']).optional(),
  models: z.array(antigravityModelSchema).max(500).optional(),
  durationMs: z.number().int().nonnegative().max(300_000).optional(),
  error: z.string().max(500).optional(),
});
export type MachineAntigravityVerifyBody = z.infer<typeof machineAntigravityVerifyBodySchema>;

export const steerAnswerSchema = z.object({
  requestId: z.string().min(1),
  text: z.string(),
});
export type SteerAnswer = z.infer<typeof steerAnswerSchema>;

export const machineSteerResponseSchema = z.object({
  content: z.string().nullable(),
  answers: z.array(steerAnswerSchema).optional(),
  messageIds: z.array(z.string()).optional(),
  steerSentAt: z.number().optional(),
});
export type MachineSteerResponse = z.infer<typeof machineSteerResponseSchema>;

export const machineSteerAckBodySchema = z.object({
  answerIds: z.array(z.string().min(1)).max(100).optional(),
  via: answerDeliveryViaSchema.optional(),
  messageIds: z.array(z.string().min(1).max(128)).max(500).optional(),
  steerSentAt: z.number().optional(),
});
export type MachineSteerAckBody = z.infer<typeof machineSteerAckBodySchema>;

export const machineStopResponseSchema = z.object({
  discard: z.boolean().nullable(),
});
export type MachineStopResponse = z.infer<typeof machineStopResponseSchema>;

export const machineHeartbeatBodySchema = z.object({
  baseSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable()
    .optional(),
  harnessHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type MachineHeartbeatBody = z.infer<typeof machineHeartbeatBodySchema>;

export const machineHeartbeatResponseSchema = machineOkResponseSchema;

export const machineTranscriptDeltaBodySchema = z.object({
  kind: z.literal('transcript_delta'),
  text: z.string(),
});
export type MachineTranscriptDeltaBody = z.infer<typeof machineTranscriptDeltaBodySchema>;

export const machineThinkingDeltaBodySchema = z.object({
  kind: z.literal('thinking_delta'),
  text: z.string(),
});
export type MachineThinkingDeltaBody = z.infer<typeof machineThinkingDeltaBodySchema>;

export const machineActivityBodySchema = z.object({
  kind: z.literal('activity'),
  activity: stepActivityReportSchema,
});
export type MachineActivityBody = z.infer<typeof machineActivityBodySchema>;

export const machineTranscriptRowBodySchema = z.object({
  kind: z.literal('transcript_row'),
  row: transcriptRowSchema,
});
export type MachineTranscriptRowBody = z.infer<typeof machineTranscriptRowBodySchema>;

export const machineAgentTodoBodySchema = z.object({
  kind: z.literal('agent_todo'),
  todo: agentTodoReportSchema,
});
export type MachineAgentTodoBody = z.infer<typeof machineAgentTodoBodySchema>;

export const machineBackgroundTaskBodySchema = z.object({
  kind: z.literal('bg_task'),
  task: backgroundTaskSchema,
});
export type MachineBackgroundTaskBody = z.infer<typeof machineBackgroundTaskBodySchema>;

export const machineToolBodySchema = z.union([
  toolCallRecordSchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineThinkingDeltaBodySchema,
  machineActivityBodySchema,
  machineTranscriptRowBodySchema,
  machineAgentTodoBodySchema,
  machineBackgroundTaskBodySchema,
]);

export const machineToolResponseSchema = z.union([
  machineOkResponseSchema,
  machineToolRelayResponseSchema,
]);

export const secretSurfaceSchema = z.enum(['orb', 'host']);
export type SecretSurface = z.infer<typeof secretSurfaceSchema>;

export const httpSecretGrantSchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.number().int().positive(),
  origin: z.string(),
  header: z.string(),
  template: z.string(),
  value: z.string(),
});
export type HttpSecretGrant = z.infer<typeof httpSecretGrantSchema>;

export const mcpConnectorEndpointSchema = z.object({
  slug: z.string(),
  transport: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type McpConnectorEndpoint = z.infer<typeof mcpConnectorEndpointSchema>;

export const machineTokenResponseSchema = z.object({
  commitIdentity: z.object({ name: z.string(), email: z.string() }).nullable().optional(),
  claudeSubscriptionToken: z.string().optional(),
  devinToken: z.string().optional(),
  antigravityToken: z.string().optional(),
  provider: providerConfigSchema.nullable(),
  secrets: z.record(z.string(), z.string()),
  httpSecrets: z.array(httpSecretGrantSchema).optional(),
  withheldSecrets: z.array(z.string()).optional(),
  mcpConnectors: z.array(mcpConnectorEndpointSchema).optional(),
  withheldMcp: z.array(z.string()).optional(),
  git: z
    .object({
      username: z.string(),
      password: z.string(),
      kind: z.enum(['app', 'unattributed']).optional(),
      expiresAt: z.number().int().positive().optional(),
    })
    .nullable(),
});
export type MachineTokenResponse = z.infer<typeof machineTokenResponseSchema>;

export const machineUploadUrlsBodySchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(DELIVERABLE_LIMITS.maxNameChars),
        size: z.number().int().min(0).optional(),
      }),
    )
    .max(8),
});
export const machineUploadUrlsResponseSchema = z.object({
  uploads: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      method: z.literal('PUT'),
      headers: z.record(z.string(), z.string()),
    }),
  ),
});

export type MachineUploadUrlsResponse = z.infer<typeof machineUploadUrlsResponseSchema>;

export const transcriptUploadSchema = z.object({
  stepId: recordId,
  messages: z.array(
    z.object({
      id: z.string(),
      role: messageRoleSchema,
      content: z.unknown(),
      createdAt: epochMs,
    }),
  ),
});
export type TranscriptUpload = z.infer<typeof transcriptUploadSchema>;

export const SESSION_FILE_NAME = 'session.jsonl';
export const SESSION_JSONL_MAX_BYTES = 10 * 1024 * 1024;

export const machineSessionResponseSchema = z.object({
  stepId: recordId,
  content: z.string(),
});
export type MachineSessionResponse = z.infer<typeof machineSessionResponseSchema>;

export const FINDINGS_ERROR_CHAR_LIMIT = 2_000;

export const QUOTA_BLOCK_REASON_MAX_CHARS = 500;

export const quotaBlockSchema = z.object({
  kind: z.enum(['quota', 'capacity']),
  providerId: z.string(),
  label: z.string().optional(),
  reason: z.string().max(QUOTA_BLOCK_REASON_MAX_CHARS),
  retryAfterMs: z.number().int().positive().optional(),
});
export type QuotaBlock = z.infer<typeof quotaBlockSchema>;

export { type StepFailureDetail, stepFailureCodeSchema, stepFailureDetailSchema };

export const machineDoneBodySchema = z.object({
  localMerge: localMergeReportSchema.optional(),
  localFolderAction: localFolderActionReportSchema.optional(),
  plainFolder: plainFolderStepMetaSchema.optional(),
  status: z.enum(['success', 'failed', 'stopped']),
  errorMessage: z.string().optional(),
  failureCode: stepFailureCodeSchema.optional(),
  failureDetail: stepFailureDetailSchema.optional(),
  sessionId: z.string().optional(),
  usage: z.array(modelUsageSchema).optional(),
  hasChanges: z.boolean().optional(),
  pushHookOutput: z.string().optional(),
  workBranchDrift: z.object({ expected: z.string().min(1), actual: z.string().min(1) }).optional(),
  commit: z.string().optional(),
  preservedCommits: z.array(z.string().regex(/^[0-9a-f]{40,64}$/)).optional(),
  gateHeadSha: z.string().optional(),
  findings: reviewVerdictSchema.optional(),
  findingsError: z.string().max(FINDINGS_ERROR_CHAR_LIMIT).optional(),
  prUrl: z.string().optional(),
  prNumber: z.number().int().optional(),
  changesDiff: z.string().optional(),
  verifyVerdict: verifyVerdictSchema.optional(),
  verifyVerdictError: z.string().max(FINDINGS_ERROR_CHAR_LIMIT).optional(),
  quotaBlock: quotaBlockSchema.optional(),
  noOutput: z.literal(true).optional(),
  skillInjectionFacts: skillInjectionFactsSchema.optional(),
  generation: z.number().int().optional(),
  unpushedCommits: z.number().int().nonnegative().nullable().optional(),
});
export type MachineDoneBody = z.infer<typeof machineDoneBodySchema>;
export const machineDoneResponseSchema = machineOkResponseSchema;

export const CHANGES_DIFF_MAX_BYTES = 512 * 1024;

export const machineSkillsManifestResponseSchema = z.object({
  selection: z.enum(['all', 'whitelist']),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      dirName: z.string(),
      files: z.array(
        z.object({
          path: z.string(),
          sizeBytes: z.number().int().min(0),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      ),
    }),
  ),
});
export type MachineSkillsManifestResponse = z.infer<typeof machineSkillsManifestResponseSchema>;

export const machineAttachmentResponseSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  contentBase64: z.string(),
});
export type MachineAttachmentResponse = z.infer<typeof machineAttachmentResponseSchema>;

export const machineTokenRotateClaimBodySchema = z.object({
  rotationId: z.string().min(1).max(64),
  connectionId: z.string().min(1).max(64),
  hostKey: hostKeySchema.optional(),
});
export type MachineTokenRotateClaimBody = z.infer<typeof machineTokenRotateClaimBodySchema>;

export const machineTokenRotateClaimResponseSchema = z.object({
  token: z.string().regex(MACHINE_TOKEN_PATTERN),
});
export type MachineTokenRotateClaimResponse = z.infer<typeof machineTokenRotateClaimResponseSchema>;

export const machineTokenRotateAckBodySchema = z.object({
  rotationId: z.string().min(1).max(64),
});
export type MachineTokenRotateAckBody = z.infer<typeof machineTokenRotateAckBodySchema>;

export const MACHINE_WIRE_EXTENSIONS = [
  {
    method: 'POST',
    path: '/api/machine/enroll/confirm',
    reason: '[设计] W4 #285 浏览器授权流完成面（授权页用户确认；capability=enrollId）',
  },
  {
    method: 'POST',
    path: '/api/machine/offline',
    reason:
      '[design] #4596 Runner goodbye on clean shutdown: ends only the caller machine connection named by connectionId (docs/design/runner-offline-grace.md)',
  },
  {
    method: 'POST',
    path: '/api/machine/antigravity/model-probes/{requestId}',
    reason: '[design] Claim and complete a subscription model probe on its assigned connection',
  },
  {
    method: 'POST',
    path: '/api/machine/antigravity/usage/{requestId}/claim',
    reason: '[design] Claim an Antigravity usage probe on its assigned connection',
  },
  {
    method: 'POST',
    path: '/api/machine/antigravity/usage/{requestId}/result',
    reason: '[design] Report the result of an Antigravity usage probe on its assigned connection',
  },
  {
    method: 'POST',
    path: '/api/machine/antigravity/verify',
    reason:
      '[design] live Antigravity Runner sign-in probe reply correlated by checkId and scoped to the authenticated machine',
  },
  {
    method: 'GET',
    path: '/api/machine/steer',
    reason: '[设计] W3 steer 拉取-确认（06 册 D9；claimed 步单槽 pending，?stepId=）',
  },
  {
    method: 'POST',
    path: '/api/machine/steer/ack',
    reason:
      '[design] #1938 steer delivery ack: the chief keeps a steered message queued until the daemon reports it reached the live session (?stepId=); #3512 the optional body {answerIds, via: poll | steer | session-start} is the only way an answer is marked delivered',
  },
  {
    method: 'GET',
    path: '/api/machine/stop',
    reason: '[设计] M7 #308 stop 拉取-确认（停止钮单槽 pending，?stepId=；steer 同律）',
  },
  {
    method: 'POST',
    path: '/api/machine/ask/{stepId}',
    reason:
      '[设计] #1049 结构化问答阻塞通道（ask_user 升级；requestId 幂等 + hold 长轮询 ~70s 到期回 pending；响应 machineAskResponseSchema）',
  },
  {
    method: 'GET',
    path: '/api/machine/skills/{stepId}',
    reason:
      '[设计] XMON-109 S1 技能分发清单（spec 14 daemon 注入契约的 S2 消费位；#920 改清单 + 按需拉：selection all/whitelist + 逐文件 sizeBytes/sha256；响应 machineSkillsManifestResponseSchema）',
  },
  {
    method: 'GET',
    path: '/api/machine/skills/{stepId}/file',
    reason:
      '[设计] #920 技能单文件按需拉取（?dirName=&path=；raw bytes application/octet-stream；清单外/白名单外/逃逸形一律 404 不泄存在性）',
  },
  {
    method: 'GET',
    path: '/api/machine/attachment/{stepId}/{attachmentId}',
    reason:
      '[设计] #730 daemon 侧图片附件下载（ownedStep + team 归属 + ready 闸；base64 载荷响应 machineAttachmentResponseSchema）',
  },
  {
    method: 'PUT',
    path: '/api/machine/upload/{uploadId}',
    reason: '[设计] upload-urls 预签名落地（self-host 无对象存储）；一次性 uploadId',
  },
  {
    method: 'GET',
    path: '/api/machine/session/{stepId}',
    reason: '[设计] #1512 按 stepId 取回步收尾上传的原始会话 JSONL（session.jsonl）',
  },
  {
    method: 'POST',
    path: '/api/machine/local-merge-recheck/{stepId}',
    reason:
      '[design] #5210 landing round-trip: after the local checks and before the ref write the daemon re-asks the claim-time authorization; a refusal or no answer stops the landing (docs/design/local-merge-landing-recheck.md)',
  },
  {
    method: 'POST',
    path: '/api/machine/phone-consent',
    reason:
      '[design] Live phone consent re-check during screen observe/act steps (docs/design/phone-computer.md)',
  },
  {
    method: 'GET',
    path: '/api/machine/computer/{callId}/attachment',
    reason:
      '[design] Stage an uploaded chat attachment onto the owner computer for a live stage_attachment computer call (docs/design/coordinator-inline-files.md)',
  },
  {
    method: 'POST',
    path: '/api/machine/computer/{callId}/attachment',
    reason:
      '[design] Single-use binary upload of a host file produced for a live Coordinator attach_file computer call (docs/design/coordinator-inline-files.md)',
  },
  {
    method: 'POST',
    path: '/api/machine/im/{connId}/event',
    reason:
      '[design] iMessage bridge inbound events (im.attach/im.detach/im.send/im.action) from the machine owning the connection; see docs/design/im-bridge.md',
  },
  {
    method: 'POST',
    path: '/api/machine/token-rotate/claim',
    reason:
      '[design] Claim a staged replacement runner token on the active connection (docs/design/runner-token-rotation.md)',
  },
  {
    method: 'POST',
    path: '/api/machine/token-rotate/ack',
    reason:
      '[design] Acknowledge persisted replacement runner token authenticated with the new token (docs/design/runner-token-rotation.md)',
  },
] as const;

export const MACHINE_WIRE = [
  {
    method: 'POST',
    path: '/api/machine/enroll',
    request: machineEnrollBodySchema,
    response: machineEnrollResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/enroll/start',
    request: machineEnrollStartBodySchema,
    response: machineEnrollStartResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/enroll/poll',
    request: machineEnrollPollBodySchema,
    response: machineEnrollPollResponseSchema,
  },
  { method: 'GET', path: '/api/machine/me', response: machineMeResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/presence',
    request: machinePresenceBodySchema,
    response: machinePresenceResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/rate-limit',
    request: claudeRateLimitReportSchema,
    response: machineOkResponseSchema,
  },
  { method: 'POST', path: '/api/machine/recover', response: machineRecoverResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/tasks/claim',
    request: machineClaimBodySchema,
    response: machineClaimResponseSchema,
  },
  { method: 'GET', path: '/api/machine/stream', response: machineStreamEventSchema },
  {
    method: 'POST',
    path: '/api/machine/heartbeat/{stepId}',
    request: machineHeartbeatBodySchema,
    response: machineHeartbeatResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/tool/{stepId}',
    request: machineToolBodySchema,
    response: machineToolResponseSchema,
  },
  { method: 'GET', path: '/api/machine/token/{stepId}', response: machineTokenResponseSchema },
  {
    method: 'POST',
    path: '/api/machine/upload-urls/{stepId}',
    request: machineUploadUrlsBodySchema,
    response: machineUploadUrlsResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/computer/{callId}',
    request: machineComputerFramesBodySchema,
    response: machineComputerFramesResponseSchema,
  },
  {
    method: 'POST',
    path: '/api/machine/done/{stepId}',
    request: machineDoneBodySchema,
    response: machineDoneResponseSchema,
  },
] as const;
