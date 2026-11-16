import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PROTECTED_REFS = new Set(['refs/heads/main']);
const ABSENT = /^0+$/;

const isAncestor = (ancestor, descendant) =>
  spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;

export function refusedRefs(stdin, fastForward = isAncestor) {
  return stdin
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 4 && PROTECTED_REFS.has(fields[2]))
    .filter(
      ([, localSha, , remoteSha]) =>
        ABSENT.test(localSha) || (!ABSENT.test(remoteSha) && !fastForward(remoteSha, localSha)),
    )
    .map((fields) => fields[2]);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const refused = refusedRefs(readFileSync(0, 'utf8'));
  if (refused.length > 0) {
    console.error(
      `[prepush] refusing to update ${refused.join(', ')}: main only moves forward. Fetch origin main, merge or rebase your unpushed work onto it, re-run the affected checks and push again.`,
    );
    process.exit(1);
  }
}
