import type { ComputerCall } from '@cairn/shared';
import type { MachineApi } from '../machine-client.js';

export const NO_COMPUTER_PROVIDER_MESSAGE = 'This machine has no computer provider';

export async function rejectComputerCall(
  client: Pick<MachineApi, 'computerFrames'>,
  call: ComputerCall,
): Promise<void> {
  await client.computerFrames?.(call.callId, {
    frames: [
      { kind: 'error', seq: 1, message: NO_COMPUTER_PROVIDER_MESSAGE, delivery: 'not_delivered' },
    ],
  });
}
