import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyReviewPath,
  extractPrNumber,
  isFixCommit,
  isRevertCommit,
  scanCommits,
} from './escape-trace.mjs';

describe('escape-trace', () => {
  it('detects revert', () => {
    assert.equal(isRevertCommit('Revert "foo"'), true);
    assert.equal(isRevertCommit('fix: bar'), false);
  });
  it('detects fix', () => {
    assert.equal(isFixCommit('fix: bar'), true);
    assert.equal(isFixCommit('feat: x'), false);
  });
  it('extracts pr number', () => {
    assert.equal(extractPrNumber('foo (#123)'), 123);
    assert.equal(extractPrNumber('no number'), null);
  });
  it('classifies review path', () => {
    assert.equal(classifyReviewPath('review-gate: ai'), 'ai');
    assert.equal(classifyReviewPath('review-gate: human'), 'human');
    assert.equal(classifyReviewPath('nothing'), 'unknown');
  });
  it('scans commits', () => {
    const log = 'abc1234 fix: something (#5)\ndef5678 feat: other\n';
    const r = scanCommits(log);
    assert.equal(r.length, 1);
    assert.equal(r[0].pr, 5);
  });
});
