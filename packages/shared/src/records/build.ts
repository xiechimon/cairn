import { z } from 'zod';
import { epochMs, phaseSchema, recordId } from './common.js';
import { assignmentSchema } from './todo.js';

export const triggerSourceSchema = z.enum(['user', 'chief', 'schedule']);
export type TriggerSource = z.infer<typeof triggerSourceSchema>;

export const buildRecordSchema = z.object({
  id: recordId,
  todoId: recordId,
  withPlan: z.boolean(),
  prevPhase: phaseSchema.nullable(),
  triggerSource: triggerSourceSchema,
  planDocId: recordId.nullable(),
  errorMessage: z.string().nullable(),
  prUrl: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  diffHash: z.string().nullable(),
  reportAttachmentId: recordId.nullable().optional(),
  createdAt: epochMs,
});
export type BuildRecord = z.infer<typeof buildRecordSchema>;

export const startBuildsBodySchema = z.object({
  todoIds: z.array(recordId),
  assignment: assignmentSchema,
  withPlan: z.boolean(),
});
export type StartBuildsBody = z.infer<typeof startBuildsBodySchema>;

export const mergeAcceptedResponseSchema = z.object({
  delegated: z.literal(true),
});
export type MergeAcceptedResponse = z.infer<typeof mergeAcceptedResponseSchema>;

export const BUILD_FALLBACK_REPORT_HEAD = '构建步兜底报告';

export function buildFallbackReport(args: {
  reason: string;
  commits?: readonly string[];
  files?: readonly string[];
  pr: { number: number; url: string | null } | null;
}): string {
  const files =
    args.files === undefined
      ? '没有改动记录'
      : args.files.length === 0
        ? '无'
        : `${args.files.length} 个文件（${args.files.slice(0, 10).join('、')}${args.files.length > 10 ? ' 等' : ''}）`;
  const pr =
    args.pr !== null ? `#${args.pr.number}${args.pr.url !== null ? ` ${args.pr.url}` : ''}` : '无';
  return [
    `${BUILD_FALLBACK_REPORT_HEAD}：本步异常结束，以下由系统根据已知记录生成。`,
    `- 失败原因：${args.reason}`,
    `- 已知改动：${files}`,
    ...(args.commits?.map((commit) => `- Commit: ${commit}`) ?? []),
    `- PR：${pr}`,
    '- 下一步：看过失败原因后带反馈重跑。',
  ].join('\n');
}
