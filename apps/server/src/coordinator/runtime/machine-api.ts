import type {
  ClaimedStep,
  MachineAskBody,
  MachineAskResponse,
  MachineDoneBody,
  MachineTokenResponse,
  OtelObservation,
  StepRecord,
  TranscriptRow,
} from '@cairn/shared';

export interface MachineApi {
  claim(): Promise<ClaimedStep | null>;
  recover(): Promise<StepRecord[]>;
  token(stepId: string): Promise<MachineTokenResponse>;
  heartbeat(stepId: string): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  steer?(stepId: string): Promise<{ content: string; key: string } | null>;
  ackSteer?(stepId: string): Promise<void>;
  relayTool(
    stepId: string,
    name: string,
    params: Record<string, unknown>,
    toolCallId?: string,
    signal?: AbortSignal,
  ): Promise<string>;
  askUser(stepId: string, body: MachineAskBody, signal?: AbortSignal): Promise<MachineAskResponse>;
  transcriptRow(stepId: string, row: TranscriptRow, entryId?: string): Promise<void>;
  mapUserEntry?(stepId: string, entryId: string): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  done(stepId: string, body: MachineDoneBody, observation?: OtelObservation): Promise<void>;
}
