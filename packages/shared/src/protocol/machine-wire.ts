import { z } from 'zod';
import { modelUsageSchema, providerConfigSchema, toolCallRecordSchema } from '../agent-backend.js';
import { agentTodoReportSchema } from '../agent-todo.js';
import { blockerHandoffSchema } from '../blocker-handoff-record.js';
import { claudeRateLimitReportSchema } from '../records/claude-rate-limit.js';
import { epochMs, recordId } from '../records/common.js';
import {
  MACHINE_FOLDER_PATH_MAX,
  MACHINE_FOLDER_PINS_LIMIT,
  machineRecordSchema,
} from '../records/machine.js';
import { confinementIdentitySchema } from '../records/machine-capabilities.js';
import {
  answerDeliveryViaSchema,
  messageRoleSchema,
  transcriptRowSchema,
} from '../records/message.js';
import { claudeCodeReportSchema } from '../records/model-source.js';
import { PROJECT_REPO_KINDS } from '../records/project.js';
import { reviewVerdictSchema } from '../records/review.js';
import { stepActivityReportSchema, stepRecordSchema } from '../records/step.js';
import { taskRequestSchema } from '../records/task-request.js';
import { taskDecisionSchema } from '../records/todo.js';
import { verifyVerdictSchema } from '../records/verify.js';
import { skillInjectionFactsSchema } from '../skill-injection-check.js';
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
import { engineScreenRequestSchema } from './engine-screen.js';
import { machineJsonSchema } from './executor.js';

export const machineEnrollBodySchema = z.object({
  teamId: recordId,
  name: z.string().optional(),
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  capabilities: z.unknown().optional(),
});
export type MachineEnrollBody = z.infer<typeof machineEnrollBodySchema>;

export const machineEnrollResponseSchema = machineJsonSchema;
export type MachineEnrollResponse = z.infer<typeof machineEnrollResponseSchema>;

export const MACHINE_ENROLL_TTL_MS = 600_000;

export const machineEnrollStartBodySchema = z.object({
  teamId: recordId.optional(),
  name: z.string().optional(),
});
export const machineEnrollStartResponseSchema = z.object({
  enrollId: z.string(),
  url: z.string(),
  code: z.string().optional(),
});

export const machineEnrollPollBodySchema = z.object({ enrollId: z.string() });
export const machineEnrollPollResponseSchema = z.union([
  z.object({ status: z.literal('pending'), name: z.string().optional() }),
  z.object({ status: z.literal('authorized'), machine: machineJsonSchema }),
  z.object({ status: z.literal('expired') }),
]);
export type MachineEnrollPollResponse = z.infer<typeof machineEnrollPollResponseSchema>;

export function enrollDisplayName(name: string | undefined): string | undefined {
  if (name === undefined || name.trim() === '' || name.length > 253 || /\p{C}/u.test(name))
    return undefined;
  return name;
}

export const machineEnrollConfirmBodySchema = z.union([
  z.object({ enrollId: z.string() }),
  z.object({ code: z.string().max(32) }),
]);

export function normalizeEnrollCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export const machineMeResponseSchema = machineRecordSchema;

export const MACHINE_ORB_CONVERSATIONS_LIMIT = 250;
export const machineClosedOrbsBodySchema = z.object({
  conversationIds: z
    .array(
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/),
    )
    .max(MACHINE_ORB_CONVERSATIONS_LIMIT),
});
export type MachineClosedOrbsBody = z.infer<typeof machineClosedOrbsBodySchema>;
export const machineClosedOrbsResponseSchema = z
  .array(recordId)
  .max(MACHINE_ORB_CONVERSATIONS_LIMIT);

export const machineFolderPinReportSchema = z.object({
  pin: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX),
  status: z.enum(['confirmed', 'rejected', 'absent']),
  canonicalPath: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX).optional(),
});
export type MachineFolderPinReport = z.infer<typeof machineFolderPinReportSchema>;

export const machineFoldersReportSchema = z.object({
  workspacesDir: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX).optional(),
  bindsGrants: z.literal(true).optional(),
  pins: z.array(machineFolderPinReportSchema).max(MACHINE_FOLDER_PINS_LIMIT).optional(),
});
export type MachineFoldersReport = z.infer<typeof machineFoldersReportSchema>;

