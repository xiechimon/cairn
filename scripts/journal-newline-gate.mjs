import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const JOURNAL = 'apps/server/drizzle/meta/_journal.json';

export function journalNewlineError(content) {
  if (content.endsWith('\n')) return null;
  return `${JOURNAL} has no trailing newline (drizzle-kit writes it without one). Fix: printf '\\n' >> ${JOURNAL}`;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const path = resolve(root, JOURNAL);
  const error = existsSync(path) ? journalNewlineError(readFileSync(path, 'utf8')) : null;
  if (error) {
    console.error(`[journal-newline-gate] ${error}`);
    process.exit(1);
  }
  console.log('[journal-newline-gate] PASS');
}
