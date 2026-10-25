import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompareFile, compareFileSchema, GATE_LIMITS } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  compareFilesFromResponse,
  computePatchDigest,
  isEvidencePath,
} from '../src/services/merge-gate/digest.js';

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
  test('with the version prefix, the same set of files in any order yields the same digest', () => {
    const a = computePatchDigest(base);
    const b = computePatchDigest([...base].reverse());
    expect(a.patchDigest).toMatch(/^pd2:[0-9a-f]{64}$/);
    expect(b.patchDigest).toBe(a.patchDigest);
  });

  test('change one blob sha and the digest changes', () => {
    const changed = base.map((f) =>
      f.filename === 'apps/server/src/a.ts' ? { ...f, sha: '9'.repeat(40) } : f,
    );
    expect(computePatchDigest(changed).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
  });

  test('status, filename and blob sha unchanged, only patchSha changed: the digest changes', () => {
    const changed = base.map((f) =>
      f.filename === 'apps/server/src/a.ts' ? { ...f, patchSha: 'd'.repeat(64) } : f,
    );
    expect(computePatchDigest(changed).patchDigest).not.toBe(computePatchDigest(base).patchDigest);
  });

  test('for an entry without a patch the fifth tuple slot is JSON null (not an empty string, not the string "null"), matching an independently computed digest', () => {
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

  test('touching only evidence under docs/verify/ leaves the digest unchanged', () => {
    const more = [
      ...base,
      file({ filename: 'docs/verify/1404/extra.png', status: 'added', sha: '4'.repeat(40) }),
    ];
    expect(computePatchDigest(more).patchDigest).toBe(computePatchDigest(base).patchDigest);
  });

  test('a rename crossing the docs/verify/ boundary (in or out) counts in the digest', () => {
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

  test('previous_filename enters the digest: same name and sha with different rename origins give different digests', () => {
    const fromA = [
      file({ filename: 'apps/x.ts', previousFilename: 'apps/a.ts', status: 'renamed' }),
    ];
    const fromB = [
      file({ filename: 'apps/x.ts', previousFilename: 'apps/b.ts', status: 'renamed' }),
    ];
    expect(computePatchDigest(fromA).patchDigest).not.toBe(computePatchDigest(fromB).patchDigest);
  });

  test('only docs/verify/ at the repo root counts as evidence', () => {
    expect(isEvidencePath('docs/verify/1404/a.txt')).toBe(true);
    expect(isEvidencePath('apps/docs/verify/1404/a.txt')).toBe(false);
    expect(isEvidencePath('docs/verifyx/a.txt')).toBe(false);
  });

  test('file names containing tabs or newlines never collide with other tuples', () => {
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

  test('sorting is by UTF-16 code units, locale-independent: a mixed case-and-punctuation set matches an independently computed digest', () => {
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

  test('supplementary-plane characters next to U+E000-U+FFFF characters: sorted by UTF-16 code unit, not code point', () => {
    const files = [
      file({ filename: 'apps/web/src/\u{FF21}.ts', sha: '1'.repeat(40) }),
      file({ filename: 'apps/web/src/\u{1F600}.ts', sha: '2'.repeat(40) }),
    ];
    const byCodeUnit = 'pd2:b7719a254dc7af748b4dc6cc116a095045ab4a5953fb71d406dd36686dc04e88';
    const byCodePoint = 'pd2:79d3027504003c32589de73cd10c65bd7cc00a44b849aaec97dc21025e34f802';
    expect(computePatchDigest(files).patchDigest).toBe(byCodeUnit);
    expect(computePatchDigest([...files].reverse()).patchDigest).toBe(byCodeUnit);
    expect(byCodeUnit).not.toBe(byCodePoint);
  });

  test('a non-deletion entry with an empty sha: no digest', () => {
    const r = computePatchDigest([...base, file({ filename: 'apps/sub', sha: null })]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('null-sha');
  });

  test('a deletion entry with an empty sha still computes (real responses carry the old blob sha on deletions)', () => {
    const r = computePatchDigest([
      ...base,
      file({ filename: 'apps/gone.ts', status: 'removed', sha: null }),
    ]);
    expect(r.patchDigest).toMatch(/^pd2:/);
  });

  test('299 files compute as usual; 300 is treated as truncated, no digest', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => file({ filename: `apps/f${i}.ts` }));
    expect(GATE_LIMITS.compareFileCap).toBe(300);
    expect(computePatchDigest(many(299)).patchDigest).toMatch(/^pd2:/);
    const r = computePatchDigest(many(300));
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('truncated');
  });

  test('the 300 cap counts the whole list, evidence entries included: 299 code files plus 1 docs/verify entry is truncated', () => {
    const files = [
      ...Array.from({ length: 299 }, (_, i) => file({ filename: `apps/f${i}.ts` })),
      file({ filename: 'docs/verify/1404/run.txt', status: 'added' }),
    ];
    const r = computePatchDigest(files);
    expect(r.kept.length).toBe(299);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('truncated');
  });

  test('a mismatch with the PR changed_files is treated as truncated', () => {
    const r = computePatchDigest(base, { expectedFileCount: base.length + 1 });
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('count-mismatch');
    expect(computePatchDigest(base, { expectedFileCount: base.length }).patchDigest).toMatch(
      /^pd2:/,
    );
  });

  test('compare hands back more entries than changed_files: same mismatch, no digest', () => {
    const r = computePatchDigest(base, { expectedFileCount: base.length - 1 });
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('count-mismatch');
  });

  test('an empty file list: no digest (no patch to bind)', () => {
    const r = computePatchDigest([]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('empty');
  });

  test('an evidence-only patch: no files outside evidence, no digest', () => {
    const r = computePatchDigest([file({ filename: 'docs/verify/1404/a.txt', status: 'added' })]);
    expect(r.patchDigest).toBeNull();
    expect(r.unavailable).toBe('empty');
  });

  test('line and file counts cover the whole patch, docs/verify/ evidence included; the digest still excludes evidence', () => {
    const r = computePatchDigest(base);
    expect(r.countedFiles).toBe(3);
    expect(r.countedLines).toBe(2 + 5 + 20);
    expect(r.kept.map((f) => f.filename)).toEqual(['apps/server/src/a.ts', 'apps/server/src/b.ts']);
    expect(r.excluded.map((f) => f.filename)).toEqual(['docs/verify/1404/run.txt']);
  });

  test('a rename (entry with previous_filename) counts two files, a pure rename has zero lines, evidence renames count too', () => {
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

  test('a copy (copied, with previous_filename) counts two files like a rename', () => {
    const r = computePatchDigest([
      file({
        filename: 'apps/server/src/b.ts',
        previousFilename: 'apps/server/src/a.ts',
        status: 'copied',
      }),
    ]);
    expect(r.countedFiles).toBe(2);
  });
});

describe('real compare response fixtures', () => {
  const sample = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/merge-gate-compare-sample.json'), 'utf8'),
  ) as unknown;

  test('parses 58 files, deletion entries carry the old blob sha, the evidence directory holds an executable', () => {
    const files = compareFilesFromResponse(sample);
    expect(files).not.toBeNull();
    expect(files?.length).toBe(58);
    const removed = files?.filter((f) => f.status === 'removed') ?? [];
    expect(removed.length).toBe(3);
    expect(removed.every((f) => typeof f.sha === 'string' && f.sha.length === 40)).toBe(true);
    expect(files?.some((f) => f.filename === 'docs/verify/paper-shell-merge/probe.mjs')).toBe(true);
  });

  test('the entries compare leaves without a patch are exactly the 20 PNGs (binary), patchSha null; the other 38 entries have patchSha = sha256 of the patch text', () => {
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

  test('every parsed entry satisfies @cairn/shared compareFileSchema, with no fields outside the vocabulary', () => {
    for (const f of compareFilesFromResponse(sample) ?? []) {
      expect(compareFileSchema.parse(f), f.filename).toEqual(f);
    }
  });

  test('the digest matches an independent implementation, the 22 evidence files stay out of the digest but count in files and lines', () => {
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

  test('merging into main resolving conflicts in this PR favor: status, filename and blob unchanged, the patch text changed, different digest', () => {
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

  test('a malformed response (missing files, files not an array, entries missing fields) returns null', () => {
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

  test('previous_filename maps to previousFilename; absent is null', () => {
    expect(compareFilesFromResponse({ files: [entry()] })?.[0]?.previousFilename).toBe(
      'apps/server/src/b.ts',
    );
    const { previous_filename: _, ...plain } = entry({ status: 'modified' });
    expect(compareFilesFromResponse({ files: [plain] })?.[0]?.previousFilename).toBeNull();
  });

  test('sha missing, previous_filename an empty string or not a string: malformed, returns null', () => {
    const { sha: _, ...noSha } = entry();
    expect(compareFilesFromResponse({ files: [noSha] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ previous_filename: '' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ previous_filename: 7 })] })).toBeNull();
  });

  test('a rename or copy entry missing previous_filename (absent or null): malformed, returns null, the original name must not be silently dropped', () => {
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

  test('when patch is a non-empty string patchSha is its sha256 (hex); absent, empty string, null and non-strings are all null', () => {
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

  test('status outside COMPARE_FILE_STATUSES, filename not a string: malformed, returns null', () => {
    expect(compareFilesFromResponse({ files: [entry({ status: 'modified' })] })).toHaveLength(1);
    expect(compareFilesFromResponse({ files: [entry({ status: 'deleted' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ status: 'Modified' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ filename: 7 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ filename: ['apps/a.ts'] })] })).toBeNull();
  });

  test('filename an empty string: malformed, returns null (compareFileSchema requires at least one character)', () => {
    expect(compareFilesFromResponse({ files: [entry({ filename: '' })] })).toBeNull();
  });

  test('additions, deletions or changes negative: malformed, returns null (consistent with compareFileSchema non-negative)', () => {
    expect(compareFilesFromResponse({ files: [entry({ additions: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ deletions: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: -1 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: 1.5 })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: '1' })] })).toBeNull();
    expect(compareFilesFromResponse({ files: [entry({ changes: 1 })] })).toHaveLength(1);
  });
});
