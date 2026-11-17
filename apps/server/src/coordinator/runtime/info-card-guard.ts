import { GenerationTask, hook } from '@earendil-works/pi-durable';
import { createCutOffRecovery } from './cut-off-recovery.js';

const MAX_SUBMIT_NUDGES = 2;

export const CUT_OFF_MESSAGE =
  'Your last output was cut off at the length limit, so its tool call never ran. Write long files in parts: call write_file with append: true for every part after the first, a few thousand characters each. Then call submit_report with the path.';

export const SUBMIT_NUDGE_MESSAGE =
  'You ended your turn without a successful submit_report call, so no report was handed in. Write the report to your task folder (in parts with write_file append: true if it is long) and call submit_report with its path.';

export interface InfoCardRunGuard {
  hooks: ReturnType<typeof hook>[];
  reportSubmitted(): void;
}

export function createInfoCardRunGuard(): InfoCardRunGuard {
  let submitted = false;
  let nudges = 0;
  const cutOff = createCutOffRecovery(CUT_OFF_MESSAGE);
  return {
    reportSubmitted: () => {
      submitted = true;
    },
    hooks: [
      cutOff.hook,
      hook(GenerationTask, {
        onYield: () => {
          if (submitted || nudges >= MAX_SUBMIT_NUDGES) return undefined;
          nudges += 1;
          return { continue: SUBMIT_NUDGE_MESSAGE };
        },
      }),
    ],
  };
}
