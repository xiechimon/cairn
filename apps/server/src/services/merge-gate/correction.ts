export const CORRECTION_GUARD_MISSING =
  'Correction requires an executable test or gate in the merge diff with a negative control';

export const CORRECTION_PROMPT =
  'Correction task: add the highest feasible guard (structure, types, lint, test or gate). Include a negative control that reproduces the original failure, fails before the fix and passes after it. Deliver the executable test or gate in the merge diff; documentation alone cannot complete this task.';

export function correctionDoneCheck(
  files: readonly { path: string; additions: number; status?: string }[] | null,
): boolean {
  return (
    files?.some(
      (file) =>
        file.status === 'added' &&
        file.additions > 0 &&
        (/^(?:apps|packages|integration)\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path) ||
          /^scripts\/.*(?:\.test\.(?:[cm]?[jt]s|py|sh)|[-/]gate\.(?:[cm]?[jt]s|py|sh)|\.grit)$/.test(
            file.path,
          ) ||
          /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path)),
    ) ?? false
  );
}
