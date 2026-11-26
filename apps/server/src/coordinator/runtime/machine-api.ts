import type {
  ClaimedStep,
  ComputerRelayResult,
  MachineAskBody,
  MachineAskResponse,
  MachineDoneBody,
  MachineTokenResponse,
  OtelObservation,
  StepRecord,
  TranscriptRow,
} from '@cairn/shared';

import type { InputChannel } from './input-channel.js';

export interface MachineApi {
  inputs?: InputChannel;
  claim(): Promise<ClaimedStep | null>;
  recover(): Promise<StepRecord[]>;
  token(stepId: string): Promise<MachineTokenResponse>;
  reusedInstructions?(stepId: string, sentBy: string): Promise<void>;
  heartbeat(stepId: string): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  steer?(
    stepId: string,
    admittedRequestIds?: readonly string[],
  ): Promise<{ content: string; key: string } | null>;
  ackSteer?(stepId: string): Promise<void>;
  relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    toolCallId?: string,
    signal?: AbortSignal,
  ): Promise<string>;
  relayComputer(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    toolCallId: string,
    signal?: AbortSignal,
  ): Promise<ComputerRelayResult>;
  askUser(stepId: string, body: MachineAskBody, signal?: AbortSignal): Promise<MachineAskResponse>;
  transcriptRow(stepId: string, row: TranscriptRow, entryId?: string): Promise<void>;
  mapUserEntry?(stepId: string, entryId: string): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  resetLive?(stepId: string): Promise<void>;
  done(stepId: string, body: MachineDoneBody, observation?: OtelObservation): Promise<void>;
  canSuggestReplies?(stepId: string): Promise<boolean>;
  suggestReplies?(stepId: string, replies: readonly string[]): Promise<void>;
}
