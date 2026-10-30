import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(process.argv[2] ?? new URL('./review-gate.mjs', import.meta.url), 'utf8');
const fn = src
  .slice(src.indexOf('export function finalVerdict'), src.indexOf('\ntry {'))
  .replace('export ', '');
const finalVerdict = new Function(`${fn}; return finalVerdict;`)();
const prompt = 'VERDICT: pass or block\n  Protected paths touched: docs/adr/x.md';
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
  'prompt echoes PASS before the reviewer blocks',
  `${prompt}\nVERDICT: pass\ncodex\n1. blocking: a.ts:1 bug\nVERDICT: block`,
  'block',
]);
for (const [name, out, want] of cases) {
  test(name, () => assert.equal(finalVerdict(out).verdict, want));
}
test('review text is capped', () => {
  assert.ok(finalVerdict(`${prompt}\n${'x'.repeat(20000)}\nVERDICT: block`).review.length <= 3002);
});
test('nested lists keep the first finding', () => {
  assert.match(
    finalVerdict(
      `${prompt}\n1. blocking: a.ts:1\n2. blocking: b.ts:2 steps:\n   1. run x\nVERDICT: block`,
    ).review,
    /a.ts:1/,
  );
});
test('repeated review keeps one copy', () => {
  const review = finalVerdict(
    `${prompt}\nI ran pnpm test\n1. blocking: a.ts:1 bug\n\n1. blocking: a.ts:1 bug\nVERDICT: block`,
  ).review;
  assert.equal(review.split('a.ts:1').length, 2);
  assert.doesNotMatch(review, /pnpm/);
});
