export const FS_LIST_ERROR_REASONS = [
  'not_absolute',
  'not_found',
  'not_dir',
  'not_readable',
] as const;
export type FsListErrorReason = (typeof FS_LIST_ERROR_REASONS)[number];

export const FS_LIST_MAX_ENTRIES = 2000;

export type FsListEntry = { name: string; git: boolean };

export type FsListResult = { path: string; entries: FsListEntry[]; truncated: boolean };
