// 合并就绪闸 S1（#1404）：补丁摘要 patchDigest（ADR 0021 D3）。
// 失败方式先行：顺序 / 区域设置让同一补丁算出两个摘要；改名移进 docs/verify/
// 把代码删除藏起来；文件名含制表符或换行时元组撞车；空 blob sha 被当成
// 字符串 'null' 哈希；compare 截到 300 个文件仍被当成完整列表。
// 第三轮（ADR 0021 D4 修订）补的：800 行 / 40 文件按整张补丁算，证据也计入，
// 改名记两个文件；compare 不给 patch 的条目要能认出来（二进制）；增删行数为负
// 的响应按形状不对处理。
// 第四轮补的：改名或复制条目缺 previous_filename 按形状不对处理（不然原名不进
// 路径判定）；固定码元排序（换成 localeCompare 摘要就变）。
// 第五轮（ADR 0021 D3 在 #1410 的修订）补的：元组第五位 patchSha。只绑 head 上
// 的 blob 不够：合入 main 解冲突保留本 PR 的版本，blob 不变，补丁却从「A 改 B」
// 变成「C 改回 B」；没有 patch 时 patchSha 为 null，不是空串的哈希。另钉住：
// compare 给的条目比 changed_files 多也算对不上；status 不在取值表里、filename
// 不是字符串都按形状不对处理。
// 夹具 test/fixtures/merge-gate-compare-sample.json 是一次真实的只读 compare
// 响应（xiechimon/pacman 52d2cdc...b4b1f96，per_page=1；patch 有则换成一句占位、
// 无则仍缺）；去掉 patch 后与 docs/verify/1404/compare-sample.json 同一份，放在
// 测试目录里是因为摘要不计 docs/verify/，测试读的夹具不能落在摘要之外。夹具的
// 摘要绑的是占位文本的 patchSha，不是真实补丁的。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompareFile, compareFileSchema, GATE_LIMITS } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  compareFilesFromResponse,
  computePatchDigest,
  isEvidencePath,
} from '../src/services/merge-gate/digest.js';

/** 单测里直接给的 patchSha（computePatchDigest 不重算它）；真实值见夹具的测试。 */
const PATCH_SHA = 'c'.repeat(64);

