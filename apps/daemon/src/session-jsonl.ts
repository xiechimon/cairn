import { existsSync, readFileSync, statSync } from 'node:fs';
import { SESSION_JSONL_MAX_BYTES } from '@pacman/shared';

export function readSessionJsonlForUpload(
  sessionFile: string | undefined,
  log: (msg: string) => void,
  maxBytes: number = SESSION_JSONL_MAX_BYTES,
): string | null {
  if (sessionFile === undefined || sessionFile === '') return null;
  if (!existsSync(sessionFile)) {
    log(`session jsonl skipped: file missing (${sessionFile})`);
    return null;
  }
  try {
    const size = statSync(sessionFile).size;
    if (size > maxBytes) {
      log(`session jsonl skipped: ${size}B over ${maxBytes}B cap`);
      return null;
    }
    return readFileSync(sessionFile, 'utf8');
  } catch (err) {
    log(`session jsonl read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
