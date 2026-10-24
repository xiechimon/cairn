// AI 审核 findings 数据形态（M7 #330，r8 §3.1：审核消息「结论先行 + 编号
// findings + (blocking) 标记 + 引用方案块」+ blocking → agent 自动修订）。
// step 表无 agentId 列（r3 schema 投影未采 — review 步的 agentId 经 prompt
// 透出 + claim 载荷传机器；DB 不冗余；apps/server/test/review.test.ts 已钉
// 此口径）——agentId 在 review 步 prompt 头一行 JSON 元数据里携带，本文件
// 顺带承担 prompt meta header 的解析形态单源（不落库只走 wire）。

import { z } from 'zod';
import type { DocumentDiffFile } from './document-diff.js';

/** severity 词表（r8 §3.1 实测：blocking / suggestion / info 三值）。 */
export const reviewSeveritySchema = z.enum(['blocking', 'suggestion', 'info']);
export type ReviewSeverity = z.infer<typeof reviewSeveritySchema>;

/** 单条 finding（r8 §3.1：编号 + 严重度 + 引用位（文件:行）+ 摘要 + 可选
 * 建议）。summary = 标题行；description = 解释段；suggestion = 可选修复建议
 * 段——三条都是纯文本（与 r8 §3.1 渲染层拼装一致，不发明嵌套结构）。 */
export const reviewFindingSchema = z.object({
  /** 稳定 id（呈现层编号排序键；服务端写库时建议 1..N 自然序生成）。 */
  id: z.string(),
  severity: reviewSeveritySchema,
  /** finding 标题（r8 60/65：finding 段第一行；与 description 段区分）。 */
  summary: z.string(),
  /** finding 解释段（r8 60：finding 段第二行；多行按 \n 拆段渲染）。 */
  description: z.string().optional(),
  /** 引用文件路径（r8 60/65：file 字段；缺省 = 无引用）。 */
  file: z.string().optional(),
  /** 文件内行号（r8 60/65：file:line 形式；缺省 = 仅文件）。#808：模型常把
   * 行号写成字符串（如 "line": "1"）——coerce 容错，保持 int/positive 语义。 */
  line: z.coerce.number().int().positive().optional(),
  /** 建议修复段（r8 60/65：建议段；缺省 = 无建议）。 */
  suggestion: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

/** 完整审核结论（agent 终轮输出）；conclusion = 一段总结 + findings = 编号
 * 列表（r8 §3.1：结论先行 + 编号 findings）。 */
export const reviewVerdictSchema = z.object({
  /** 一段总结（r8 60：审核消息首段；方案是否通过 + 概览）。 */
  conclusion: z.string(),
  /** 编号 findings（按 id 升序；缺省 = 仅结论无 findings，含义 = 方案
   * 通过）。blocking 项触发 server 端自动修订回路。 */
  findings: z.array(reviewFindingSchema).default([]),
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

// —— review 步 prompt 元数据头（agentId 透传载体）————————————————————————

/** 审核关口（#511）：判据复用既有相位值，不新增状态——`confirm` = 方案就绪、
 * 尚未动工（事实还不存在，只审方案）；`review` = 本轮已产出改动（材料 = 方案
 * + 变更，审核者拿到的是人能看到的那份）。 */
export const reviewGateSchema = z.enum(['confirm', 'review']);
export type ReviewGate = z.infer<typeof reviewGateSchema>;

/** review 步 prompt 第一行 JSON meta 形状：kind + agentId（claim 载荷走
 * 该 agentId 拉取执行 Agent；DB 不冗余）+ gate（#511：step 表无相位列，
 * prompt 即是关口的持久载体——daemon 据此决定是否开只读检出）。daemon 解析
 * 同型，单源在本文件。 */
export const reviewPromptMetaSchema = z.object({
  kind: z.literal('review'),
  agentId: z.string(),
  /** 缺省 = 无该字段的存量 prompt（#511 之前入队）：按 `confirm` 语义处理
   * （不开检出、材料不含变更），与旧 server 行为逐字节一致。 */
  gate: reviewGateSchema.optional(),
  expectedHeadSha: z.string().optional(),
});
export type ReviewPromptMeta = z.infer<typeof reviewPromptMetaSchema>;

/** 从 prompt 头行解析 review 元数据（首行 = JSON；余下 = 任务文本）。
 * 解析失败 = null（调用方回退 assignment 槽；plan/build/chief 不带本头）。 */
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

/** 审核步材料 = 方案（对照基准）+ 变更（待审事实，仅审核关口）。审核的价值
 * 在「意图 vs 事实」的对照——只给方案那一半，审核者就只能对方案表态。 */
export function buildReviewStepPrompt(args: {
  agentId: string;
  /** 关口（#511）：材料与工作区形态都随它分叉。 */
  gate: ReviewGate;
  planText: string;
  /** 审核关口的变更材料。单源 = server git.ts readBuildChanges（与人的变更面
   * 同一计算路径，不另立一套 diff 逻辑——否则人和 AI 看到的东西会漂移）；
   * 变更面为空传 `[]`（材料如实写「无改动」）。confirm 关口不传。 */
  changes?: readonly DocumentDiffFile[];
  /** 是否真的有只读检出可读（项目已绑仓库 = 同一 repo 绑定位判据）。false =
   * 不写检出段——不谎称给了一个不存在的检出。 */
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
  // r8 §3.1：审核 = 只读；如有 blocking 风险请明确标注。
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
    // #808：示例里的 line 必须是数字形（不要写成字符串）；无行号时省略该字段。
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

/** 审核关口的只读检出说明（#511 阶段 2）：它才是「验证」与「通读」的分界
 * ——只给 diff 文本，审核者只能判断「这段代码看起来对不对」。 */
const CHECKOUT_SECTION = [
  '## 只读检出',
  '当前工作目录即本轮产物分支的检出：可以读完整文件，也可以实际跑验证命令（测试、构建、最小复现）。',
  '约束是硬的：不得修改文件、不得提交、不得推送——你对工作区造成的任何写入都会被丢弃，不会被采集、不会被合并。',
  '结论里请带上你实际跑过的命令与输出（让人能分辨「验过了」和「只是读了读」），并优先引用具体文件与行。',
].join('\n');

/** 变更段渲染（文件级 unified diff；与 docpane 变更面同一数据形态）。
 * 空态按有无检出分叉：变更面只对托管项目可算（服务端无本地库就没得 diff），
 * 有检出时审核者能自己看出改了什么——说成「无改动」会误导它给出「没改东西，
 * 通过」的结论。 */
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

/** 判断 verdict 是否含 blocking finding（blocking → 触发自动修订回路）。 */
export function hasBlockingFinding(verdict: ReviewVerdict): boolean {
  return verdict.findings.some((f) => f.severity === 'blocking');
}
