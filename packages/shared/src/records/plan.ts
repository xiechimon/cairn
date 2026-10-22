// plan record——02 §4.2（r5 §4 实走改判）：plan 即文件（plan.md），
// 版本 = 文件版本（驳回 → v2 + plan.md 文件级 unified diff）；plan 是 build
// facet（Context / Changes / Edge cases / Verification 四段卡），非独立实体
// （CONTEXT.md）。四段为 LLM 自由文本，结构非硬 schema（r3 §3.3）。

import { z } from 'zod';
import { epochMs, recordId } from './common.js';

/** 文件名 canon（02 §4.2：plan 即文件 plan.md）。 */
export const PLAN_FILE_NAME = 'plan.md';

/** 四段卡软结构（r3 §3.3 plan 卡：Context: / Changes: / Edge cases: /
 * Verification:；Edge cases 可省略——LLM 自由文本）。 */
export const PLAN_SECTIONS = ['Context', 'Changes', 'Edge cases', 'Verification'] as const;

/** wire 记录未实测（build.planDocId 为观测触点，r5 §7.2；文档头版本 chip
 * v1/v2 + 下拉 `vN · 相对时间`，r5 §4），最小投影 [推断]。 */
export const planRecordSchema = z.object({
  /** = build.planDocId（documents/{id}/diff 的 {id} 同值）。 */
  id: recordId,
  buildId: recordId, // ≡ conversationId
  /** 文档版本（v1、v2…，r5 §4 版本机制）。 */
  version: z.number().int().min(1),
  createdAt: epochMs,
});
export type PlanRecord = z.infer<typeof planRecordSchema>;

/** GET /api/builds/{id}/plans 行（M5 [推断] 封套，wire.test INFERRED_ROUTES
 * 登记）：record + plan.md 内容透出（版本下拉/文档 pane 数据源，r5 §4 触点；
 * [内部] content 列在 record 投影外，封套位承载）。server/web 双端单源。 */
export const planRowSchema = planRecordSchema.extend({
  content: z.string(),
});
export type PlanRow = z.infer<typeof planRowSchema>;

// —— #1492 plan 结构契约：Verification 必须可机器校验 ————————————————

/** 结构闸结论：过闸带出 Verification 清单（verify 步逐项出判定的输入）；
 *  不过闸带出点名的问题（补写轮提示词与失败原因共用）。 */
export type PlanContractCheck = { ok: true; items: string[] } | { ok: false; problem: string };

/** 一项检查的「可执行锚点」。纯规则判定，不引入 LLM 判官（#1492 失败方式）：
 *  行内代码、URL、带扩展名的仓内路径、接口路径，或命令词。代码围栏整体算
 *  一项且自带锚点，不经这张表。 */
const ANCHOR_PATTERNS: readonly RegExp[] = [
  /`[^`]+`/,
  /https?:\/\/\S+/,
  /[\w.-]+(?:\/[\w.-]+)+\.\w{1,8}\b/,
  // 仓根下的单个文件名（README.md、package.json）也是可核对的对象。
  /\b[\w.-]*\w\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|toml|sql|sh|py|go|rs|css|html)\b/i,
  /(?:^|\s)\/[\w-]+(?:\/[\w:{}.-]+)+/,
  // 不歧义的命令词出现在任意位置都算（「跑 pnpm lint」）。
  /\b(?:pnpm|npm|npx|vitest|playwright|pytest|curl|gh|git|bash|cargo|docker)\b/i,
  // 会和普通词撞车的命令词只认行首。
  /^(?:node|make|python3?|go|sh|bun|deno)\b/i,
];

/** 模糊占位词：任一项含它即拒，带锚点也不行。英文只认全大写（小写 todo 是
 *  本仓的业务名词）；行内代码里的字样不算（`rg TODO src` 是正经检查）。 */
const VAGUE_PATTERN = /\b(?:TODO|TBD|FIXME)\b|待定|待补|待确认/;

const LIST_ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LABEL = /^(?:\d+[.)、]\s*)?([A-Za-z][A-Za-z ]{0,24}?)\s*[:：]\s*(.*)$/;

/** 小节名归一：去强调符、序号前缀（「4. 」）与尾部冒号（半角 / 全角）。 */
function cleanSectionName(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^\d+(?:\.\d+)*[.)、]?\s*/, '')
    .replace(/\s*[:：]\s*$/, '')
    .trim()
    .toLowerCase();
}

function isPlanSectionName(name: string): boolean {
  return PLAN_SECTIONS.some((s) => s.toLowerCase() === name);
}

type SectionMark =
  | { kind: 'heading'; level: number; name: string }
  | { kind: 'label'; name: string; rest: string };

/** 一行是不是小节起头：`## Verification`（含 `## 4. Verification：`）或行首
 *  标签 `Verification:`（含 `**Verification**:`）。 */
function sectionMark(line: string): SectionMark | null {
  const h = HEADING.exec(line);
  if (h !== null) {
    return { kind: 'heading', level: h[1]?.length ?? 1, name: cleanSectionName(h[2] ?? '') };
  }
  const l = LABEL.exec(line.replace(/\*\*|__/g, ''));
  if (l === null) return null;
  return { kind: 'label', name: cleanSectionName(l[1] ?? ''), rest: (l[2] ?? '').trim() };
}

