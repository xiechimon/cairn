// 补丁摘要 patchDigest（#1404，ADR 0021 D3）：判定绑定的是「这份补丁」，不是
// 某个 head。对 compare {base}...{head} 的文件列表（去掉 docs/verify/ 下的
// 证据）取 (status, filename, previous_filename, blob sha, patchSha) 元组，排序后
// 哈希；patchSha 是该文件 patch 文本的 sha256，没有 patch 时为 null。
// update-branch 只合入 main、main 的新提交不碰本 PR 的文件时，三点 compare
// 的这些元组不变，摘要不变，判定沿用；改一行代码，blob sha 变，摘要变。只有
// blob 不够：合入 main 解冲突保留本 PR 的版本，head blob 不变，补丁却从「A 改
// B」变成「C 改回 B」（撤掉 main 的改动），patchSha 变，摘要变（D3 在 #1410 的修订）。
// D4 的 800 行 / 40 文件上限与摘要口径不同：按整张补丁算，证据也计入。
// 纯函数，无 I/O：compare 由 lib/github.ts 取，结果在这里算。

import { createHash } from 'node:crypto';
import {
  COMPARE_FILE_STATUSES,
  type CompareFile,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  PATCH_DIGEST_VERSION,
} from '@pacman/shared';

/** 摘要不可得的原因：截断（≥ 上限，或与 PR 的 changed_files 对不上）、
 * 非删除条目缺 blob sha（子模块之类，无法绑定内容）、证据之外没有文件
 * （没有可绑定的补丁）。 */
export type DigestUnavailable = 'truncated' | 'count-mismatch' | 'null-sha' | 'empty';

export interface PatchDigestResult {
  /** `pd2:<sha256 hex>`；不可得时为 null（调用方一律按留人处理）。 */
  patchDigest: string | null;
  unavailable: DigestUnavailable | null;
  /** 整张补丁的文件数，含 docs/verify/ 的证据（D4 的 40 文件上限按它算）。
   * 带 previous_filename 的条目（改名）记两个文件，与 pr-gate 的 --no-renames
   * 把改名记成一删一加同数。 */
  countedFiles: number;
  /** 整张补丁的增删行数，含证据：每个条目 compare 给的 additions + deletions
   * （D4 的 800 行上限按它算）。纯改名为 0，二进制为 0。 */
  countedLines: number;
  kept: CompareFile[];
  excluded: CompareFile[];
}

/** 仓根的 docs/verify/ 才算证据；apps/docs/verify/ 之类不算。 */
export function isEvidencePath(path: string): boolean {
  return path.startsWith(EVIDENCE_PREFIX);
}

// 改名只有两头都在证据目录里才排除：代码改名进证据目录、或从证据目录改名
// 出来，都等于代码面有增删，必须进摘要。
function isEvidenceEntry(f: CompareFile): boolean {
  return (
    isEvidencePath(f.filename) &&
    (f.previousFilename === null || isEvidencePath(f.previousFilename))
  );
}

export function computePatchDigest(
  files: readonly CompareFile[],
  opts: { expectedFileCount?: number | null } = {},
): PatchDigestResult {
  const kept = files.filter((f) => !isEvidenceEntry(f));
  const excluded = files.filter(isEvidenceEntry);
  const countedFiles = files.reduce((n, f) => n + (f.previousFilename === null ? 1 : 2), 0);
  const countedLines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const result = (
    patchDigest: string | null,
    unavailable: DigestUnavailable | null,
  ): PatchDigestResult => ({
    patchDigest,
    unavailable,
    countedFiles,
    countedLines,
    kept,
    excluded,
  });

  if (files.length >= GATE_LIMITS.compareFileCap) return result(null, 'truncated');
  if (opts.expectedFileCount != null && opts.expectedFileCount !== files.length) {
    return result(null, 'count-mismatch');
  }
  if (kept.length === 0) return result(null, 'empty');
  if (kept.some((f) => f.sha === null && f.status !== 'removed')) return result(null, 'null-sha');

  // JSON 元组：文件名里的制表符、换行不会让两组不同的条目拼出同一串。
  // 默认排序按 UTF-16 码元比较，与区域设置无关。
  const tuples = kept
    .map((f) => JSON.stringify([f.status, f.filename, f.previousFilename, f.sha, f.patchSha]))
    .sort();
  const hex = createHash('sha256').update(tuples.join('\n')).digest('hex');
  return result(`${PATCH_DIGEST_VERSION}:${hex}`, null);
}

const STATUSES: readonly string[] = COMPARE_FILE_STATUSES;
/** 与 compareFileSchema 的 int().nonnegative() 同一条。 */
const isCount = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;

/** compare 响应体 → 文件条目；形状不对（缺 files、字段缺失或类型不对、行数
 * 为负、改名或复制条目缺原名）返回 null，由调用方按「摘要不可得」处理，不抛进
 * 巡检。changes 不取，但给了就得是非负整数。patch 文本不留，只留它的 sha256
 * （patchSha，UTF-8）；缺省、null、空串或不是字符串都记 null（没有可读的 diff）。 */
export function compareFilesFromResponse(body: unknown): CompareFile[] | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as { files?: unknown }).files;
  if (!Array.isArray(raw)) return null;
  const out: CompareFile[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return null;
    const f = item as Record<string, unknown>;
    if (typeof f.filename !== 'string' || f.filename === '') return null;
    if (typeof f.status !== 'string' || !STATUSES.includes(f.status)) return null;
    if (!(typeof f.sha === 'string' || f.sha === null)) return null;
    if (!isCount(f.additions) || !isCount(f.deletions)) return null;
    if (!(f.changes === undefined || isCount(f.changes))) return null;
    const prev = f.previous_filename;
    if (!(prev === undefined || prev === null || (typeof prev === 'string' && prev !== '')))
      return null;
    // 改名与复制缺原名时，原名进不了路径判定（放过的一侧），按形状不对处理。
    if ((f.status === 'renamed' || f.status === 'copied') && typeof prev !== 'string') return null;
    out.push({
      status: f.status as CompareFile['status'],
      filename: f.filename,
      previousFilename: typeof prev === 'string' ? prev : null,
      sha: f.sha as string | null,
      additions: f.additions as number,
      deletions: f.deletions as number,
      patchSha:
        typeof f.patch === 'string' && f.patch !== ''
          ? createHash('sha256').update(f.patch, 'utf8').digest('hex')
          : null,
    });
  }
  return out;
}
