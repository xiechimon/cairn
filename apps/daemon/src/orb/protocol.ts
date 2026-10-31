import { type ClaimedStep, machineDoneBodySchema, transcriptUploadSchema } from '@cairn/shared';
import { z } from 'zod';
import type { MachineApi } from '../machine-client.js';
import type { RunStepOptions } from '../runner.js';

export const ORB_RPC_PREFIX = 'cairn-orb-rpc:';
export const ORB_STEP_METHODS = [
  'heartbeat',
  'tool',
  'transcriptDelta',
  'thinkingDelta',
  'transcriptRow',
  'activity',
  'agentTodo',
  'relayTool',
  'askUser',
  'token',
  'skillsManifest',
  'skillFile',
  'attachment',
  'uploadUrls',
  'putUpload',
  'done',
  'reportClaudeRateLimit',
  'steer',
  'steerAck',
  'stop',
] as const satisfies readonly (keyof MachineApi)[];
export type OrbStepMethod = (typeof ORB_STEP_METHODS)[number];

export interface OrbStepInput {
  claimed: ClaimedStep;
  options: RunStepOptions;
  machineName?: string;
  hookTimeoutMs?: number;
  methods: OrbStepMethod[];
}

export const orbCheckpointSchema = z
  .object({
    state: z.enum(['claimed', 'running', 'awaiting-upload', 'done', 'failed']),
    sessionId: z.string().nullable(),
    sessionAction: z.enum(['new', 'continue']),
    prompt: z.string().nullable(),
    doneBody: machineDoneBodySchema.nullable().optional(),
    planContent: z.string().nullable().optional(),
    transcript: transcriptUploadSchema.shape.messages.optional(),
    sessionContent: z.string().nullable().optional(),
  })
  .strict();

export type OrbFrame =
  | { type: 'init'; input: OrbStepInput }
  | { type: 'call'; id: number; method: OrbStepMethod; args: unknown[]; cancellable?: boolean }
  | { type: 'cancel'; id: number }
  | {
      type: 'reply';
      id: number;
      value?: unknown;
      error?: string;
      status?: number;
      body?: string;
      forbidden?: boolean;
    }
  | { type: 'stop'; discard: boolean }
  | { type: 'session'; live: boolean }
  | { type: 'checkpoint'; checkpoint: z.infer<typeof orbCheckpointSchema> }
  | { type: 'steered'; id: number; error?: string }
  | {
      type: 'steer';
      id: number;
      text: string;
      images?: readonly { data: string; mimeType: string }[];
    }
  | { type: 'log'; message: string }
  | { type: 'finished' }
  | { type: 'failed'; error: string };

export function encodeOrbFrame(frame: OrbFrame): string {
  return `${ORB_RPC_PREFIX}${JSON.stringify(frame)}\n`;
}

export function decodeOrbFrame(line: string): OrbFrame | null {
  if (!line.startsWith(ORB_RPC_PREFIX)) return null;
  try {
    return JSON.parse(line.slice(ORB_RPC_PREFIX.length)) as OrbFrame;
  } catch {
    return null;
  }
}
