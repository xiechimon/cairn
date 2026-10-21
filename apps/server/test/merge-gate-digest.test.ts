// 合并就绪闸 S1（#1404）：补丁摘要 patchDigest（ADR 0021 D3）。
// 失败方式先行：顺序 / 区域设置让同一补丁算出两个摘要；改名移进 docs/verify/
// 把代码删除藏起来；文件名含制表符或换行时元组撞车；空 blob sha 被当成
// 字符串 'null' 哈希；compare 截到 300 个文件仍被当成完整列表。
// 夹具 test/fixtures/merge-gate-compare-sample.json 是一次真实的只读 compare
// 响应（xiechimon/pacman 52d2cdc...b4b1f96，per_page=1，去掉了 patch 字段）；
// 与 docs/verify/1404/compare-sample.json 同一份，放在测试目录里是因为摘要
// 不计 docs/verify/，测试读的夹具不能落在摘要之外。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompareFile, GATE_LIMITS } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  compareFilesFromResponse,
  computePatchDigest,
  isEvidencePath,
} from '../src/services/merge-gate/digest.js';

const file = (over: Partial<CompareFile> & { filename: string }): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: 'a'.repeat(40),
  additions: 1,
  deletions: 1,
  ...over,
});

const base: CompareFile[] = [
  file({ filename: 'apps/server/src/a.ts', sha: '1'.repeat(40) }),
  file({ filename: 'apps/server/src/b.ts', sha: '2'.repeat(40), additions: 5, deletions: 0 }),
  file({
    filename: 'docs/verify/1404/run.txt',
    status: 'added',
    sha: '3'.repeat(40),
    additions: 20,
    deletions: 0,
  }),
];