export const machinePresenceBodySchema = z.object({
  computers: computerPresenceListSchema.optional(),
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  capabilities: z.unknown().optional(),
  connectionId: z.string().min(1).max(64).nullable().optional(),
  folders: machineFoldersReportSchema.optional(),
});
export type MachinePresenceBody = z.infer<typeof machinePresenceBodySchema>;
export const machineOkResponseSchema = z.object({ ok: z.literal(true) });

export const machinePresencePinSchema = z.object({
  path: z.string().min(1).max(MACHINE_FOLDER_PATH_MAX),
  status: z.enum(['pending', 'confirmed']),
  enabled: z.boolean(),
});
export type MachinePresencePin = z.infer<typeof machinePresencePinSchema>;

export const machinePresenceResponseSchema = machineOkResponseSchema.extend({
  folderPins: z.array(machinePresencePinSchema).max(MACHINE_FOLDER_PINS_LIMIT).optional(),
  installDevin: z.boolean().optional(),
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
  confinement: confinementIdentitySchema.optional(),
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

const MIB = 1024 * 1024;

export const DELIVERABLE_LIMITS = {
  maxFiles: 5,
  maxTotalBytes: 50 * MIB,
  maxPageBytes: 2 * MIB,
  maxSlidesBytes: 20 * MIB,
  maxRowsPerClaim: 10,
  maxNameChars: 120,
  maxSkipped: 20,
} as const;

export const deliverableKindSchema = z.enum(['page', 'slides']);
export type DeliverableKind = z.infer<typeof deliverableKindSchema>;

export const claimedStepSchema = z.object({
  localMerge: localMergeCommandSchema.optional(),
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
          localPath: z.string().optional(),
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

export const REPO_ARCHIVE_FILE_NAME = 'repo-archive.b64';
export const REPO_ARCHIVE_FAILED_FILE_NAME = 'repo-archive-failed.txt';

export const machineRepoArchiveCommandSchema = z.object({
  stepId: recordId,
  directory: z.string().min(1),
  ref: z.string().min(1),
  maxBytes: z.number().int().positive(),
});
export type MachineRepoArchiveCommand = z.infer<typeof machineRepoArchiveCommandSchema>;

export const machineStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wake') }),
  z.object({ type: z.literal('hello'), connectionId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('shutdown') }),
  z.object({ type: z.literal('steer'), stepId: recordId }),
  z.object({ type: z.literal('stop'), stepId: recordId }),
  z.object({ type: z.literal('repo.archive'), archive: machineRepoArchiveCommandSchema }),
  z.object({ type: z.literal('computer'), call: computerCallSchema }),
  z.object({ type: z.literal('computer.screen'), channel: computerScreenRequestSchema }),
  z.object({ type: z.literal('engine.screen'), channel: engineScreenRequestSchema }),
]);
export type MachineStreamEvent = z.infer<typeof machineStreamEventSchema>;

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

export const machineToolBodySchema = z.union([
  toolCallRecordSchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineThinkingDeltaBodySchema,
  machineActivityBodySchema,
  machineTranscriptRowBodySchema,
  machineAgentTodoBodySchema,
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
  ownAgentConfig: z.literal(true).optional(),
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

export const machineDoneBodySchema = z.object({
  localMerge: localMergeReportSchema.optional(),
  status: z.enum(['success', 'failed', 'stopped']),
  errorMessage: z.string().optional(),
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

export const MACHINE_WIRE_EXTENSIONS = [
  {
    method: 'POST',
    path: '/api/machine/enroll/confirm',
    reason: '[设计] W4 #285 浏览器授权流完成面（授权页用户确认；capability=enrollId）',
  },
  {
    method: 'POST',
    path: '/api/machine/orbs/closed',
    reason:
      '[design] #2274 bounded held build ids checked for closed or archived orb cleanup, scoped to the authenticated machine and team',
  },
  {
    method: 'POST',
    path: '/api/machine/offline',
    reason:
      '[design] #4596 Runner goodbye on clean shutdown: ends only the caller machine connection named by connectionId (docs/design/runner-offline-grace.md)',
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
