import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8');
const body = src.slice(src.indexOf('const globToRe'), src.indexOf('const repoProtected'));
const globToRe = new Function(`${body}; return globToRe;`)();
const cases = [
  ['.github/**', '.github/workflows/site-deploy.yml', true],
  ['.github/**', '.github/x.yml', true],
  ['docs/lessons/**', 'docs/lessons/2026/a.md', true],
  ['**/.claude/**', 'apps/web/.claude/skills/x/SKILL.md', true],
  ['**/scripts/**', 'scripts/prepush.mjs', true],
  ['**/*.config.*', 'apps/web/vite.config.ts', true],
  ['**/*.config.*', 'apps/web/src/config.ts', false],
  ['docs/adr/**', 'docs/spec/x.md', false],
];
let bad = 0;
for (const [g, p, want] of cases) {
  const got = globToRe(g).test(p);
  if (got !== want) {
    bad++;
    console.log('BAD', g, p, got);
  }
}
console.log(bad ? `${bad} glob cases failed` : 'glob ok');
process.exit(bad);
