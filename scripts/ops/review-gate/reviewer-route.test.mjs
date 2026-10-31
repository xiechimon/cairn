import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAUDE_DENIED_TOOLS,
  CLAUDE_REVIEW_TOOLS,
  claudeFallback,
  claudeReviewArgs,
  claudeReviewPrompt,
  DIFF_LIMIT,
  parseRuns,
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

test('no fallback without an excluded author or on other failures', () => {
  assert.equal(claudeFallback(null, noModel), false);
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