/** 取出 Verification 小节：标签同行余段（head）+ 小节原始行。undefined =
 *  没有该小节。标题写法遇到同级或更高级标题、或其它四段起头即止；标签
 *  写法遇到任何标题或其它四段标签即止。小节内的下级标题只是分组，跳过。 */
function verificationSection(content: string): { head: string; lines: string[] } | undefined {
  const lines = content.split('\n');
  let start = -1;
  let level = 0;
  let head = '';
  for (let i = 0; i < lines.length; i++) {
    const mark = sectionMark((lines[i] ?? '').trim());
    if (mark?.name !== 'verification') continue;
    start = i + 1;
    if (mark.kind === 'heading') level = mark.level;
    else head = mark.rest;
    break;
  }
  if (start < 0) return undefined;
  const out: string[] = [];
  let inFence = false;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    const fenceLine = line.startsWith('```');
    if (!inFence && !fenceLine) {
      const mark = sectionMark(line);
      if (mark?.kind === 'heading') {
        if (level === 0 || mark.level <= level || isPlanSectionName(mark.name)) break;
        continue;
      }
      if (mark?.kind === 'label' && isPlanSectionName(mark.name)) break;
    }
    if (fenceLine) inFence = !inFence;
    out.push(raw);
  }
  return { head, lines: out };
}

/** 小节 → 检查项。一个代码围栏整体算一项；有列表时列表项各算一项，缩进的
 *  子项和非列表行并入上一项（「期望全部通过」这类补充说明），列表之前的
 *  引导句不算项；没有列表时每个非空行各算一项。标签同行余段总是一项。 */
function splitItems(section: { head: string; lines: string[] }): {
  text: string;
  fenced: boolean;
}[] {
  const isList = (raw: string) => LIST_ITEM.test(raw);
  let inFenceScan = false;
  const hasList = section.lines.some((raw) => {
    if (raw.trim().startsWith('```')) inFenceScan = !inFenceScan;
    return !inFenceScan && isList(raw);
  });
  const items: { text: string; fenced: boolean; indent: number | null }[] = [];
  if (section.head !== '') items.push({ text: section.head, fenced: false, indent: null });
  let fence: string[] | null = null;
  for (const raw of section.lines) {
    const line = raw.trim();
    if (fence !== null) {
      fence.push(raw);
      if (line.startsWith('```')) {
        items.push({ text: fence.join('\n'), fenced: true, indent: null });
        fence = null;
      }
      continue;
    }
    if (line.startsWith('```')) {
      fence = [raw];
      continue;
    }
    if (line === '') continue;
    const prev = items[items.length - 1];
    const li = LIST_ITEM.exec(raw);
    if (li !== null) {
      const indent = li[1]?.length ?? 0;
      const text = (li[2] ?? '').trim();
      if (prev?.indent != null && indent > prev.indent) prev.text = `${prev.text} ${text}`;
      else items.push({ text, fenced: false, indent });
      continue;
    }
    if (!hasList) items.push({ text: line, fenced: false, indent: null });
    else if (prev !== undefined && !prev.fenced) prev.text = `${prev.text} ${line}`;
  }
  // 未闭合的围栏照样算一项（模型漏写收尾 ``` 不该把命令判成空话）。
  if (fence !== null) items.push({ text: fence.join('\n'), fenced: true, indent: null });
  return items.map(({ text, fenced }) => ({ text, fenced }));
}

/** plan.md 结构闸（#1492）：Verification 小节必须存在、非空，每一项都有
 *  可执行锚点且不含模糊占位词。其余三段仍是自由文本（r3 §3.3），不在此校验。 */
export function checkPlanContract(content: string): PlanContractCheck {
  const section = verificationSection(content.replace(/\r\n?/g, '\n'));
  if (section === undefined) return { ok: false, problem: '方案缺少 Verification 小节' };
  const items = splitItems(section);
  if (items.length === 0) return { ok: false, problem: 'Verification 小节为空' };
  const vague: number[] = [];
  const unanchored: number[] = [];
  items.forEach((item, i) => {
    if (item.fenced) return;
    if (VAGUE_PATTERN.test(item.text.replace(/`[^`]*`/g, ''))) vague.push(i + 1);
    else if (!ANCHOR_PATTERNS.some((p) => p.test(item.text))) unanchored.push(i + 1);
  });
  const named = (ns: number[]) => ns.map((n) => `第 ${n} 项`).join('、');
  const problems: string[] = [];
  if (unanchored.length > 0)
    problems.push(
      `Verification ${named(unanchored)}没有可执行的检查（要写命令、测试文件路径或可断言的结果）`,
    );
  if (vague.length > 0) problems.push(`Verification ${named(vague)}含待定之类的占位词`);
  if (problems.length > 0) return { ok: false, problem: problems.join('；') };
  return { ok: true, items: items.map((i) => i.text) };
}

/** verify 步的清单输入：过闸的方案返回 Verification 清单；没过闸或没有该
 *  小节（老方案、直执行任务）返回空数组——verify 步按旧口径跑，不回溯。 */
export function planVerificationItems(content: string): string[] {
  const r = checkPlanContract(content);
  return r.ok ? r.items : [];
}
