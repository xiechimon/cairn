// #1466：GitHub `owner/repo` 引用的 `.` / `..` 段拒绝。
// 失败方式（先于实现固化）：
//  1. `../user`、`./x`、`owner/..`、`owner/.` 通过 isGithubRepoRef——
//     `repos/${owner}/${repo}/...` 拼出的请求路径经 URL 归一被改写（`../user`
//     → `/user/...`），团队 token 被带去读 api.github.com 的其它路径。
//  2. 拆段函数（read 路径消费）对上述值仍返回 {owner, repo}——存量项目行
//     已存了这种值时照样出站。
//  3. 来源引用反解（`github:owner/repo#N`，回显 / #452 回写消费）接受 `..`
//     段——同一改写面从 todo.sourceRef 进入。
//  4. 误伤：带点的合法名（`my.org/repo.js`、`.github`、`x.`）或三点名
//     `...` 被拒。GitHub 官方文档只限字符集（ASCII 字母数字与 `.`、`-`、
//     `_`，≤100 字符；docs.github.com「Creating a new repository」），保留
//     名只有 `.` 与 `..`（github.com/dead-claudia/github-limits，经 GitHub
//     自动别名实测）；WHATWG URL 标准的 dot segment 也只有 `.` / `..`（含
//     `%2e` 变体，`%` 不在字符集内），`...` 是普通段，不被归一。

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

describe('isGithubRepoRef（#1466 失败方式 1/4）', () => {
  it.each(DOT_SEGMENT_REFS)('拒绝 owner 或 repo 为 . / .. 的值：%s', (value) => {
    expect(isGithubRepoRef(value)).toBe(false);
  });

  it.each(VALID_DOTTED_REFS)('带点的合法名照过：%s', (value) => {
    expect(isGithubRepoRef(value)).toBe(true);
  });

  it('既有形状闸不变：空段、多斜杠、字符集外仍拒', () => {
    for (const value of ['', 'owner', 'owner/', '/repo', 'a/b/c', 'a b/c', 'a/%2e%2e', 'a/b#1']) {
      expect(isGithubRepoRef(value), value).toBe(false);
    }
  });
});

describe('parseGithubRepoRef（#1466 失败方式 2）', () => {
  it.each(DOT_SEGMENT_REFS)('. / .. 段 → null：%s', (value) => {
    expect(parseGithubRepoRef(value)).toBeNull();
  });

  it('合法值拆成 {owner, repo}', () => {
    expect(parseGithubRepoRef('my.org/repo.js')).toEqual({ owner: 'my.org', repo: 'repo.js' });
    expect(parseGithubRepoRef('.../x')).toEqual({ owner: '...', repo: 'x' });
  });

  it('形状不合法 → null', () => {
    for (const value of ['', 'owner', 'a/b/c', 'a b/c']) {
      expect(parseGithubRepoRef(value), value).toBeNull();
    }
  });
});

describe('parseGithubIssueSourceRef（#1466 失败方式 3）', () => {
  it.each(DOT_SEGMENT_REFS)('. / .. 段的来源引用 → null：github:%s#3', (value) => {
    expect(parseGithubIssueSourceRef(`github:${value}#3`)).toBeNull();
  });

  it('合法引用照常互逆', () => {
    const ref = githubIssueSourceRef('my.org', 'repo.js', 7);
    expect(parseGithubIssueSourceRef(ref)).toEqual({
      owner: 'my.org',
      repo: 'repo.js',
      issueNumber: 7,
    });
  });
});
