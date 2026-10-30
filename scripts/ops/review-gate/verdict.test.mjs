import { readFileSync } from 'node:fs';

const src = readFileSync(process.argv[2], 'utf8');
const fn = src
  .slice(src.indexOf('export function finalVerdict'), src.indexOf('\ntry {'))
  .replace('export ', '');
const finalVerdict = new Function(`${fn}; return finalVerdict;`)();
const prompt = `${readFileSync('prompt.txt', 'utf8')}\n  Protected paths touched: docs/adr/x.md`;
const cases = [
  [
    'echo then block',
    `user\n${prompt}\ncodex\n1. blocking: foo.ts:3 bug\nVERDICT: block\ntokens used 123`,
    'block',
  ],
  ['bold pass', `${prompt}\nfindings none\n**VERDICT: pass**`, 'pass'],
  ['echo only', `${prompt}\nerror: model failed`, undefined],
  ['verdict: pass or block echo', `verdict: pass or block\nnothing`, undefined],
  ['two runs last wins', `${prompt}\nVERDICT: pass\n${prompt}\nVERDICT: block`, 'block'],
];
cases.push([
  'review repeated twice keeps one copy',
  `${prompt}\n1. blocking: a.ts:1 bug\n2. suggestion: b\n\n1. blocking: a.ts:1 bug\n2. suggestion: b\nVERDICT: block`,
  'block',
]);
cases.push([
  'real #1828 transcript (recorded PASS, actually block)',
  readFileSync('fixture-1828.txt', 'utf8'),
  'block',
]);
let bad = 0;
for (const [name, out, want] of cases) {
  const r = finalVerdict(out);
  const ok = r.verdict === want;
  bad += !ok;
  console.log(ok ? 'ok ' : 'BAD', name, r.verdict, (r.review ?? '').length);
}
const big = finalVerdict(`${prompt}\n${'x'.repeat(20000)}\nVERDICT: block`);
console.log('cap', big.review.length <= 8002 ? 'ok' : 'BAD', big.review.length);
const nested = finalVerdict(
  `${prompt}\n1. blocking: a.ts:1\n2. blocking: b.ts:2 steps:\n   1. run x\nVERDICT: block`,
);
console.log('nested', nested.review.includes('a.ts:1') ? 'ok' : 'BAD');
bad += !nested.review.includes('a.ts:1');
const dup = finalVerdict(
  `${prompt}\nI ran pnpm test\n1. blocking: a.ts:1 bug\n\n1. blocking: a.ts:1 bug\nVERDICT: block`,
);
console.log(
  'dedupe',
  dup.review.split('a.ts:1').length === 2 && !dup.review.includes('pnpm') ? 'ok' : 'BAD',
);
bad += !(dup.review.split('a.ts:1').length === 2);
process.exit(bad);
