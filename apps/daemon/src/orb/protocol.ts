import { type ClaimedStep, machineDoneBodySchema, transcriptUploadSchema } from '@cairn/shared';
import { z } from 'zod';
import type { MachineApi } from '../machine-client.js';
import type { RunStepOptions } from '../runner.js';

export const ORB_MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const ORB_MAX_CHECKPOINT_CONTENT_BYTES = 4 * 1024 * 1024;

export const orbReleaseKeySchema = z
  .string()
  .max(240)
  .regex(
    /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?-[a-f0-9]{4,40}-dist-[a-f0-9]{16}(?:-dirty-[a-f0-9]{16})?$/,
  );

export function isOrbPathId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

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
export const ORB_RELAY_METHODS = [...ORB_STEP_METHODS, 'deliverBundle'] as const;
export type OrbStepMethod = (typeof ORB_RELAY_METHODS)[number];

export const orbBundleArgsSchema = z.tuple([
  z.string(),
  z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.bundle$/),
]);

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
    transcript: transcriptUploadSchema.shape.messages
      .refine(
        (messages) =>
          Buffer.byteLength(JSON.stringify(messages)) <= ORB_MAX_CHECKPOINT_CONTENT_BYTES,
      )
      .optional(),
    sessionContent: z
      .string()
      .refine((content) => Buffer.byteLength(content) <= ORB_MAX_CHECKPOINT_CONTENT_BYTES)
      .nullable()
      .optional(),
  })
  .strict();

export const orbWorkerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cancel'), id: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('session'), live: z.boolean() }).strict(),
  z.object({ type: z.literal('checkpoint'), checkpoint: orbCheckpointSchema }).strict(),
  z
    .object({
      type: z.literal('steered'),
      id: z.number().int().nonnegative(),
      error: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal('log'), message: z.string() }).strict(),
  z.object({ type: z.literal('finished') }).strict(),
  z.object({ type: z.literal('failed'), error: z.string() }).strict(),
]);

export type OrbFrame =
  | { type: 'auth'; token: string; release: string }
  | { type: 'authenticated' }
  | { type: 'refused'; reason: 'stale-release' }
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
