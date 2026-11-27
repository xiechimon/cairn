import { z } from 'zod';
import { epochMs, recordId } from './common.js';

export const PLAN_FILE_NAME = 'plan.md';

export const PLAN_SECTIONS = [
  'Context',
  'Changes',
  'Edge cases',
  'Verification',
  'Prior art',
] as const;

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

export const planResponseSchema = planRowSchema.extend({
  autoApproveAt: epochMs.nullable().optional(),
  autoApprovePausedAt: epochMs.nullable().optional(),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;

const LIST_ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(\S.*|)$/;

const CHECK_LABEL = /^\s*(?:\*\*\S|#{3,6}\s)/;
const HEADING = /^(#{1,6})\s+(\S.*|)$/;
const LABEL = /^(?:\d+[.)、]\s*)?([A-Za-z][A-Za-z ]{0,24}?)\s*[:：]\s*(\S.*|)$/;

function cleanSectionName(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^\d+(?:\.\d+)*[.)、]?\s*/, '')
    .replace(/(?<!\s)\s*[:：]\s*$/, '')
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

function namedSection(
  content: string,
  sectionName: string,
): { head: string; lines: string[] } | undefined {
  const lines = content.split('\n');
  let start = -1;
  let level = 0;
  let head = '';
  let scanningFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (line.startsWith('```')) {
      scanningFence = !scanningFence;
      continue;
    }
    if (scanningFence) continue;
    const mark = sectionMark(line);
    if (mark?.name !== sectionName) continue;
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
        if (sectionName !== 'verification' || mark.level < 3) continue;
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
  let inLabelScan = false;
  const labeled =
    !hasList &&
    section.lines.some((raw) => {
      if (raw.trim().startsWith('```')) inLabelScan = !inLabelScan;
      return !inLabelScan && CHECK_LABEL.test(raw);
    });
  const items: { text: string; fenced: boolean; indent: number | null }[] = [];
  if (section.head !== '') items.push({ text: section.head, fenced: false, indent: null });
  if (labeled) {
    let current: (typeof items)[number] | null = null;
    let inFence = false;
    for (const raw of section.lines) {
      const line = raw.trim();
      if (line.startsWith('```')) inFence = !inFence;
      else if (!inFence && CHECK_LABEL.test(raw)) {
        current = { text: line, fenced: false, indent: null };
        items.push(current);
        continue;
      }
      if (current === null || (line === '' && !inFence)) continue;
      current.text = `${current.text}\n${raw}`;
    }
    return items.map(({ text, fenced }) => ({ text, fenced }));
  }
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
    if (line === '' || (hasList && HEADING.test(line))) continue;
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

export function planVerificationItems(content: string): string[] {
  const section = namedSection(content.replace(/\r\n?/g, '\n'), 'verification');
  if (section === undefined) return [];
  return splitItems(section)
    .filter((i) => i.text.trim() !== '')
    .map((i) => i.text);
}
