import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRIEF_MARKER_BEGIN,
  BRIEF_MARKER_END,
  BRIEF_RECONCILE_FILENAMES,
  type BriefBackendId,
  type BriefChannel,
  type SessionOpts,
} from '@cairn/shared';

const CONTEXT_FILENAMES = new Set(BRIEF_RECONCILE_FILENAMES.map((file) => file.toLowerCase()));

export function assertNoLegacyBrief(cwd: string): void {
  const legacyFiles = readdirSync(cwd)
    .filter((file) => CONTEXT_FILENAMES.has(file.toLowerCase()))
    .filter((file) => readFileSync(join(cwd, file), 'utf8').includes(BRIEF_MARKER_BEGIN));
  if (legacyFiles.length > 0) {
    throw new Error(
      `Legacy runtime guidance remains in ${legacyFiles.join(', ')}. Recreate this workspace before continuing.`,
    );
  }
}

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

export function composeSessionBrief(input: {
  cwd: string;
  brief: BriefChannel | undefined;
  sessionOpts: SessionOpts;
  systemPrompt: string | undefined;
}): string | null {
  try {
    assertNoLegacyBrief(input.cwd);
    if (input.brief !== undefined) {
      input.sessionOpts.systemPrompt = composeBrief({
        cwd: input.cwd,
        backendId: input.brief.backendId,
        content: input.brief.composeBody(input.sessionOpts, input.systemPrompt),
      });
    }
    return null;
  } catch (err) {
    return `Runtime guidance could not be composed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
