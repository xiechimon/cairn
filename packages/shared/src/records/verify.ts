import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

export const verifyEvidenceSchema = z.object({
  path: z.string().min(1),
  note: z.string().optional(),
  item: z.coerce.number().int().min(1).optional(),
});
export type VerifyEvidence = z.infer<typeof verifyEvidenceSchema>;

export const verifyVerdictSchema = z.object({
  passed: z.boolean(),
  conclusion: z.string(),
  evidence: z.array(verifyEvidenceSchema).default([]),
});
export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

export function buildVerifyStepPrompt(args: {
  ticketRef: string;
  taskText: string;
  planText: string;
  verificationItems?: readonly string[];
  pr: { number: number; url: string | null } | null;
  changes?: readonly DocumentDiffFile[];
}): string {
  const prSection =
    args.pr !== null
      ? [
          '## 本轮交付',
          `PR #${args.pr.number}${args.pr.url !== null ? `（${args.pr.url}）` : ''}——验证产物回贴它的 body（gh pr edit，机器 gh 凭据），证据目录随分支提交推送。`,
        ].join('\n')
      : [
          '## 本轮交付',
          '本任务无 GitHub PR（非 github 形态交付）——证据只落 docs/verify/ 并随会话分支提交，PR body 回贴段跳过。',
        ].join('\n');
  const changesSection =
    args.changes !== undefined && args.changes.length > 0
      ? [
          '',
          '## 变更概览',
          `${args.changes.length} 个文件（${args.changes.map((f) => f.path).join('、')}）——完整 diff 在工作区自查。`,
        ].join('\n')
      : '';
  const items = args.verificationItems ?? [];
  const checklistSection =
    items.length > 0
      ? [
          '',
          '## 验证清单',
          '方案的 Verification 清单如下。逐项执行并出判定：evidence 里每一项至少一条证据，用 item 字段写清单序号；清单里有项没有证据，本步按未通过记。',
          ...items.map((it, i) => `${i + 1}. ${it}`),
        ]
      : [];
  const sections = [
    `请验证以下任务的本轮交付。**验证步**：在会话分支的可写工作区上起真实栈跑 e2e / 关键路径，把证据（截图、API JSON、落库行、日志摘录）落进 docs/verify/${args.ticketRef}/，回贴 PR body，结尾按下方契约输出 verdict。工作区对验证产物可写：证据文件正常 git add / commit / push；除此之外不改动交付物本身。`,
    '',
    '## 输出契约',
    '本步以单一 JSON 对象结尾输出 verdict —— 你的最后一条消息内容必须是下列',
    '形式的合法 JSON（可前置解释性段落，但最后一段必须且仅能是这段 JSON）：',
    '```json',
    JSON.stringify(
      {
        passed: true,
        conclusion: '<一句话：跑通了什么、对账结果>',
        evidence: [
          {
            path: 'docs/verify/1250/<证据文件>',
            note: '<可选：这份证据证明了什么>',
            ...(items.length > 0 ? { item: 1 } : {}),
          },
        ],
      },
      null,
      2,
    ),
    '```',
    '注意：passed 如实报——验证发现缺陷时传 false 并在 conclusion 写明，这是有效结论不是本步失败；evidence.path 必须是仓内真实落盘的路径。',
    '',
    '## 待验证任务',
    args.taskText,
    ...(args.planText !== '' ? ['', '## 方案', args.planText] : []),
    ...checklistSection,
    '',
    prSection,
    changesSection,
  ];
  return sections.join('\n');
}

export function reconcileVerifyVerdict(
  verdict: VerifyVerdict,
  items: readonly string[],
): VerifyVerdict {
  if (items.length === 0) return verdict;
  if (!verdict.evidence.some((e) => e.item !== undefined)) {
    return { ...verdict, conclusion: `证据未按清单编号，未逐项对账。${verdict.conclusion}` };
  }
  const covered = new Set(verdict.evidence.map((e) => e.item));
  const missing = items.map((_, i) => i + 1).filter((n) => !covered.has(n));
  if (missing.length === 0) return verdict;
  const named = missing.map((n) => `第 ${n} 项`).join('、');
  return {
    ...verdict,
    passed: false,
    conclusion: `清单${named}无证据。${verdict.conclusion}`,
  };
}
