// verify 步数据形态（#1250 / ADR 0018 层 1）：Verifier persona 的输入材料
// 组装与终轮 JSON verdict。与 records/review.ts 同族——server 组装材料、
// daemon 收尾时从会话末轮提取 verdict 回传（machineDoneBody.verifyVerdict）。
// 与 review 的分野：agent 不走 prompt meta header（verify 步走 assignment.verify
// 槽，与 plan/build 同形——ADR 0018 决策 1）；工作区不是只读检出而是会话分支
// 的可写工作区（证据包要提交进 docs/verify/ 并回贴 PR body）。

import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

/** 单条证据条目（verdict.evidence）：路径 + 可选说明。path = 证据包内相对
 * 仓根的文件路径（如 docs/verify/1250/e2e.json）。 */
export const verifyEvidenceSchema = z.object({
  path: z.string().min(1),
  note: z.string().optional(),
  /** 对应方案 Verification 清单的第几项（从 1 起，#1492）。缺省 = 老 verdict
   *  或无清单任务，不对应具体清单项。 */
  item: z.number().int().min(1).optional(),
});
export type VerifyEvidence = z.infer<typeof verifyEvidenceSchema>;

/** 验证结论（agent 终轮输出）：pass/fail + 一段总结 + 证据条目清单。 */
export const verifyVerdictSchema = z.object({
  /** 本轮交付是否通过验证（如实报——失败是有效结论，不是本步的错误）。 */
  passed: z.boolean(),
  /** 一段总结：跑了什么、对账结果（CI / PR body / 证据包）。 */
  conclusion: z.string(),
  /** 证据条目（缺省 = 无证据——「跑过但零产物」按未通过处理由人裁量）。 */
  evidence: z.array(verifyEvidenceSchema).default([]),
});
export type VerifyVerdict = z.infer<typeof verifyVerdictSchema>;

/** verify 步 prompt（server 组装单源；agentId 不在 prompt 里——assignment 槽
 * 承载）。材料 = 任务文本 + 方案全文 + 交付面（PR）+ 变更概览（审核关口可
 * 得时）。工作区段如实：会话分支的可写检出（证据要提交推送），与 review 步
 * 的只读检出段（records/review.ts CHECKOUT_SECTION）刻意不同。 */
export function buildVerifyStepPrompt(args: {
  /** 证据包目录的票号段（github 关联任务 = issue 号；否则 todo seqNum）。 */
  ticketRef: string;
  /** 任务文本（title+spec，buildTaskPromptText 同形由调用方组装）。 */
  taskText: string;
  /** 方案全文（无方案轮传空串——直执行任务照常可验）。 */
  planText: string;
  /** 方案 Verification 清单（#1492，plan.ts planVerificationItems 解析）。缺省或
   *  空 = 无清单（直执行任务、老方案），不出清单段。 */
  verificationItems?: readonly string[];
  /** 本轮交付的 PR（无 PR 传 null——hosted/local 形态如实说明）。 */
  pr: { number: number; url: string | null } | null;
  /** 变更面（审核关口可得时传；单文件级 diff 概览）。 */
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

/** 清单对账（#1492，server 收尾时调用）：方案有 Verification 清单时，清单里
 *  每一项都要有 evidence 对应（item 序号）；缺证据的项点名进结论、passed 置
 *  false——Verifier 漏验不能以「通过」落进合并闸。无清单 = 原样返回。 */
export function reconcileVerifyVerdict(
  verdict: VerifyVerdict,
  items: readonly string[],
): VerifyVerdict {
  if (items.length === 0) return verdict;
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
