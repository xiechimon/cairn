import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCK_ROUNDS,
  CLAUDE_DENIED_TOOLS,
  CLAUDE_DIFF_PATHSPEC,
  CLAUDE_OMITTED_PATHS,
  CLAUDE_REVIEW_TOOLS,
  claudeFallback,
  claudeReviewArgs,
  claudeReviewPrompt,
  DIFF_LIMIT,
  diffDigest,
  escalation,
  gateVerdicts,
  HUMAN_LABEL,
  lowRiskTier,
  parseRawDiff,
  parseRuns,
  priorFindings,
  roundStops,
  STALL_MS,
  stallAlert,
  stalled,
  stalledSince,
} from './reviewer-route.mjs';

const noModel = { status: 1, stderr: 'ai-route: no usable model for role review\n' };

test('an openai-authored PR with no usable cross-vendor model falls back to Claude', () => {
  assert.equal(claudeFallback('openai', noModel), true);
  assert.equal(claudeFallback('xai', noModel), true);
});

test('Claude never reviews a Claude-authored PR', () => {
  assert.equal(claudeFallback('anthropic', noModel), false);
});

test('a PR whose author vendor is unknown falls back to Claude when no model is usable', () => {
  for (const unknown of [null, undefined, '']) assert.equal(claudeFallback(unknown, noModel), true);
});

test('no fallback on other failures', () => {
  assert.equal(claudeFallback('openai', { status: 1, stderr: 'timeout' }), false);
  assert.equal(claudeFallback('openai', { status: 0, stderr: 'no usable model' }), false);
});

test('the Claude review has no shell and no write tools', () => {
  const args = claudeReviewArgs();
  assert.equal(args[0], '-p');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob');
  const allowedAt = args.indexOf('--allowedTools');
  const deniedAt = args.indexOf('--disallowedTools');
  assert.deepEqual(args.slice(allowedAt + 1, deniedAt), CLAUDE_REVIEW_TOOLS);
  assert.deepEqual(args.slice(deniedAt + 1), CLAUDE_DENIED_TOOLS);
  for (const tool of ['Bash', 'Edit', 'Write', 'WebFetch'])
    assert.ok(CLAUDE_DENIED_TOOLS.includes(tool));
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project');
  assert.ok(args.includes('--strict-mcp-config'));
});

