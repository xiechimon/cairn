import { z } from 'zod';
import { modelUsageSchema, providerConfigSchema, toolCallRecordSchema } from '../agent-backend.js';
import { agentTodoReportSchema } from '../agent-todo.js';
import { blockerHandoffSchema } from '../blocker-handoff-record.js';
import { epochMs, recordId } from '../records/common.js';
import { machineRecordSchema } from '../records/machine.js';
import { messageRoleSchema, transcriptRowSchema } from '../records/message.js';
import { claudeCodeReportSchema } from '../records/model-source.js';
import { PROJECT_REPO_KINDS } from '../records/project.js';
import { INFO_REPORT_MAX_BYTES } from '../records/report.js';
import { reviewVerdictSchema } from '../records/review.js';
import { stepActivityReportSchema, stepRecordSchema } from '../records/step.js';
import { verifyVerdictSchema } from '../records/verify.js';
import { skillInjectionFactsSchema } from '../skill-injection-check.js';
import {
  machineToolRelayBodySchema,
  machineToolRelayResponseSchema,
  remoteToolDefSchema,
} from './chief-tools.js';
import { machineJsonSchema } from './executor.js';

export const MACHINE_AUTH_HEADER = 'authorization';
export const MACHINE_AUTH_SCHEME = 'Bearer';

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

export const machineEnrollStartBodySchema = z.object({
  teamId: recordId.optional(),
  name: z.string().optional(),
});
export const machineEnrollStartResponseSchema = z.object({
  enrollId: z.string(),
  url: z.string(),
});

export const machineEnrollPollBodySchema = z.object({ enrollId: z.string() });
export const machineEnrollPollResponseSchema = z.union([
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('authorized'), machine: machineJsonSchema }),
  z.object({ status: z.literal('expired') }),
]);

export const machineEnrollConfirmBodySchema = z.object({ enrollId: z.string() });
export const machineEnrollConfirmResponseSchema = z.object({ machine: machineJsonSchema });

export const machineMeResponseSchema = machineRecordSchema;

export const machinePresenceBodySchema = z.object({
  cliVersion: z.string().optional(),
  claudeCode: claudeCodeReportSchema.optional(),
  capabilities: z.unknown().optional(),
});
export const machineOkResponseSchema = z.object({ ok: z.literal(true) });

export const machineRecoverResponseSchema = z.object({
  steps: z.array(stepRecordSchema),
});
export type MachineRecoverResponse = z.infer<typeof machineRecoverResponseSchema>;

export const machineClaimBodySchema = z.object({
  maxWorkers: z.number().int().min(1).optional(),
});
export type MachineClaimBody = z.infer<typeof machineClaimBodySchema>;

export const claimedStepSchema = z.object({
  step: stepRecordSchema,
  conversationId: recordId,
  session: z.object({
    action: z.enum(['new', 'continue']),
    sessionId: z.string().nullable(),
    priorMachineId: z.string().optional(),
  }),
  instruction: z.string().nullable().optional(),
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
      blockerHandoff: blockerHandoffSchema.optional(),
      output: z.string().nullable().optional(),
    })
    .optional(),
  project: z
    .object({
      id: recordId,
      name: z.string(),
      repo: z
        .object({
          kind: z.enum(PROJECT_REPO_KINDS),
          cloneUrl: z.string(),
          localPath: z.string().optional(),
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
    })
    .optional(),
  remoteTools: z.array(remoteToolDefSchema).optional(),
  localTools: z.array(z.string()).optional(),
  mcpServers: z.array(z.string()).optional(),
});
export type ClaimedStep = z.infer<typeof claimedStepSchema>;

export const LOCAL_TOOL_CREATE_TAG = 'create_tag';

export const machineClaimResponseSchema = z.object({
  step: claimedStepSchema.nullable(),
});
export type MachineClaimResponse = z.infer<typeof machineClaimResponseSchema>;

export const machineSyncCommandSchema = z.object({
  syncId: recordId,
  buildId: recordId,
  projectId: recordId,
  cloneUrl: z.string(),
  directory: z.string(),
  ref: z.string(),
  commit: z.string(),
  force: z.boolean(),
});
export type MachineSyncCommand = z.infer<typeof machineSyncCommandSchema>;

export const machineSyncResultBodySchema = z.object({
  status: z.enum(['running', 'synced', 'failed']),
  errorMessage: z.string().optional(),
});
export type MachineSyncResultBody = z.infer<typeof machineSyncResultBodySchema>;

export const machineSyncResultResponseSchema = machineOkResponseSchema;

export const machineStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('wake') }),
  z.object({ type: z.literal('shutdown') }),
  z.object({ type: z.literal('steer'), stepId: recordId }),
  z.object({ type: z.literal('stop'), stepId: recordId }),
  z.object({ type: z.literal('sync'), sync: machineSyncCommandSchema }),
]);
export type MachineStreamEvent = z.infer<typeof machineStreamEventSchema>;

export const machineSteerResponseSchema = z.object({
  content: z.string().nullable(),
});
export type MachineSteerResponse = z.infer<typeof machineSteerResponseSchema>;

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

export const machineTokenResponseSchema = z.object({
  provider: providerConfigSchema.nullable(),
  secrets: z.record(z.string(), z.string()),
  git: z
    .object({
      username: z.string(),
      password: z.string(),
    })
    .nullable(),
});
export type MachineTokenResponse = z.infer<typeof machineTokenResponseSchema>;

export const machineUploadUrlsBodySchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().min(0).optional(),
    }),
  ),
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
  report: z.string().max(INFO_REPORT_MAX_BYTES).optional(),
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
    method: 'GET',
    path: '/api/machine/steer',
    reason: '[设计] W3 steer 拉取-确认（06 册 D9；claimed 步单槽 pending，?stepId=）',
  },
  {
    method: 'POST',
    path: '/api/machine/steer/ack',
    reason:
      '[design] #1938 steer delivery ack: the chief keeps a steered message queued until the daemon reports it reached the live session (?stepId=)',
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
    path: '/api/machine/sync-result/{syncId}',
    reason:
      '[设计] M7 #319 分支对话框「同步到机器」daemon 回写结果（08 册附录 B；状态机 pending→running→synced/failed）',
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
    path: '/api/machine/done/{stepId}',
    request: machineDoneBodySchema,
    response: machineDoneResponseSchema,
  },
] as const;
