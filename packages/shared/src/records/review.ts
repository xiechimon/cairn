import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

export const reviewSeveritySchema = z.enum(['blocking', 'suggestion', 'info']);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

export const reviewFindingSchema = z.object({
  id: z.string(),
  severity: reviewSeveritySchema,
  summary: z.string(),
  description: z.string().optional(),
  file: z.string().optional(),
  line: z.coerce.number().int().positive().optional(),
  suggestion: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewVerdictSchema = z.object({
  conclusion: z.string(),
  gateLoosening: z.boolean().optional(),
  evalRulerChange: z.boolean().optional(),
  findings: z.array(reviewFindingSchema).default([]),
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export const reviewGateSchema = z.enum(['confirm', 'review']);
export type ReviewGate = z.infer<typeof reviewGateSchema>;

export const reviewPromptMetaSchema = z.object({
  kind: z.literal('review'),
  agentId: z.string(),
  gate: reviewGateSchema.optional(),
  expectedHeadSha: z.string().optional(),
});
export type ReviewPromptMeta = z.infer<typeof reviewPromptMetaSchema>;

export function parseReviewPromptMeta(prompt: string | null): ReviewPromptMeta | null {
  if (prompt === null) return null;
  const newline = prompt.indexOf('\n');
  const head = (newline === -1 ? prompt : prompt.slice(0, newline)).trim();
  if (!head.startsWith('{')) return null;
  try {
    const parsed = reviewPromptMetaSchema.safeParse(JSON.parse(head));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function buildReviewStepPrompt(args: {
  agentId: string;
  gate: ReviewGate;
  planText: string;
  changes?: readonly DocumentDiffFile[];
  checkout?: boolean;
  focus?: string;
  expectedHeadSha?: string;
}): string {
  const meta: ReviewPromptMeta = {
    kind: 'review',
    agentId: args.agentId,
    gate: args.gate,
    ...(args.expectedHeadSha !== undefined ? { expectedHeadSha: args.expectedHeadSha } : {}),
  };
  const focusNote =
    args.focus !== undefined && args.focus.trim() !== ''
      ? `\n\n## 用户关注点\n${args.focus.trim()}`
      : '';
  const head =
    args.gate === 'review'
      ? '请审核以下方案与本轮变更。**只读**：不得修改文件、不得提交、不得推送；如有 blocking 风险请明确标注，suggestion / info 请按需给出。'
      : '请审核以下方案。**只审核、不修改 worktree、不动 plan.md**；如有 blocking 风险请明确标注，suggestion / info 请按需给出。';
  const sections = [
    JSON.stringify(meta),
    head,
    '',
    '## 输出契约',
    '本步以单一 JSON 对象结尾输出 findings —— 你的最后一条消息内容必须是下列',
    '形式的合法 JSON（可前置解释性段落，但最后一段必须且仅能是这段 JSON）：',
    '```json',
    JSON.stringify(
      {
        conclusion: '<一句话结论：方案是否通过、关键风险概览>',
        ...(args.gate === 'review' ? { gateLoosening: false, evalRulerChange: false } : {}),
        findings: [
          {
            id: '1',
            severity: 'blocking | suggestion | info',
            summary: '<finding 标题>',
            description: '<finding 解释>',
            file: '<可选：受影响文件相对路径>',
            line: 42,
            suggestion: '<可选：修复建议>',
          },
        ],
      },
      null,
      2,
    ),
    '```',
    ...(args.gate === 'review'
      ? [
          'Answer gateLoosening and evalRulerChange explicitly with booleans. gateLoosening asks whether this change loosens a gate, check, or protected-path list. evalRulerChange asks whether it changes how the eval ruler measures. Either true blocks merging under ADR 0026; do not omit an answer or assume false.',
        ]
      : []),
    '注意：line 是数字行号（如 42），不要写成字符串；没有行号时省略该字段。',
    '',
    '## 待审核方案',
    args.planText,
  ];
  if (args.gate === 'review') {
    sections.push('', renderChangesSection(args.changes ?? [], args.checkout === true));
    if (args.checkout === true) sections.push('', CHECKOUT_SECTION);
  }
  return [...sections, focusNote].join('\n');
}

const CHECKOUT_SECTION = [
  '## 只读检出',
  '当前工作目录即本轮产物分支的检出：可以读完整文件，也可以实际跑验证命令（测试、构建、最小复现）。',
  '约束是硬的：不得修改文件、不得提交、不得推送——你对工作区造成的任何写入都会被丢弃，不会被采集、不会被合并。',
  '结论里请带上你实际跑过的命令与输出（让人能分辨「验过了」和「只是读了读」），并优先引用具体文件与行。',
].join('\n');

function renderChangesSection(files: readonly DocumentDiffFile[], checkout: boolean): string {
  if (files.length === 0) {
    return [
      '## 本轮变更',
      checkout
        ? '变更面为空——服务端此刻算不出差异（会话分支与默认分支无差异，或本项目形态下服务端不计算变更面）。请在检出里自行核对本轮实际改了什么；若确实无改动，如实说明，不要臆造代码层面的结论。'
        : '变更面为空——本轮无改动。请如实说明这一点，不要臆造代码层面的结论。',
    ].join('\n');
  }
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  const body = files
    .map((f) =>
      [
        `### ${f.path} (+${f.additions} −${f.deletions})`,
        '```diff',
        ...f.hunks.flatMap((h) => [h.header, ...h.lines]),
        '```',
      ].join('\n'),
    )
    .join('\n\n');
  return [
    '## 本轮变更',
    `本轮共 ${files.length} 个文件改动，+${additions} −${deletions}。以下为会话分支相对默认分支的完整 diff：`,
    '',
    body,
  ].join('\n');
}

export function hasBlockingFinding(verdict: ReviewVerdict): boolean {
  return verdict.findings.some((f) => f.severity === 'blocking');
}