test('the Claude prompt carries the description and the whole diff, or nothing', () => {
  const small = claudeReviewPrompt('PROMPT', { diff: '+x\n', title: 'T', body: 'B' });
  assert.match(small, /^PROMPT\n/);
  assert.match(small, /PR title: T/);
  assert.match(small, /PR description:\nB/);
  assert.match(small, /```diff\n\+x\n/);
  assert.equal(
    claudeReviewPrompt('P', { diff: 'y'.repeat(DIFF_LIMIT + 1), title: '', body: '' }),
    null,
  );
  assert.ok(claudeReviewPrompt('P', { diff: 'y'.repeat(DIFF_LIMIT), title: '', body: '' }));
});

const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);
const t0 = Date.parse('2026-10-31T10:00:00Z');
const at = (ms) => new Date(t0 + ms).toISOString();

test('a head without a verdict stalls after one hour', () => {
  const records = [
    { at: at(0), pr: 7, sha, verdict: null },
    { at: at(900_000), pr: 7, sha, verdict: null },
  ];
  assert.equal(stalledSince(records, 7, sha), at(0));
  assert.equal(stalled(records, 7, sha, t0 + STALL_MS), null);
  assert.equal(stalled(records, 7, sha, t0 + STALL_MS + 60_000), at(0));
});

test('a verdict on the head, or another head or PR, does not stall', () => {
  const records = [
    { at: at(0), pr: 7, sha, verdict: null },
    { at: at(60_000), pr: 7, sha, verdict: 'block' },
    { at: at(0), pr: 8, sha: other, verdict: null },
  ];
  assert.equal(stalled(records, 7, sha, t0 + 2 * STALL_MS), null);
  assert.equal(stalled(records, 7, other, t0 + 2 * STALL_MS), null);
  assert.equal(stalled(records, 8, other, t0 + 2 * STALL_MS), at(0));
});

test('the alert carries a per-head marker', () => {
  const body = stallAlert({ headRefOid: sha }, at(0));
  assert.match(body, new RegExp(`^<!-- review-gate-stalled:${sha} -->\\n`));
  assert.match(body, /review-stalled/);
});

test('run records skip malformed lines', () => {
  assert.deepEqual(parseRuns('{"pr":1}\nnot json\n\n{"pr":2}\n'), [{ pr: 1 }, { pr: 2 }]);
});

const verdictBody = (head, verdict, review = '') =>
  `<!-- review-gate:${head} -->\n**Independent review gate: ${verdict}** for \`${head.slice(0, 8)}\`.${review ? `\n\n${review}` : ''}\n<!-- review-gate-patch:p -->`;
const humanNote = {
  body: `<!-- review-gate-human:${sha} -->\n**Independent review gate: needs a human**`,
};
const blocks = (n) =>
  Array.from({ length: n }, (_, k) => ({
    body: verdictBody(String(k + 1).repeat(40), 'BLOCK', `${k + 1}. blocking: f.ts:${k} bug`),
  }));

test('only the verdict line of a gate comment makes it a verdict', () => {
  const list = gateVerdicts([
    { body: verdictBody(sha, 'PASS'), url: 'u' },
    { body: `quoted\n${verdictBody(other, 'BLOCK')}` },
    { body: `<!-- review-gate-pending:${sha} -->\n**Independent review gate: no verdict yet**` },
    { body: verdictBody(other, 'BLOCK') },
  ]);
  assert.deepEqual(
    list.map((v) => [v.sha, v.verdict, v.url]),
    [
      [sha, 'PASS', 'u'],
      [other, 'BLOCK', undefined],
    ],
  );
});

test('three BLOCK rounds hand the PR to a human until the label is removed', () => {
  assert.equal(BLOCK_ROUNDS, 3);
  assert.equal(escalation(blocks(2), []), null);
  assert.deepEqual(escalation(blocks(3), []), { addLabel: true, comment: true });
  assert.deepEqual(escalation(blocks(3), [{ name: HUMAN_LABEL }]), {
    addLabel: false,
    comment: true,
  });
  assert.deepEqual(escalation([...blocks(3), humanNote], [{ name: HUMAN_LABEL }]), {
    addLabel: false,
    comment: false,
  });
  assert.equal(escalation([...blocks(3), humanNote], []), null);
  assert.equal(escalation([...blocks(3), humanNote, ...blocks(2)], []), null);
  assert.deepEqual(escalation([...blocks(3), humanNote, ...blocks(3)], []), {
    addLabel: true,
    comment: true,
  });
});

test('a PASS after the BLOCK rounds is not handed to a human', () => {
  assert.equal(escalation([...blocks(3), { body: verdictBody(sha, 'PASS') }], []), null);
  assert.equal(
    escalation([...blocks(2), { body: verdictBody(sha, 'PASS') }, ...blocks(1)], [])?.comment,
    true,
  );
});

test('earlier findings list every BLOCK round without the gate markers', () => {
  const text = priorFindings(gateVerdicts([...blocks(2), { body: verdictBody(sha, 'PASS') }]));
  assert.match(text, /1\. blocking: f\.ts:0 bug/);
  assert.match(text, /2\. blocking: f\.ts:1 bug/);
  assert.match(text, /Head `11111111`/);
  assert.doesNotMatch(text, /<!--|Independent review gate/);
  assert.ok(text.indexOf('f.ts:0') < text.indexOf('f.ts:1'));
  const long = priorFindings(
    gateVerdicts([{ body: verdictBody(sha, 'BLOCK', 'x'.repeat(20_000)) }]),
  );
  assert.ok(long.length <= 9_002);
});

const hunk = (at, context) =>
  `diff --git a/f b/f\nindex 1111111..2222222 100644\n--- a/f\n+++ b/f\n@@ -${at},1 +${at},1 @@ ${context}\n-old\n+new\n`;

test('the diff digest ignores blob ids and hunk positions but not changed lines', () => {
  assert.equal(diffDigest(hunk(3, 'fn a')), diffDigest(hunk(30, 'fn b')));
  assert.equal(
    diffDigest(hunk(3, 'x').replace('1111111..2222222', '3333333..4444444')),
    diffDigest(hunk(3, 'x')),
  );
  assert.notEqual(diffDigest(hunk(3, 'x')), diffDigest(hunk(3, 'x').replace('+new', '+other')));
  assert.notEqual(diffDigest(hunk(3, 'x')), diffDigest(hunk(3, 'x').replaceAll(' b/f', ' b/g')));
  assert.notEqual(diffDigest(''), diffDigest(hunk(3, 'x')));
});

test('raw diff entries carry path, status and mode', () => {
  const z = [
    ':100644 100644 aaa bbb M',
    'docs/a b.md',
    ':000000 120000 000 ccc A',
    'docs/link.md',
    ':100644 000000 ddd 000 D',
    'apps/web/test/x.test.ts',
    '',
  ].join('\0');
  assert.deepEqual(parseRawDiff(z), [
    { path: 'docs/a b.md', status: 'M', mode: '100644' },
    { path: 'docs/link.md', status: 'A', mode: '120000' },
    { path: 'apps/web/test/x.test.ts', status: 'D', mode: '100644' },
  ]);
});

const PROTECTED_RES = [/^docs\/adr\//, /^(?:.*\/)?scripts\/.*$/, /^(?:.*\/)?CLAUDE[^/]*\.md$/];
const tier = (...paths) =>
  lowRiskTier(
    paths.map((path) => ({ path, status: 'M', mode: '100644' })),
    PROTECTED_RES,
  );

test('docs, tests, locale strings and Markdown are the low-risk tier', () => {
  assert.equal(tier('docs/guide/setup.md'), true);
  assert.equal(tier('docs/verify/2300/shot.png'), true);
  assert.equal(tier('apps/web/test/x.test.ts', 'apps/server/test/fixtures/y.json'), true);
  assert.equal(tier('apps/web/e2e/sidebar.spec.ts', 'packages/shared/src/a.test.ts'), true);
  assert.equal(tier('apps/web/src/locales/zh/app.json'), true);
  assert.equal(tier('README.md', 'apps/web/README.zh.md'), true);
});

test('a product file, a gate doc or a protected file leaves the low-risk tier', () => {
  assert.equal(tier(), false);
  assert.equal(tier('docs/guide.md', 'apps/web/src/app.tsx'), false);
  for (const path of [
    'docs/adr/0028-merge-routes.md',
    'docs/spec/19-test-layering.md',
    'docs/pr-review.md',
    'docs/lessons.md',
    'docs/lessons/2026/a.md',
    'docs/agent-dispatch-prompts.md',
    '.claude/skills/x/SKILL.md',
    'apps/web/.claude/notes.md',
    '.Claude/x.md',
    'CLAUDE.md',
    'claude.md',
    'scripts/ops/review-gate/glob.test.mjs',
    'apps/web/src/i18n/translate.ts',
    'apps/web/src/i18n/en.ts',
    'apps/web/src/locales/zh/app.ts',
  ])
    assert.equal(tier(path), false, path);
});

test('deleted files, symlinks and submodules leave the low-risk tier', () => {
  const one = (entry) => lowRiskTier([{ path: 'docs/a.md', ...entry }], PROTECTED_RES);
  assert.equal(one({ status: 'M', mode: '100644' }), true);
  assert.equal(one({ status: 'A', mode: '100755' }), true);
  assert.equal(one({ status: 'D', mode: '100644' }), false);
  assert.equal(one({ status: 'A', mode: '120000' }), false);
  assert.equal(one({ status: 'A', mode: '160000' }), false);
  assert.equal(one({ status: 'T', mode: '100644' }), false);
});

test('the Claude diff keeps snapshots and only drops deleted bodies, verify evidence and drizzle meta', () => {
  assert.equal(CLAUDE_DIFF_PATHSPEC[0], '-D');
  for (const path of [':(exclude)docs/verify', ':(exclude)apps/server/drizzle/meta'])
    assert.ok(CLAUDE_DIFF_PATHSPEC.includes(path));
  assert.ok(!CLAUDE_DIFF_PATHSPEC.some((part) => part.includes('__snapshots__')));
  assert.deepEqual(CLAUDE_OMITTED_PATHS, ['docs/verify', 'apps/server/drizzle/meta']);
});

test('the Claude prompt names every omitted file so a hidden change can be blocked', () => {
  const input = claudeReviewPrompt('P', {
    diff: '+x\n',
    title: 'T',
    body: 'B',
    omitted: 'M\tdocs/verify/1/run.txt\nA\tapps/server/drizzle/meta/0086_snapshot.json',
  });
  assert.match(input, /Files changed but omitted from the diff/);
  assert.match(input, /M\tdocs\/verify\/1\/run\.txt/);
  assert.match(input, /A\tapps\/server\/drizzle\/meta\/0086_snapshot\.json/);
  assert.doesNotMatch(
    claudeReviewPrompt('P', { diff: '+x\n', title: '', body: '' }),
    /omitted from the diff/,
  );
});

test('a round stops only when no reviewer was tried', () => {
  assert.equal(roundStops({ stderr: 'ai-route: no usable model for role review' }), true);
  assert.equal(
    roundStops({
      stderr:
        'ai-route: no usable model for role review\nclaude fallback: diff of 9 characters exceeds 1; no partial review',
    }),
    false,
  );
  assert.equal(roundStops({ stderr: 'no usable model', excluded: true }), false);
  assert.equal(roundStops({ stderr: 'timeout' }), false);
});
