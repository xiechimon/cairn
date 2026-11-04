import { describe, expect, it } from 'vitest';
import { isGithubRepoRef, parseGithubRepoRef } from '../src/records/project.js';
import { githubIssueSourceRef, parseGithubIssueSourceRef } from '../src/records/todo.js';

const DOT_SEGMENT_REFS = ['../user', './x', 'owner/..', 'owner/.', '../..', './.', '../.'];
const VALID_DOTTED_REFS = [
  'octo/alpha',
  'my.org/repo.js',
  '.../x',
  'owner/...',
  'owner/.github',
  '.x/y',
  'x./y.',
  'a_b-c/d.e_f-g',
];

describe('isGithubRepoRef (#1466 failure modes 1/4)', () => {
  it.each(DOT_SEGMENT_REFS)('拒绝 owner 或 repo 为 . / .. 的值：%s', (value) => {
    expect(isGithubRepoRef(value)).toBe(false);
  });

  it.each(VALID_DOTTED_REFS)('带点的合法名照过：%s', (value) => {
    expect(isGithubRepoRef(value)).toBe(true);
  });

  it('existing shape gates unchanged: empty segments, multiple slashes, out-of-charset still rejected', () => {
    for (const value of ['', 'owner', 'owner/', '/repo', 'a/b/c', 'a b/c', 'a/%2e%2e', 'a/b#1']) {
      expect(isGithubRepoRef(value), value).toBe(false);
    }
  });
});

describe('parseGithubRepoRef (#1466 failure mode 2)', () => {
  it.each(DOT_SEGMENT_REFS)('. / .. 段 → null：%s', (value) => {
    expect(parseGithubRepoRef(value)).toBeNull();
  });

  it('valid values split into {owner, repo}', () => {
    expect(parseGithubRepoRef('my.org/repo.js')).toEqual({ owner: 'my.org', repo: 'repo.js' });
    expect(parseGithubRepoRef('.../x')).toEqual({ owner: '...', repo: 'x' });
  });

  it('illegal shape -> null', () => {
    for (const value of ['', 'owner', 'a/b/c', 'a b/c']) {
      expect(parseGithubRepoRef(value), value).toBeNull();
    }
  });
});

describe('parseGithubIssueSourceRef (#1466 failure mode 3)', () => {
  it.each(DOT_SEGMENT_REFS)('. / .. 段的来源引用 → null：github:%s#3', (value) => {
    expect(parseGithubIssueSourceRef(`github:${value}#3`)).toBeNull();
  });

  it('valid references still round-trip', () => {
    const ref = githubIssueSourceRef('my.org', 'repo.js', 7);
    expect(parseGithubIssueSourceRef(ref)).toEqual({
      owner: 'my.org',
      repo: 'repo.js',
      issueNumber: 7,
    });
  });
});
