import type {
  ClaimedStep,
  MachineAskBody,
  MachineAskResponse,
  MachineDoneBody,
  MachineTokenResponse,
  StepRecord,
  TranscriptRow,
} from '@cairn/shared';

export interface MachineApi {
  claim(): Promise<ClaimedStep | null>;
  recover(): Promise<StepRecord[]>;
  token(stepId: string): Promise<MachineTokenResponse>;
  heartbeat(stepId: string): Promise<void>;
  stop(stepId: string): Promise<boolean | null>;
  relayTool(stepId: string, name: string, params: Record<string, unknown>): Promise<string>;
  askUser(stepId: string, body: MachineAskBody, signal?: AbortSignal): Promise<MachineAskResponse>;
  transcriptRow(stepId: string, row: TranscriptRow, entryId?: string): Promise<void>;
  mapUserEntry?(stepId: string, entryId: string): Promise<void>;
  transcriptDelta(stepId: string, text: string): Promise<void>;
  done(stepId: string, body: MachineDoneBody): Promise<void>;
}
