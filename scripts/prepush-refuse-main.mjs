import { readFileSync } from 'node:fs';

const PROTECTED_REFS = new Set(['refs/heads/main']);

export function refusedRefs(stdin) {
  return stdin
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 4 && PROTECTED_REFS.has(fields[2]))
    .map((fields) => fields[2]);
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const refused = refusedRefs(readFileSync(0, 'utf8'));
  if (refused.length > 0) {
    console.error(
      `[prepush] refusing to push to ${refused.join(', ')}: main only moves through a reviewed pull request. Push a topic branch instead.`,
    );
    process.exit(1);
  }
}
