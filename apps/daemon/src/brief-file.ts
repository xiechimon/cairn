import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END, type BriefBackendId } from '@cairn/shared';

export function composeBrief(opts: {
  cwd: string;
  backendId: BriefBackendId;
  content: string;
}): string {
  let content = opts.content;
  if (opts.backendId === 'claude-code' && !existsSync(join(opts.cwd, 'CLAUDE.md'))) {
    try {
      const guidance = readFileSync(join(opts.cwd, 'AGENTS.md'), 'utf8');
      content = `${guidance.trimEnd()}\n\n${content}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return `${BRIEF_MARKER_BEGIN}\n${content.trimEnd()}\n${BRIEF_MARKER_END}\n`;
}
