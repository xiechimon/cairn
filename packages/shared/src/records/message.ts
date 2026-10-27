import { z } from 'zod';
import { activeRunSchema } from './chief.js';
import { epochMs, recordId } from './common.js';

export const messageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageRecordSchema = z
  .object({
    role: messageRoleSchema,
    content: z.unknown(),
  })
  .loose();
export type MessageRecord = z.infer<typeof messageRecordSchema>;

export const transcriptRowSchema = messageRecordSchema.extend({
  id: recordId,
  createdAt: epochMs,
  actor: z.string().nullish(),
});
export type TranscriptRow = z.infer<typeof transcriptRowSchema>;

export const SYSTEM_MESSAGE_KINDS = ['machine_selected'] as const;

export const MERGE_ANNOUNCEMENT = '发起了合并';

export const MERGE_HUMAN_ONLY_COPY =
  '合并动作只由人触发，机器（chief / MCP）不得合并。请在任务详情页的审阅关口点击「完成」按钮手动合并。';

export const REVIEW_ANNOUNCEMENT = '发起了 AI 审核';

export const CONFIRM_ANNOUNCEMENT = '通过了确认';

export const DONE_ANNOUNCEMENT = '标记为已完成';

export const VERIFY_ANNOUNCEMENT = '发起了交付验证';

export const SPLIT_ANNOUNCEMENT = '发起了拆解';

export const GATE_ANNOUNCEMENTS: readonly string[] = [
  MERGE_ANNOUNCEMENT,
  REVIEW_ANNOUNCEMENT,
  CONFIRM_ANNOUNCEMENT,
  DONE_ANNOUNCEMENT,
  VERIFY_ANNOUNCEMENT,
  SPLIT_ANNOUNCEMENT,
];

export const REVIEW_COMPLETE_PLACEHOLDER = 'AI 审核已完成';
export const REVIEW_VERDICT_KIND = 'review_verdict';

export const VERIFY_VERDICT_KIND = 'verify_verdict';

export const CHIEF_TURN_ERROR_KIND = 'chief_turn_error';
export const chiefTurnErrorContentSchema = z.object({
  kind: z.literal(CHIEF_TURN_ERROR_KIND),
  message: z.string(),
});
export type ChiefTurnErrorContent = z.infer<typeof chiefTurnErrorContentSchema>;

export const CHIEF_DIGEST_KIND = 'chief_digest';
export const CHIEF_DIGEST_ROW_ID_PREFIX = 'chief-digest-';
export const CHIEF_DIGEST_GROUPS = ['decided', 'done', 'open', 'remembered'] as const;
export const chiefDigestGroupSchema = z.enum(CHIEF_DIGEST_GROUPS);
export const CHIEF_DIGEST_GROUP_LABELS = {
  decided: '决定',
  done: '完成',
  open: '还开着',
  remembered: '记住了',
} as const satisfies Record<(typeof CHIEF_DIGEST_GROUPS)[number], string>;
export type ChiefDigestGroup = z.infer<typeof chiefDigestGroupSchema>;

export const chiefDigestItemSchema = z.object({
  group: chiefDigestGroupSchema,
  text: z.string().min(1).max(400),
  reason: z.string().max(400),
  memory: z.object({ id: z.string(), agentId: z.string() }).optional(),
});
export type ChiefDigestItem = z.infer<typeof chiefDigestItemSchema>;

export const chiefDigestContentSchema = z.object({
  kind: z.literal(CHIEF_DIGEST_KIND),
  reason: z.enum(['daily', 'threshold']),
  coversUntil: z.number(),
  madeAt: z.number(),
  items: z.array(chiefDigestItemSchema),
});
export type ChiefDigestContent = z.infer<typeof chiefDigestContentSchema>;

export const CHIEF_TURN_STOPPED_KIND = 'chief_turn_stopped';
export const chiefTurnStoppedContentSchema = z.object({
  kind: z.literal(CHIEF_TURN_STOPPED_KIND),
  todos: z.array(z.object({ id: z.string(), seq: z.number().int(), title: z.string() })),
});
export type ChiefTurnStoppedContent = z.infer<typeof chiefTurnStoppedContentSchema>;

export const CHIEF_MODEL_FALLBACK_KIND = 'chief_model_fallback';
export const chiefModelFallbackContentSchema = z.object({
  kind: z.literal(CHIEF_MODEL_FALLBACK_KIND),
  from: z.string(),
  to: z.string(),
  stepId: z.string(),
});
export type ChiefModelFallbackContent = z.infer<typeof chiefModelFallbackContentSchema>;

export const ASK_USER_QUESTION_KIND = 'ask_user_question';

export const askUserQuestionSchema = z.object({
  header: z.string().min(1),
  question: z.string().min(1),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .max(8),
  multiSelect: z.boolean().optional(),
});
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

