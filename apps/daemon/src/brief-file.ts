import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRIEF_MARKER_BEGIN as BEGIN,
  BRIEF_RECONCILE_FILENAMES,
  type BriefBackendId,
  BRIEF_MARKER_END as END,
  resolveBriefTarget,
  BRIEF_MANAGED_SEPARATOR as SEP,
} from '@cairn/shared';

export function caseInsensitiveFsFor(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

export interface BriefHandle {
  path: string;
  file: string;
  mode: 'create' | 'append';
}

export interface MarkerSpan {
  begin: number;
  end: number;
}

export function locateMarkerBlock(text: string): MarkerSpan | null {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return null;
  const endMarkerAt = text.indexOf(END, begin + BEGIN.length);
  if (endMarkerAt === -1) return { begin, end: text.length };
  const afterEnd = endMarkerAt + END.length;
  return { begin, end: text[afterEnd] === '\n' ? afterEnd + 1 : afterEnd };
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function buildBlock(brief: string): string {
  if (brief.includes(BEGIN) || brief.includes(END)) {
    throw new Error('brief content must not contain the runtime markers');
  }
  return `${BEGIN}\n${brief.trimEnd()}\n${END}\n`;
}

export function reconcileBriefLeftovers(
  cwd: string,
  caseInsensitiveFs: boolean,
  targetFile: string,
): string[] {
  const entries = readdirSync(cwd);
  const folded = new Set(BRIEF_RECONCILE_FILENAMES.map((c) => c.toLowerCase()));
  const touched: string[] = [];
  for (const name of entries) {
    const key = caseInsensitiveFs ? name.toLowerCase() : name;
    if (!folded.has(key)) continue;
    if (name === targetFile) continue;
    if (cleanupBriefFile(join(cwd, name)) !== 'noop') touched.push(name);
  }
  return touched;
}

export function writeBrief(opts: {
  cwd: string;
  backendId: BriefBackendId;
  content: string;
  caseInsensitiveFs: boolean;
}): BriefHandle {
  const { cwd, backendId, content, caseInsensitiveFs } = opts;
  const block = buildBlock(content);
  const target = resolveBriefTarget(readdirSync(cwd), backendId, { caseInsensitiveFs });
  reconcileBriefLeftovers(cwd, caseInsensitiveFs, target.file);

  const path = join(cwd, target.file);
  const existing = readIfPresent(path);
  if (existing === null) {
    writeFileSync(path, block);
    return { path, file: target.file, mode: 'create' };
  }
  const found = locateMarkerBlock(existing);
  if (found !== null) {
    writeFileSync(path, existing.slice(0, found.begin) + block + existing.slice(found.end));
    return { path, file: target.file, mode: found.begin === 0 ? 'create' : 'append' };
  }
  writeFileSync(path, existing + SEP + block);
  return { path, file: target.file, mode: 'append' };
}

export function cleanupBriefFile(path: string): 'removed' | 'excised' | 'noop' {
  const text = readIfPresent(path);
  if (text === null) return 'noop';
  const found = locateMarkerBlock(text);
  if (found === null) return 'noop';
  if (found.begin === 0) {
    rmSync(path, { force: true });
    return 'removed';
  }
  const sepAt = found.begin - SEP.length;
  if (sepAt >= 0 && text.slice(sepAt, found.begin) === SEP) {
    writeFileSync(path, text.slice(0, sepAt) + text.slice(found.end));
    return 'excised';
  }
  writeFileSync(path, text.slice(0, found.begin) + text.slice(found.end));
  return 'excised';
}

export function cleanupBrief(handle: BriefHandle): 'removed' | 'excised' | 'noop' {
  return cleanupBriefFile(handle.path);
}
