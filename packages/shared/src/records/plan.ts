import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const PLAN_FILE_NAME = 'plan.md';

export const PLAN_SECTIONS = ['Context', 'Changes', 'Edge cases', 'Verification'] as const;

export const planRecordSchema = z.object({
  id: recordId,
  buildId: recordId,
  version: z.number().int().min(1),
  createdAt: epochMs,
});
export type PlanRecord = z.infer<typeof planRecordSchema>;

export const planRowSchema = planRecordSchema.extend({
  content: z.string(),
});
export type PlanRow = z.infer<typeof planRowSchema>;

export type PlanContractCheck = { ok: true; items: string[] } | { ok: false; problem: string };

const ANCHOR_PATTERNS: readonly RegExp[] = [
  /`[^`]+`/,
  /https?:\/\/\S+/,
  /[\w.-]+(?:\/[\w.-]+)+\.\w{1,8}\b/,
  /\b[\w.-]*\w\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|toml|sql|sh|py|go|rs|css|html)\b/i,
  /(?:^|\s)\/[\w-]+(?:\/[\w:{}.-]+)+/,
  /\b(?:pnpm|npm|npx|vitest|playwright|pytest|curl|gh|git|bash|cargo|docker)\b/i,
  /^(?:node|make|python3?|go|sh|bun|deno)\b/i,
];

const VAGUE_PATTERN = /\b(?:TODO|TBD|FIXME)\b|待定|待补|待确认/;

const LIST_ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const LABEL = /^(?:\d+[.)、]\s*)?([A-Za-z][A-Za-z ]{0,24}?)\s*[:：]\s*(.*)$/;

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

function sectionMark(line: string): SectionMark | null {
  const h = HEADING.exec(line);
  if (h !== null) {
    return { kind: 'heading', level: h[1]?.length ?? 1, name: cleanSectionName(h[2] ?? '') };
  }
  const l = LABEL.exec(line.replace(/\*\*|__/g, ''));
  if (l === null) return null;
  return { kind: 'label', name: cleanSectionName(l[1] ?? ''), rest: (l[2] ?? '').trim() };
}

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
  let fence: { lines: string[]; owner: (typeof items)[number] | null } | null = null;
  for (const raw of section.lines) {
    const line = raw.trim();
    if (fence !== null) {
      fence.lines.push(raw);
      if (line.startsWith('```')) {
        if (fence.owner !== null) {
          fence.owner.text = `${fence.owner.text}\n${fence.lines.join('\n')}`;
        } else {
          items.push({ text: fence.lines.join('\n'), fenced: true, indent: null });
        }
        fence = null;
      }
      continue;
    }
    if (line.startsWith('```')) {
      const prev = items[items.length - 1];
      const indent = raw.length - line.length;
      const owner =
        hasList && prev !== undefined && !prev.fenced && prev.indent != null && indent > prev.indent
          ? prev
          : null;
      fence = { lines: [raw], owner };
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
  if (fence !== null) {
    if (fence.owner !== null) fence.owner.text = `${fence.owner.text}\n${fence.lines.join('\n')}`;
    else items.push({ text: fence.lines.join('\n'), fenced: true, indent: null });
  }
  return items.map(({ text, fenced }) => ({ text, fenced }));
}

export function checkPlanContract(content: string): PlanContractCheck {
  const section = verificationSection(content.replace(/\r\n?/g, '\n'));
  if (section === undefined) return { ok: false, problem: '方案缺少 Verification 小节' };
  const items = splitItems(section);
  if (items.length === 0) return { ok: false, problem: 'Verification 小节为空' };
  const vague: number[] = [];
  const unanchored: number[] = [];
  items.forEach((item, i) => {
    if (item.fenced) return;
    if (
      VAGUE_PATTERN.test(item.text.replace(/^\s*```[\s\S]*?^\s*```/gm, '').replace(/`[^`]*`/g, ''))
    )
      vague.push(i + 1);
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

export function planVerificationItems(content: string): string[] {
  const r = checkPlanContract(content);
  return r.ok ? r.items : [];
}
