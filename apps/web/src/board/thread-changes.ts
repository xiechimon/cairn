import type { DocumentDiffFile } from '@cairn/shared';
import { mapDiffFiles } from '../api/mappers.js';
import type { ReportedChanges } from '../detail/empty-commit.js';
import type { ChangesContent } from '../fixtures/records.js';

export interface BuildChangesQuery {
  status: 'pending' | 'error' | 'success';
  data: (ReportedChanges & { files: DocumentDiffFile[] }) | undefined;
}

export interface ThreadChanges {
  status: 'none' | 'loading' | 'error' | 'ready';
  content: ChangesContent | undefined;
  fileCount: number;
  added: number;
  removed: number;
  reported: BuildChangesQuery['data'];
  settled: boolean;
}

const NONE: ThreadChanges = {
  status: 'none',
  content: undefined,
  fileCount: 0,
  added: 0,
  removed: 0,
  reported: undefined,
  settled: false,
};

function summarize(content: ChangesContent): ThreadChanges {
  return {
    status: content.files.length > 0 ? 'ready' : 'none',
    content,
    fileCount: content.files.length,
    added: content.files.reduce((sum, file) => sum + file.added, 0),
    removed: content.files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
    reported: undefined,
    settled: true,
  };
}

export function deriveThreadChanges({
  live,
  buildId,
  query,
  fixture,
  expanded,
}: {
  live: boolean;
  buildId: string | null;
  query: BuildChangesQuery;
  fixture: ChangesContent | undefined;
  expanded: boolean;
}): ThreadChanges {
  if (!live) return fixture === undefined ? NONE : summarize({ ...fixture, expanded });
  if (buildId == null) return NONE;
  if (query.status === 'pending') return { ...NONE, status: 'loading' };
  if (query.status === 'error') return { ...NONE, status: 'error' };
  const files = query.data?.files ?? [];
  const summary = summarize({ files: mapDiffFiles(files), expanded });
  return { ...summary, reported: query.data, settled: true };
}
