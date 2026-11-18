import { z } from 'zod';
import { agentTodoSchema } from '../agent-todo.js';
import { buildRecordSchema } from '../records/build.js';
import { recordId } from '../records/common.js';
import { transcriptRowSchema } from '../records/message.js';
import { notificationRecordSchema } from '../records/notification.js';
import { stepActivitySchema, stepJournalRowSchema } from '../records/step.js';
import { todoRecordSchema } from '../records/todo.js';
import { COMPUTER_STATES } from './computer.js';

export const SSE_CHANNELS = [
  {
    id: 'team',
    endpoint: '/api/teams/{id}/stream',
    audience: 'browser',
    note: '团队流（每个标签页唯一的浏览器流）：hello/ping/machine_presence/todo/build/notification，以及承载已订阅会话事件的 conversation 信封；会话订阅由 PUT /api/streams/{connectionId}/conversations 设定',
  },
  {
    id: 'conversation',
    endpoint: '/api/conversations/{id}/stream',
    audience: 'ios',
    note: '会话流（仅供 iOS 客户端；浏览器改走团队流内的 conversation 信封）：transcript 实时流（r3 §3.5 抓包）；逐事件载荷未枚举，承载 pi 流词表 [推断]（protocol/executor.ts）',
  },
  {
    id: 'machine',
    endpoint: '/api/machine/stream',
    audience: 'daemon',
    note: '机器 wake：低延迟派发唤醒 + sync 命令（M7 #319；r3 §1.5）',
  },
] as const;

export const TEAM_STREAM_PING_INTERVAL_MS = 15_000;

export const pingEventSchema = z.object({
  type: z.literal('ping'),
  seq: z.number().int(),
});

export const machinePresenceEventSchema = z.object({
  type: z.literal('machine_presence'),
  machineId: recordId,
  online: z.boolean(),
});

export const todoDocEventSchema = z.object({
  type: z.literal('todo'),
  seq: z.number().int(),
  v: z.number().int(),
  doc: todoRecordSchema,
});

export const buildDocEventSchema = z.object({
  type: z.literal('build'),
  seq: z.number().int(),
  v: z.number().int(),
  doc: buildRecordSchema,
});

export const notificationEventSchema = z.object({
  type: z.literal('notification'),
  notification: notificationRecordSchema,
});

export const computerStateEventSchema = z.object({
  type: z.literal('computer.state'),
  computerId: recordId,
  state: z.enum(COMPUTER_STATES),
});
export type ComputerStateEvent = z.infer<typeof computerStateEventSchema>;

export const conversationMessageEventSchema = z.object({
  type: z.literal('message'),
  conversationId: recordId.optional(),
  message: transcriptRowSchema,
  deliveredQueue: z.object({ conversationId: recordId, messageId: recordId }).optional(),
  clientMessageId: z.string().min(1).max(200).optional(),
});
export type ConversationMessageEvent = z.infer<typeof conversationMessageEventSchema>;

export const conversationTextDeltaEventSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const conversationThinkingDeltaEventSchema = z.object({
  type: z.literal('thinking_delta'),
  text: z.string(),
});

export const conversationStepEventSchema = z.object({
  type: z.literal('step'),
  step: stepJournalRowSchema,
});
export type ConversationStepEvent = z.infer<typeof conversationStepEventSchema>;

export const conversationActivityEventSchema = z.object({
  type: z.literal('activity'),
  activity: stepActivitySchema,
});
export type ConversationActivityEvent = z.infer<typeof conversationActivityEventSchema>;

export const conversationAgentTodoEventSchema = z.object({
  type: z.literal('agent_todo'),
  todo: agentTodoSchema,
});
export type ConversationAgentTodoEvent = z.infer<typeof conversationAgentTodoEventSchema>;

export const conversationStreamEventSchema = z.discriminatedUnion('type', [
  pingEventSchema,
  conversationMessageEventSchema,
  conversationTextDeltaEventSchema,
  conversationThinkingDeltaEventSchema,
  conversationStepEventSchema,
  conversationActivityEventSchema,
  conversationAgentTodoEventSchema,
]);
export type ConversationStreamEvent = z.infer<typeof conversationStreamEventSchema>;

export const streamHelloEventSchema = z.object({
  type: z.literal('hello'),
  connectionId: z.string().min(1),
});
export type StreamHelloEvent = z.infer<typeof streamHelloEventSchema>;

export const conversationEnvelopeEventSchema = z.object({
  type: z.literal('conversation'),
  conversationId: recordId,
  event: conversationStreamEventSchema,
});
export type ConversationEnvelopeEvent = z.infer<typeof conversationEnvelopeEventSchema>;

export const MAX_STREAM_CONVERSATIONS = 16;

export const streamConversationsBodySchema = z.object({
  conversationIds: z.array(recordId).max(MAX_STREAM_CONVERSATIONS),
});

export const teamStreamEventSchema = z.discriminatedUnion('type', [
  pingEventSchema,
  machinePresenceEventSchema,
  todoDocEventSchema,
  buildDocEventSchema,
  notificationEventSchema,
  computerStateEventSchema,
  streamHelloEventSchema,
  conversationEnvelopeEventSchema,
]);
export type TeamStreamEvent = z.infer<typeof teamStreamEventSchema>;
