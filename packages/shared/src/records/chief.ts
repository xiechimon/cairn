import { z } from 'zod';
import { ATTACHMENT_TOKEN_LINE, renderAttachmentTokensToLabels } from '../attachment-token.js';
import { agentRecordSchema } from './agent.js';
import { epochMs, phaseSchema, recordId } from './common.js';
import { stepQueueBlockedSchema } from './machine-capabilities.js';

export const chiefIdFormat = (userId: string, teamId: string) => `chief-${userId}-${teamId}`;

export const CHIEF_THREAD_ID_PREFIX = 'chief-';

export function isChiefConversationId(id: string): boolean {
  return id.startsWith(CHIEF_THREAD_ID_PREFIX);
}

export const CHIEF_DIGEST_THREAD_ID_PREFIX = `${CHIEF_THREAD_ID_PREFIX}digest-`;

export function isChiefDigestThreadId(id: string): boolean {
  return id.startsWith(CHIEF_DIGEST_THREAD_ID_PREFIX);
}

export function chiefDigestThreadId(chiefId: string): string {
  return `${CHIEF_DIGEST_THREAD_ID_PREFIX}${chiefId}`;
}

export function newChiefThreadId(uuidv7: string): string {
  return `${CHIEF_THREAD_ID_PREFIX}${uuidv7}`;
}

export const chiefRecordSchema = z.object({
  id: z.string(),
  userId: recordId,
  teamId: recordId,
  agent: z.object({ agentId: recordId }).nullable(),
  charter: z.string().nullable(),
  lastTurnAt: epochMs.nullable(),
  createdAt: epochMs,
  tz: z.string().nullable().optional(),
});
export type ChiefRecord = z.infer<typeof chiefRecordSchema>;

export const chiefWatchSchema = z.object({
  todoId: recordId,
  projectId: recordId,
  seqNum: z.number().int(),
  title: z.string(),
  projectName: z.string(),
  phase: phaseSchema,
  reason: z.string(),
  createdAt: epochMs,
  threadId: recordId,
  threadTitle: z.string(),
});
export type ChiefWatch = z.infer<typeof chiefWatchSchema>;

export const CHIEF_WATCH_REASON_DISPATCH =
  'Dispatched by the chief: report back when it parks at a gate or settles.';

export const activeRunSchema = z
  .object({
    phase: z.string(),
    tool: z.object({ toolName: z.string() }).optional(),
  })
  .loose()
  .nullable();
export type ActiveRun = z.infer<typeof activeRunSchema>;

export const chiefOrchestrationActivitySchema = z.object({
  machineId: recordId,
  running: z.number().int(),
  waiting: z.number().int(),
});
export type ChiefOrchestrationActivity = z.infer<typeof chiefOrchestrationActivitySchema>;

export const chiefOutageSchema = z.object({
  reason: z.enum(['quota', 'capacity']),
  model: z.string().nullable(),
  retryAt: epochMs.nullable(),
});
export type ChiefOutage = z.infer<typeof chiefOutageSchema>;

export const chiefPendingMessageSchema = z.object({
  messageId: z.string(),
  state: z.enum(['queued', 'held']),
});
export type ChiefPendingMessage = z.infer<typeof chiefPendingMessageSchema>;

export const chiefGetResponseSchema = z.object({
  chief: chiefRecordSchema,
  agentActor: agentRecordSchema.nullable(),
  context: z
    .object({
      tokens: z.number().int(),
      contextWindow: z.number().int(),
    })
    .nullable(),
  watches: z.array(chiefWatchSchema),
  wakes: z.array(z.record(z.string(), z.unknown())),
  orchestration: z
    .object({
      homeMachineId: recordId.nullable(),
      activity: z.array(chiefOrchestrationActivitySchema),
    })
    .optional(),
  outage: chiefOutageSchema.nullable().optional(),
});
export type ChiefGetResponse = z.infer<typeof chiefGetResponseSchema>;

export const chiefThreadSchema = z.object({
  id: z.string(),
  chiefId: recordId,
  userId: recordId,
  teamId: recordId,
  title: z.string(),
  createdAt: epochMs,
  updatedAt: epochMs,
  lastTurnAt: epochMs.nullable(),
  session: z.object({
    runtime: z.literal('pi'),
    id: z.string(),
    openedAt: epochMs,
  }),
  pendingSessionResumeAt: epochMs.nullable(),
  toolDefHashes: z.record(z.string(), z.string()),
  toolResultHashes: z.record(z.string(), z.string()),
  activeRun: activeRunSchema,
  lastTurnError: z.string().nullable().optional(),
  pending: z.array(chiefPendingMessageSchema).optional(),
  fallbackModel: z.string().nullable().optional(),
  turnQueue: z
    .object({
      position: z.number().int().min(1),
      waitingFor: z
        .object({
          machineId: recordId,
          name: z.string(),
          running: z.number().int(),
          capacity: z.number().int(),
        })
        .nullable(),
      blocked: stepQueueBlockedSchema.optional(),
    })
    .nullable()
    .optional(),
});
export type ChiefThread = z.infer<typeof chiefThreadSchema>;

export const CHIEF_ENTITY_REF_SCHEMES = ['agent', 'todo'] as const;

export const patchChiefBodySchema = z
  .object({
    agent: z
      .object({
        agentId: recordId,
      })
      .nullish(),
    charter: z.string().nullish(),
  })
  .refine((b) => b.agent !== undefined || b.charter !== undefined, {
    message: 'expected agent and/or charter',
  });
export type PatchChiefBody = z.infer<typeof patchChiefBodySchema>;

export const chiefSendMessageBodySchema = z.object({
  threadId: z.string().nullable(),
  content: z.string().min(1),
});
export type ChiefSendMessageBody = z.infer<typeof chiefSendMessageBodySchema>;

export const chiefRewindBodySchema = z.object({
  messageId: z.string().min(1),
});
export type ChiefRewindBody = z.infer<typeof chiefRewindBodySchema>;

export const CHIEF_WAKE_KINDS = ['gate', 'settle', 'failed'] as const;
export type ChiefWakeKind = (typeof CHIEF_WAKE_KINDS)[number];

export function chiefThreadTitle(firstMessage: string): string {
  let fallback = '';
  for (const raw of firstMessage.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const token = ATTACHMENT_TOKEN_LINE.exec(line);
    if (token !== null) {
      if (fallback === '') fallback = token[1] ?? '';
      continue;
    }
    const rendered = renderAttachmentTokensToLabels(line);
    if (rendered === '') continue;
    return rendered.length > 12 ? `${rendered.slice(0, 12)}…` : rendered;
  }
  return fallback.length > 12 ? `${fallback.slice(0, 12)}…` : fallback;
}

export const CHIEF_REBIND_CONFIRM_COPY =
  '更换总管的 agent？总管的记忆保存在其运行所用的 Agent 上。切换至 <agent> 后，记忆将变为 <agent> 的记忆，当前记忆不会迁移。';

export const CHIEF_SETTINGS_TABS = ['Agent', '章程', '记忆', '关注与提醒'] as const;

export const CHIEF_WATCHES_EMPTY_COPY =
  '暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。';

export const CHIEF_INPUT_PLACEHOLDER = '有什么可以帮你的？';
export const CHIEF_INPUT_PLACEHOLDER_STEERING =
  '总管回完这条就看；想马上补充，发出后点「现在插话」';