describe('computePatchDigest', () => {
  test('带版本前缀，同一组文件任意顺序算出同一个摘要', () => {
    const a = computePatchDigest(base);
    const b = computePatchDigest([...base].reverse());
    expect(a.patchDigest).toMatch(/^pd1:[0-9a-f]{64}$/);
    expect(b.patchDigest).toBe(a.patchDigest);
  });

  test('改一个 blob sha，摘要就变', () => {
    const changed = base.map((f) =>
      f.filename === 'apps/server/src/a.ts' ? { ...f, sha: '9'.repeat(40) } : f,
    );
    expect(computePatchDigest(changed).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
  });

  test('只改 docs/verify/ 下的证据，摘要不变', () => {
    const more = [
      ...base,
      file({ filename: 'docs/verify/1404/extra.png', status: 'added', sha: '4'.repeat(40) }),
    ];
    expect(computePatchDigest(more).patchDigest).toBe(computePatchDigest(base).patchDigest);
  });

  test('改名跨过 docs/verify/ 边界（进或出）都计入摘要', () => {
    const into = [
      ...base,
      file({
        filename: 'docs/verify/1404/old-code.ts',
        previousFilename: 'apps/server/src/old.ts',
        status: 'renamed',
      }),
    ];
    const outOf = [
      ...base,
      file({
        filename: 'apps/server/src/moved.ts',
        previousFilename: 'docs/verify/1404/moved.ts',
        status: 'renamed',
      }),
    ];
    const inside = [
      ...base,
      file({
        filename: 'docs/verify/1404/b.txt',
        previousFilename: 'docs/verify/1404/a.txt',
        status: 'renamed',
      }),
    ];
    expect(computePatchDigest(into).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
    expect(computePatchDigest(outOf).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
    expect(computePatchDigest(inside).patchDigest).toBe(computePatchDigest(base).patchDigest);
  });

  test('previous_filename 进摘要：同名同 sha 的改名来源不同，摘要不同', () => {
    const fromA = [
      file({ filename: 'apps/x.ts', previousFilename: 'apps/a.ts', status: 'renamed' }),
    ];
    const fromB = [
      file({ filename: 'apps/x.ts', previousFilename: 'apps/b.ts', status: 'renamed' }),
    ];
    expect(computePatchDigest(fromA).patchDigest).not.toBe(computePatchDigest(fromB).patchDigest);
  });

  test('只有仓根的 docs/verify/ 算证据', () => {
    expect(isEvidencePath('docs/verify/1404/a.txt')).toBe(true);
    expect(isEvidencePath('apps/docs/verify/1404/a.txt')).toBe(false);
    expect(isEvidencePath('docs/verifyx/a.txt')).toBe(false);
  });

  test('文件名含制表符或换行不会与别的元组撞车', () => {
    const a = [file({ filename: 'a\tmodified\tb', sha: '1'.repeat(40) })];
    const b = [
      file({ filename: 'a', status: 'modified', sha: '1'.repeat(40) }),
      file({ filename: 'b', sha: '1'.repeat(40) }),
    ];
    const c = [file({ filename: 'x\ny', sha: '1'.repeat(40) })];
    const d = [
      file({ filename: 'x', sha: '1'.repeat(40) }),
      file({ filename: 'y', sha: '1'.repeat(40) }),
    ];
    expect(computePatchDigest(a).patchDigest).not.toBe(computePatchDigest(b).patchDigest);
    expect(computePatchDigest(c).patchDigest).not.toBe(computePatchDigest(d).patchDigest);
  });

  test('非删除条目的 sha 为空：摘要不可得', () => {
    const r = computePatchDigest([...base, file({ filename: 'apps/sub', sha: null })]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('null-sha');
  });

  test('删除条目的 sha 为空也照常计算（真实响应里删除条目带旧 blob sha）', () => {
    const r = computePatchDigest([
      ...base,
      file({ filename: 'apps/gone.ts', status: 'removed', sha: null }),
    ]);
    expect(r.patchDigest).toMatch(/^pd1:/);
  });

  test('299 个文件照常；300 个即视为截断，摘要不可得', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => file({ filename: `apps/f${i}.ts` }));
    expect(GATE_LIMITS.compareFileCap).toBe(300);
    expect(computePatchDigest(many(299)).patchDigest).toMatch(/^pd1:/);
    const r = computePatchDigest(many(300));
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('truncated');
  });

  test('与 PR 的 changed_files 对不上即视为截断', () => {
    const r = computePatchDigest(base, { expectedFileCount: base.length + 1 });
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('count-mismatch');
    expect(computePatchDigest(base, { expectedFileCount: base.length }).patchDigest).toMatch(
      /^pd1:/,
    );
  });

  test('空文件列表：摘要不可得（没有可绑定的补丁）', () => {
    const r = computePatchDigest([]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('empty');
  });

  test('只有证据的补丁：证据之外没有文件，摘要不可得', () => {
    const r = computePatchDigest([file({ filename: 'docs/verify/1404/a.txt', status: 'added' })]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('empty');
  });

  test('行数与文件数只算证据之外的条目', () => {
    const r = computePatchDigest(base);
    expect(r.countedFiles).toBe(2);
    expect(r.countedLines).toBe(2 + 5);
    expect(r.excluded.map((f) => f.filename)).toEqual(['docs/verify/1404/run.txt']);
  });
});

describe('真实 compare 响应夹具', () => {
  const sample = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/merge-gate-compare-sample.json'), 'utf8'),
  ) as unknown;

  test('解析出 58 个文件，删除条目带旧 blob sha，证据目录里有可执行文件', () => {
    const files = compareFilesFromResponse(sample);
    expect(files).not.toBeNull();
    expect(files?.length).toBe(58);
    const removed = files?.filter((f) => f.status === 'removed') ?? [];
    expect(removed.length).toBe(3);
    expect(removed.every((f) => typeof f.sha === 'string' && f.sha.length === 40)).toBe(true);
    expect(files?.some((f) => f.filename === 'docs/verify/paper-shell-merge/probe.mjs')).toBe(true);
  });

  // 期望值由一段独立的 Python 按同一算法算出（docs/verify/1404/digest-crosscheck.txt），
  // 不是从本实现回填的。
  test('摘要与独立实现一致，证据目录的 22 个文件不计', () => {
    const files = compareFilesFromResponse(sample) ?? [];
    const r = computePatchDigest(files);
    expect(r.countedFiles).toBe(36);
    expect(r.excluded.length).toBe(22);
    expect(r.countedLines).toBe(846);
    expect(r.patchDigest).toBe(
      'pd1:ddf04cd2406d952eec621a1d4f0b466d77b5084bb555f2e737e6ea1679b7655f',
    );
    expect(computePatchDigest([...files].reverse()).patchDigest).toBe(r.patchDigest);
  });

  test('响应形状不对（缺 files、files 非数组、条目缺字段）返回 null', () => {
    expect(compareFilesFromResponse(null)).toBeNull();
    expect(compareFilesFromResponse({ status: 'ahead' })).toBeNull();
    expect(compareFilesFromResponse({ files: 'x' })).toBeNull();
    expect(compareFilesFromResponse({ files: [{ filename: 'a' }] })).toBeNull();
  });

  const entry = (over: Record<string, unknown> = {}) => ({
    filename: 'apps/server/src/a.ts',
    status: 'renamed',
    sha: 'a'.repeat(40),
    additions: 1,
    deletions: 0,
    previous_filename: 'apps/server/src/b.ts',
    ...over,
  });

  test('previous_filename 映射到 previousFilename；缺省为 null', () => {
    expect(compareFilesFromResponse({ files: [entry()] })?.[0]?.previousFilename).toBe(
      'apps/server/src/b.ts',
    );
    const { previous_filename: _, ...plain } = entry({ status: 'modified' });
    expect(compareFilesFromResponse({ files: [plain] })?.[0]?.previousFilename).toBeNull();
  });

  test('sha 缺失、previous_filename 为空串或非字符串：形状不对，返回 null', () => {
    const { sha: _, ...noSha } = entry();
    expect(compareFilesFromResponse({ files: [noSha] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ previous_filename: '' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ previous_filename: 7 })] })).toBeNull();
  });
});
