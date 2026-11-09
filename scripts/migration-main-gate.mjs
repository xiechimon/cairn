import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const journal = 'apps/server/drizzle/meta/_journal.json';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

try {
  const main = JSON.parse(git('show', `origin/main:${journal}`)).entries;
  const base = git('merge-base', 'origin/main', 'HEAD');
  const added = new Set(
    git(
      'diff',
      '--name-only',
      '--diff-filter=A',
      '-z',
      base,
      'HEAD',
      '--',
      'apps/server/drizzle/*.sql',
    )
      .split('\0')
      .filter(Boolean),
  );
  const highest = Math.max(-1, ...main.map((entry) => entry.idx));
  const latest = Math.max(0, ...main.map((entry) => entry.when));
  const entries = JSON.parse(readFileSync(journal, 'utf8')).entries.filter((entry) =>
    added.has(`apps/server/drizzle/${entry.tag}.sql`),
  );
  let failures = 0;
  let shiftSuffix = false;
  for (const [index, entry] of entries.entries()) {
    const file = `apps/server/drizzle/${entry.tag}.sql`;
    const collision = main.some(
      (existing) =>
        existing.idx === entry.idx ||
        existing.tag === entry.tag ||
        Number(existing.tag.split('_')[0]) === Number(entry.tag.split('_')[0]),
    );
    shiftSuffix ||= collision;
    if (shiftSuffix || entry.when <= latest) {
      const next = String(highest + 1 + index).padStart(4, '0');
      const repair = shiftSuffix ? `renumber to ${next} and set when` : 'set when';
      const reason = collision
        ? 'migration number or tag already exists on origin/main'
        : shiftSuffix
          ? 'shift migration suffix after origin/main collision'
          : 'when must exceed origin/main maximum';
      console.error(`${file}: ${reason}; ${repair} to the current time in ms`);
      failures++;
    }
  }
  process.exitCode = failures ? 1 : 0;
  if (!failures) console.log('migration-main-gate: PASS');
} catch (error) {
  console.error(`migration-main-gate: ${error.message}`);
  process.exitCode = 1;
}
