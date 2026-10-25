import { diffWordsWithSpace } from 'diff';
import type { DiffLine } from '../fixtures/records.js';

export const MAX_WORD_LINE_CHARS = 1000;
export const MAX_WORD_DIFF_CELLS = 4000;

export interface WordSegment {
  text: string;
  changed: boolean;
}

export interface HunkWordDiff {
  segments: Map<number, WordSegment[]>;
  capped: Set<number>;
}

interface DiffPart {
  value: string;
  added?: boolean;
  removed?: boolean;
}

function sideSegments(parts: DiffPart[], side: 'del' | 'add'): WordSegment[] {
  const out: WordSegment[] = [];
  for (const part of parts) {
    const own = side === 'del' ? part.removed === true : part.added === true;
    const other = side === 'del' ? part.added === true : part.removed === true;
    if (other) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.changed === own) last.text += part.value;
    else out.push({ text: part.value, changed: own });
  }
  return out;
}

export function computeHunkWordDiff(lines: DiffLine[]): HunkWordDiff {
  const segments = new Map<number, WordSegment[]>();
  const capped = new Set<number>();
  let cells = 0;
  let i = 0;
  while (i < lines.length) {
    const head = lines[i];
    if (head === undefined || head.kind === 'context') {
      i += 1;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    let j = i;
    while (j < lines.length) {
      const row = lines[j];
      if (row === undefined || row.kind === 'context') break;
      if (row.kind === 'del') dels.push(j);
      else if (row.kind === 'add') adds.push(j);
      j += 1;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p += 1) {
      const dIdx = dels[p];
      const aIdx = adds[p];
      const dLine = dIdx === undefined ? undefined : lines[dIdx];
      const aLine = aIdx === undefined ? undefined : lines[aIdx];
      if (dIdx === undefined || aIdx === undefined || !dLine || !aLine) break;
      if (
        dLine.text.length > MAX_WORD_LINE_CHARS ||
        aLine.text.length > MAX_WORD_LINE_CHARS ||
        cells >= MAX_WORD_DIFF_CELLS
      ) {
        capped.add(dIdx);
        capped.add(aIdx);
        continue;
      }
      const parts = diffWordsWithSpace(dLine.text, aLine.text) as DiffPart[];
      cells += parts.length;
      segments.set(dIdx, sideSegments(parts, 'del'));
      segments.set(aIdx, sideSegments(parts, 'add'));
    }
    i = j;
  }
  return { segments, capped };
}
