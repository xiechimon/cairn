import { GenerationTask, hook } from '@earendil-works/pi-durable';

const MAX_CUT_OFF_RETRIES = 4;
const MAX_SUBMIT_NUDGES = 2;
const CUT_OFF_PLACEHOLDER = '(output cut off at the length limit)';

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
  let cutOff = false;
  let cutOffRetries = 0;
  let nudges = 0;
  return {
    reportSubmitted: () => {
      submitted = true;
    },
    hooks: [
      hook(GenerationTask, {
        afterResponse: (message) => {
          cutOff = message.stopReason === 'length';
          if (!cutOff) return;
          const kept = message.content.filter((block) => block.type !== 'toolCall');
          message.content = kept.length > 0 ? kept : [{ type: 'text', text: CUT_OFF_PLACEHOLDER }];
        },
        onYield: () => {
          if (submitted) return undefined;
          if (cutOff && cutOffRetries < MAX_CUT_OFF_RETRIES) {
            cutOffRetries += 1;
            return { continue: CUT_OFF_MESSAGE };
          }
          if (nudges < MAX_SUBMIT_NUDGES) {
            nudges += 1;
            return { continue: SUBMIT_NUDGE_MESSAGE };
          }
          return undefined;
        },
      }),
    ],
  };
}