const file = (over: Partial<CompareFile> & { filename: string }): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: 'a'.repeat(40),
  additions: 1,
  deletions: 1,
  patchSha: PATCH_SHA,
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
    expect(a.patchDigest).toMatch(/^pd2:[0-9a-f]{64}$/);
    expect(b.patchDigest).toBe(a.patchDigest);
  });

  test('改一个 blob sha，摘要就变', () => {
    const changed = base.map((f) =>
      f.filename === 'apps/server/src/a.ts' ? { ...f, sha: '9'.repeat(40) } : f,
    );
    expect(computePatchDigest(changed).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
  });

  test('status、filename、blob sha 都不变、只有 patchSha 变：摘要就变', () => {
    const changed = base.map((f) =>
      f.filename === 'apps/server/src/a.ts' ? { ...f, patchSha: 'd'.repeat(64) } : f,
    );
    expect(computePatchDigest(changed).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
  });

  // 期望值由独立的 Python 按 D3 修订后的元组算出（docs/verify/1404/digest-crosscheck-2.txt）。
  test('没有 patch 的条目元组第五位是 JSON null（不是空串、不是字符串 "null"），对上独立算出的摘要', () => {
    const files = [
      file({ filename: 'apps/server/src/a.ts', sha: '1'.repeat(40) }),
      file({
        filename: 'apps/web/public/logo.png',
        status: 'added',
        sha: '5'.repeat(40),
        patchSha: null,
        additions: 0,
        deletions: 0,
      }),
    ];
    expect(computePatchDigest(files).patchDigest).toBe(
      'pd2:ca814f29974582368d2d5afa5202827ed353fde86d5b7737764a539e93bc4987',
    );
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

  // 期望值由 Python 的 sorted()（按码点；BMP 内与 UTF-16 码元同序）独立算出，
  // 见 docs/verify/1404/digest-crosscheck-2.txt（第四轮的四元组版见 s1-r4-red-green.txt）。
  // 码元序：B.ts < a-b.ts < a.b.ts < a/b.ts（'B' 0x42 < 'a' 0x61；'-' 0x2D < '.' 0x2E
  // < '/' 0x2F）；localeCompare 把 a 排在 B 前。
  test('排序按 UTF-16 码元、与区域设置无关：大小写与标点混排的一组对上独立算出的摘要', () => {
    const files = [
      file({ filename: 'apps/web/src/a/b.ts', sha: '1'.repeat(40) }),
      file({ filename: 'apps/web/src/a.b.ts', sha: '2'.repeat(40) }),
      file({ filename: 'apps/web/src/B.ts', sha: '3'.repeat(40) }),
      file({ filename: 'apps/web/src/a-b.ts', sha: '4'.repeat(40) }),
    ];
    const expected = 'pd2:8a58b36d470b028c799fa04cf16468b3b9507d6097e26bf87d2f878fbe124ad0';
    expect(computePatchDigest(files).patchDigest).toBe(expected);
    expect(computePatchDigest([...files].reverse()).patchDigest).toBe(expected);
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
    expect(r.patchDigest).toMatch(/^pd2:/);
  });

  test('299 个文件照常；300 个即视为截断，摘要不可得', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => file({ filename: `apps/f${i}.ts` }));
    expect(GATE_LIMITS.compareFileCap).toBe(300);
    expect(computePatchDigest(many(299)).patchDigest).toMatch(/^pd2:/);
    const r = computePatchDigest(many(300));
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('truncated');
  });

  test('与 PR 的 changed_files 对不上即视为截断', () => {
    const r = computePatchDigest(base, { expectedFileCount: base.length + 1 });
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('count-mismatch');
    expect(computePatchDigest(base, { expectedFileCount: base.length }).patchDigest).toMatch(
      /^pd2:/,
    );
  });

  test('compare 给的条目比 changed_files 多：同样对不上，摘要不可得', () => {
    const r = computePatchDigest(base, { expectedFileCount: base.length - 1 });
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('count-mismatch');
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

  test('行数与文件数按整张补丁算，docs/verify/ 的证据也计入；摘要照旧不计证据', () => {
    const r = computePatchDigest(base);
    expect(r.countedFiles).toBe(3);
    expect(r.countedLines).toBe(2 + 5 + 20);
    expect(r.kept.map((f) => f.filename)).toEqual(['apps/server/src/a.ts', 'apps/server/src/b.ts']);
    expect(r.excluded.map((f) => f.filename)).toEqual(['docs/verify/1404/run.txt']);
  });

  test('改名（带 previous_filename 的条目）记两个文件，纯改名行数为 0，证据里的改名也算', () => {
    const r = computePatchDigest([
      file({ filename: 'apps/server/src/c.ts', additions: 3, deletions: 2 }),
      file({
        filename: 'apps/server/src/new.ts',
        previousFilename: 'apps/server/src/old.ts',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        patchSha: null,
      }),
      file({
        filename: 'docs/verify/1404/b.txt',
        previousFilename: 'docs/verify/1404/a.txt',
        status: 'renamed',
        additions: 0,
        deletions: 0,
        patchSha: null,
      }),
    ]);
    expect(r.countedFiles).toBe(1 + 2 + 2);
    expect(r.countedLines).toBe(5);
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

  // patchSha 的期望值是占位文本 "(patch trimmed)" 的 sha256，由 Python 与 sha256sum
  // 独立算出（docs/verify/1404/digest-crosscheck-2.txt）。
  test('compare 不给 patch 的正是 20 张 PNG（二进制），patchSha 为 null；其余 38 个条目的 patchSha 是 patch 文本的 sha256', () => {
    const files = compareFilesFromResponse(sample) ?? [];
    const noPatch = files.filter((f) => f.patchSha === null).map((f) => f.filename);
    expect(noPatch.length).toBe(20);
    expect(noPatch.every((n) => /^docs\/verify\/paper-shell-merge\/[a-z-]+\.png$/.test(n))).toBe(
      true,
    );
    const withPatch = files.filter((f) => f.patchSha !== null);
    expect(withPatch.length).toBe(38);
    expect(
      withPatch.every(
        (f) => f.patchSha === '561ef97dad90bb106e586b8ff010ced42de1b46b1dad3af30be0d9b370ac83f6',
      ),
    ).toBe(true);
  });

  test('解析出的每个条目都合 @pacman/shared 的 compareFileSchema，且没有词表之外的字段', () => {
    for (const f of compareFilesFromResponse(sample) ?? []) {
      expect(compareFileSchema.parse(f), f.filename).toEqual(f);
    }
  });

  // 期望值由一段独立的 Python 按 D3 修订后的五元组算出（docs/verify/1404/digest-crosscheck-2.txt；
  // 四元组时的版本见 digest-crosscheck.txt），不是从本实现回填的。
  // 文件数与行数按整张补丁：58 个文件（无改名），846 + 证据里两个 .mjs 的 40 + 46 行
  // （PNG 记 0 行）；独立复算见 docs/verify/1404/s1-r3-red-green.txt。
  test('摘要与独立实现一致，证据目录的 22 个文件不进摘要但计入文件数与行数', () => {
    const files = compareFilesFromResponse(sample) ?? [];
    const r = computePatchDigest(files);
    expect(r.kept.length).toBe(36);
    expect(r.excluded.length).toBe(22);
    expect(r.countedFiles).toBe(58);
    expect(r.countedLines).toBe(932);
    expect(r.patchDigest).toBe(
      'pd2:b8fc25a097b7a43e1929cee82b6ec03f0821c373e443df65612278baff845e4e',
    );
    expect(computePatchDigest([...files].reverse()).patchDigest).toBe(r.patchDigest);
  });

  // pr-gate 第三轮（#1420）的场景：合并基上 f=A，PR 改成 B，main 同时改成 C；PR 合入
  // main 解冲突保留 B。之前三点 compare 是「A 改 B」，之后合并基到了 main，是「C 改回 B」，
  // 悄悄撤掉 main 的改动；status、filename、head blob 一样都不变。两个摘要的期望值由
  // Python 独立算出（docs/verify/1404/digest-crosscheck-2.txt）。
  test('合入 main 解冲突保留本 PR 版本：status、filename、blob 不变，补丁文本变了，摘要不同', () => {
    const entryWith = (patch: string) => ({
      sha: 'b'.repeat(40),
      filename: 'apps/server/src/f.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
      changes: 2,
      patch,
    });
    const before = compareFilesFromResponse({ files: [entryWith('@@ -1 +1 @@\n-A\n+B')] }) ?? [];
    const after = compareFilesFromResponse({ files: [entryWith('@@ -1 +1 @@\n-C\n+B')] }) ?? [];
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect({ ...after[0], patchSha: null }).toEqual({ ...before[0], patchSha: null });
    const d0 = computePatchDigest(before).patchDigest;
    const d1 = computePatchDigest(after).patchDigest;
    expect(d1).not.toBe(d0);
    expect(d0).toBe('pd2:baad71232a1c6dee1e4ccd3f424848c8b40eee36e47f6ec2e223944f1d5a707b');
    expect(d1).toBe('pd2:8fbd0cd1a687deb947080913ea2a509bde7ae97783fdeaf158747ebb33160239');
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

  test('改名或复制条目缺 previous_filename（缺省或 null）：形状不对，返回 null，原名不能悄悄丢掉', () => {
    for (const status of ['renamed', 'copied']) {
      const { previous_filename: _, ...noPrev } = entry({ status });
      expect(compareFilesFromResponse({ files: [noPrev] }), status).toBeNull();
      const nullPrev = entry({ status, previous_filename: null });
      expect(compareFilesFromResponse({ files: [nullPrev] }), status).toBeNull();
    }
    expect(
      compareFilesFromResponse({ files: [entry({ status: 'copied' })] })?.[0]?.previousFilename,
    ).toBe('apps/server/src/b.ts');
  });

  // 期望值由 Python 与 sha256sum 独立算出（docs/verify/1404/digest-crosscheck-2.txt）；
  // 非 ASCII 的一条钉住按 UTF-8 编码取哈希。
  test('patch 是非空字符串时 patchSha 是它的 sha256（hex）；缺省、空串、null、非字符串都为 null', () => {
    const patchSha = (over: Record<string, unknown>) =>
      compareFilesFromResponse({ files: [entry(over)] })?.[0]?.patchSha;
    expect(patchSha({ patch: '@@ -1 +1 @@\n-a\n+b' })).toBe(
      'f66a89464b010b341f1aff020e1ce988a94fabf234c1cdf681f812918d8b132d',
    );
    expect(patchSha({ patch: '@@ -1 +1 @@\n-旧\n+新' })).toBe(
      'd983495a739ed62907bdfdc4861f9446079a23481a4a3bad678d5ee1986b7eff',
    );
    expect(patchSha({})).toBeNull();
    expect(patchSha({ patch: '' })).toBeNull();
    expect(patchSha({ patch: null })).toBeNull();
    expect(patchSha({ patch: 7 })).toBeNull();
  });

  test('status 不在 COMPARE_FILE_STATUSES 里、filename 不是字符串：形状不对，返回 null', () => {
    expect(compareFilesFromResponse({ files: [entry({ status: 'modified' })] })).toHaveLength(1);
    expect(compareFilesFromResponse({ files: [entry({ status: 'deleted' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ status: 'Modified' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ filename: 7 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ filename: ['apps/a.ts'] })] })).toBeNull();
  });

  test('additions、deletions 或 changes 为负：形状不对，返回 null（与 compareFileSchema 的非负一致）', () => {
    expect(compareFilesFromResponse({ files: [entry({ additions: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ deletions: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: 1.5 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: '1' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: 1 })] })).toHaveLength(1);
  });
});
