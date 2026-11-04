export interface ReportedChanges {
  files: readonly unknown[];
  reported?: boolean;
  changed?: boolean;
}

export function substantiveChangesOf(
  changes: ReportedChanges | null | undefined,
  settled: boolean,
): boolean | null {
  if (!settled || changes == null || changes.reported !== true) return null;
  if (typeof changes.changed === 'boolean') return changes.changed;
  return changes.files.length > 0;
}
