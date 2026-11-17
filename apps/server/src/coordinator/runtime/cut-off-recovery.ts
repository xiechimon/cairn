import { GenerationTask, hook } from '@earendil-works/pi-durable';

const MAX_CUT_OFF_RETRIES = 4;
const CUT_OFF_PLACEHOLDER = '(output cut off at the length limit)';

export interface CutOffRecovery {
  hook: ReturnType<typeof hook>;
  wasCutOff(): boolean;
  continueAfterCutOff(): string | undefined;
}

export function createCutOffRecovery(retryMessage: string): CutOffRecovery {
  let cutOff = false;
  let retries = 0;
  const continueAfterCutOff = () => {
    if (!cutOff || retries >= MAX_CUT_OFF_RETRIES) return undefined;
    retries += 1;
    return retryMessage;
  };
  return {
    wasCutOff: () => cutOff,
    continueAfterCutOff,
    hook: hook(GenerationTask, {
      afterResponse: (message) => {
        cutOff = message.stopReason === 'length';
        if (!cutOff) {
          retries = 0;
          return;
        }
        const kept = message.content.filter((block) => block.type !== 'toolCall');
        message.content = kept.length > 0 ? kept : [{ type: 'text', text: CUT_OFF_PLACEHOLDER }];
      },
      onYield: () => {
        const text = continueAfterCutOff();
        return text === undefined ? undefined : { continue: text };
      },
    }),
  };
}
