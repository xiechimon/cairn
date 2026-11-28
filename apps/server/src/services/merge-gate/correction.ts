export const CORRECTION_GUARD_MISSING =
  'Correction requires an executable test or gate in the merge diff with a negative control';

export const CORRECTION_PROMPT =
  'Correction task: add the highest feasible guard (structure, types, lint, test or gate). Include a negative control that reproduces the original failure, fails before the fix and passes after it. Deliver the executable test or gate in the merge diff; documentation alone cannot complete this task.';
