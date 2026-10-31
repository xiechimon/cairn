import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAUDE_DENIED_TOOLS,
  CLAUDE_REVIEW_TOOLS,
  claudeFallback,
  claudeReviewArgs,
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

test('the Claude review is read-only', () => {
  const args = claudeReviewArgs('review this');
  assert.deepEqual(args.slice(0, 2), ['-p', 'review this']);
  const allowedAt = args.indexOf('--allowedTools');
  const deniedAt = args.indexOf('--disallowedTools');
  const tools = args.slice(allowedAt + 1, deniedAt);
  assert.deepEqual(tools, CLAUDE_REVIEW_TOOLS);
  assert.doesNotMatch(tools.join(' '), /Edit|Write|git push|git commit|gh pr merge|gh pr comment/);
  assert.equal(args[args.indexOf('--setting-sources') + 1], 'project');
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash');
  assert.ok(args.includes('--strict-mcp-config'));
  const denied = args.slice(deniedAt + 1);
  assert.equal(deniedAt, args.length - CLAUDE_DENIED_TOOLS.length - 1);
  for (const write of [
    'Edit',
    'Write',
    'Bash(git commit:*)',
    'Bash(gh pr edit:*)',
    'Bash(gh pr create:*)',
  ])
    assert.ok(denied.includes(write), write);
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
