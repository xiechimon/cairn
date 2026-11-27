import type { BuildChangesPlainFolderState, DocumentDiffFile } from '@cairn/shared';
import { mapDiffFiles } from '../api/mappers.js';
import type { ReportedChanges } from '../detail/empty-commit.js';
import type { ChangesContent } from '../fixtures/records.js';

export interface BuildChangesQuery {
  status: 'pending' | 'error' | 'success';
  data:
    | (ReportedChanges & {
        files: DocumentDiffFile[];
        plainFolder?: BuildChangesPlainFolderState;
      })
    | undefined;
}

export interface ThreadChanges {
  status: 'none' | 'loading' | 'error' | 'ready';
  content: ChangesContent | undefined;
  fileCount: number;
  added: number;
  removed: number;
  reported: BuildChangesQuery['data'];
  plainFolder?: BuildChangesPlainFolderState;
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

function hasPlainFolderCardState(plainFolder: BuildChangesPlainFolderState | undefined): boolean {
  if (plainFolder === undefined) return false;
  return (
    plainFolder.status !== 'no-changes' ||
    plainFolder.undoable ||
    plainFolder.undoPending ||
    plainFolder.error !== undefined ||
    (plainFolder.conflictFiles?.length ?? 0) > 0
  );
}

function summarize(
  content: ChangesContent,
  plainFolder?: BuildChangesPlainFolderState,
): ThreadChanges {
  return {
    status: content.files.length > 0 || hasPlainFolderCardState(plainFolder) ? 'ready' : 'none',
    content,
    fileCount: content.files.length,
    added: content.files.reduce((sum, file) => sum + file.added, 0),
    removed: content.files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
    reported: undefined,
    ...(plainFolder !== undefined ? { plainFolder } : {}),
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
  const plainFolder = query.data?.plainFolder;
  const summary = summarize({ files: mapDiffFiles(files), expanded }, plainFolder);
  return { ...summary, reported: query.data, settled: true };
}