export const askUserAnswerSchema = z
  .object({
    header: z.string(),
    choices: z.array(z.string().min(1)).optional(),
    text: z.string().optional(),
  })
  .refine((a) => (a.choices !== undefined) !== (a.text !== undefined), {
    message: 'answer carries exactly one of choices | text',
  });
export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

export const askUserQuestionContentSchema = z.object({
  kind: z.literal(ASK_USER_QUESTION_KIND),
  requestId: z.string().min(1),
  status: z.enum(['pending', 'answered', 'cancelled']),
  questions: z.array(askUserQuestionSchema).min(1).max(4),
  answers: z.array(askUserAnswerSchema).nullable(),
  cancelReason: z.string().optional(),
});
export type AskUserQuestionContent = z.infer<typeof askUserQuestionContentSchema>;

export const askUserAnswerBodySchema = z.object({
  answers: z.array(askUserAnswerSchema).min(1),
});
export type AskUserAnswerBody = z.infer<typeof askUserAnswerBodySchema>;

export const ASK_REQUEST_ID_PATTERN = /^ask-[0-9a-f][0-9a-f-]{7,63}$/;
export const machineAskBodySchema = z.object({
  requestId: z.string().regex(ASK_REQUEST_ID_PATTERN),
  questions: z.array(askUserQuestionSchema).min(1).max(4),
});
export type MachineAskBody = z.infer<typeof machineAskBodySchema>;

export const machineAskResponseSchema = z.object({
  status: z.enum(['pending', 'answered', 'cancelled']),
  requestId: z.string(),
  answers: z.array(askUserAnswerSchema).nullable(),
  reason: z.string().nullable(),
});
export type MachineAskResponse = z.infer<typeof machineAskResponseSchema>;

export function buildReworkReuseNote(input: {
  prNumber: number | null;
  prUrl: string | null;
  failureReason: string | null;
}): string {
  const pr = input.prNumber !== null ? `，更新原 PR #${input.prNumber}` : '';
  const reason = input.failureReason !== null ? `上一轮失败原因：${input.failureReason}。` : '';
  return `返工回到本分支继续${pr}。${reason}`;
}

export function buildReworkNewBranchNote(input: {
  prNumber: number | null;
  prUrl: string | null;
  branch: string;
  outcome: 'merged' | 'closed';
}): string {
  const pr = input.prNumber !== null ? `#${input.prNumber}` : (input.prUrl ?? '');
  const tail =
    input.outcome === 'merged' ? '已合并，返工在新分支上重启' : '已关闭，返工在新分支上重启';
  return `原 PR ${pr} ${tail}（${input.branch}）。`;
}

export function buildMergedPrGuardNote(input: { prNumber: number; prUrl: string | null }): string {
  const url = input.prUrl !== null ? `（${input.prUrl}）` : '';
  return `守卫生效：本任务首 PR #${input.prNumber}${url} 已在 GitHub 合并，本轮已指示执行侧不再开新 PR（如确有改动，在会话分支上提交并推送）。`;
}

export function buildSecondPrWarningNote(input: {
  prNumber: number;
  mergedPrNumber: number;
  mergedPrUrl: string | null;
}): string {
  const mergedUrl = input.mergedPrUrl !== null ? `（${input.mergedPrUrl}）` : '';
  return `警告：本轮开出了新 PR #${input.prNumber}，而本任务首 PR #${input.mergedPrNumber}${mergedUrl} 已合并——疑似重复交付，请人工复核。`;
}

export function mergedPrGuardNoteRowId(buildId: string): string {
  return `merged-pr-guard-${buildId}`;
}

export function secondPrWarningNoteRowId(buildId: string): string {
  return `second-pr-warn-${buildId}`;
}

export function projectRenamedNote(input: { from: string; to: string }): string {
  return `项目已从「${input.from}」改名为「${input.to}」。`;
}

export function projectGithubRepoRetargetedNote(input: { from: string; to: string }): string {
  return `项目的 GitHub 仓库已从「${input.from}」更换为「${input.to}」。`;
}

export function projectConvertedNote(input: {
  githubRepo: string;
  localPath: string | null;
}): string {
  const accel = input.localPath !== null ? `，本机加速路径 ${input.localPath}` : '';
  return `项目形态已从 local 转换为 GitHub（${input.githubRepo}${accel}）。`;
}

export const conversationMessagesResponseSchema = z.object({
  messages: z.array(transcriptRowSchema),
  chips: z.unknown(),
  historyEpoch: z.number().int(),
  steerPending: z.array(z.unknown()),
  activeRun: activeRunSchema,
  nextCursor: z.unknown(),
});
export type ConversationMessagesResponse = z.infer<typeof conversationMessagesResponseSchema>;

export const STOP_MESSAGE = '已取消';

export const buildSteerBodySchema = z.object({
  content: z.string().min(1),
});
export type BuildSteerBody = z.infer<typeof buildSteerBodySchema>;

export const buildStopBodySchema = z.object({
  discard: z.boolean(),
});
export type BuildStopBody = z.infer<typeof buildStopBodySchema>;
