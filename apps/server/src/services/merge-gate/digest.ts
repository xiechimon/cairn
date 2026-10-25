import { createHash } from 'node:crypto';
import {
  COMPARE_FILE_STATUSES,
  type CompareFile,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  PATCH_DIGEST_VERSION,
} from '@cairn/shared/merge-gate';

export type DigestUnavailable = 'truncated' | 'count-mismatch' | 'null-sha' | 'empty';

export interface PatchDigestResult {
  patchDigest: string | null;
  unavailable: DigestUnavailable | null;
  countedFiles: number;
  countedLines: number;
  kept: CompareFile[];
  excluded: CompareFile[];
}

export function isEvidencePath(path: string): boolean {
  return path.startsWith(EVIDENCE_PREFIX);
}

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

  const tuples = kept
    .map((f) => JSON.stringify([f.status, f.filename, f.previousFilename, f.sha, f.patchSha]))
    .sort();
  const hex = createHash('sha256').update(tuples.join('\n')).digest('hex');
  return result(`${PATCH_DIGEST_VERSION}:${hex}`, null);
}

const STATUSES: readonly string[] = COMPARE_FILE_STATUSES;
const isCount = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;

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
