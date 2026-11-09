import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefBackendId } from '@cairn/shared';

export function composeBrief(opts: {
  cwd: string;
  backendId: BriefBackendId;
  content: string;
}): string {
  if (opts.backendId !== 'claude-code' || existsSync(join(opts.cwd, 'CLAUDE.md'))) {
    return opts.content;
  }
  try {
    const guidance = readFileSync(join(opts.cwd, 'AGENTS.md'), 'utf8');
    return `${guidance.trimEnd()}\n\n${opts.content}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return opts.content;
    throw err;
  }
}
