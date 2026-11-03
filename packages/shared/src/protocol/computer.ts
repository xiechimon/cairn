import { z } from 'zod';
import { epochMs, recordId } from '../records/common.js';

export const COMPUTER_TOOLS = [
  'shell',
  'list_files',
  'read_file',
  'write_file',
  'attach_file',
  'computer_observe',
  'computer_act',
  'open_path',
  'launch_app',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'request_takeover',
  'user_computer_shell',
  'user_computer_observe',
  'user_computer_act',
] as const;
export const computerToolSchema = z.enum(COMPUTER_TOOLS);
export type ComputerTool = z.infer<typeof computerToolSchema>;

export const COMPUTER_REPLAY_SAFE_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'list_files',
  'read_file',
  'computer_observe',
  'browser_snapshot',
  'user_computer_observe',
]);

export const computerCallIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const COMPUTER_IMAGE_MAX_BASE64_CHARS = 4 * 1024 * 1024;
export const COMPUTER_IMAGES_MAX = 4;
export const COMPUTER_FRAME_TEXT_MAX_CHARS = 64 * 1024;
export const COMPUTER_FRAMES_PER_POST_MAX = 64;

export const computerImageSchema = z.object({
  data: z
    .string()
    .min(1)
    .max(COMPUTER_IMAGE_MAX_BASE64_CHARS)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
});
export type ComputerImage = z.infer<typeof computerImageSchema>;

export const computerCallSchema = z.object({
  callId: computerCallIdSchema,
  stepId: recordId,
  tool: computerToolSchema,
  params: z.record(z.string(), z.unknown()),
  deadlineAt: epochMs,
});
export type ComputerCall = z.infer<typeof computerCallSchema>;

const frameSeq = z.number().int().positive();

export const computerFrameSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('output'),
    seq: frameSeq,
    stream: z.enum(['stdout', 'stderr']),
    text: z.string().max(COMPUTER_FRAME_TEXT_MAX_CHARS),
  }),
  z.object({ kind: z.literal('heartbeat'), seq: frameSeq }),
  z.object({
    kind: z.literal('done'),
    seq: frameSeq,
    text: z.string().max(COMPUTER_FRAME_TEXT_MAX_CHARS),
    images: z.array(computerImageSchema).max(COMPUTER_IMAGES_MAX).optional(),
    exitCode: z.number().int().nullable().optional(),
  }),
  z.object({
    kind: z.literal('error'),
    seq: frameSeq,
    message: z.string().max(4096),
    delivery: z.enum(['not_delivered', 'unknown']),
  }),
]);
export type ComputerFrame = z.infer<typeof computerFrameSchema>;

export const machineComputerFramesBodySchema = z.object({
  frames: z.array(computerFrameSchema).min(1).max(COMPUTER_FRAMES_PER_POST_MAX),
});
export type MachineComputerFramesBody = z.infer<typeof machineComputerFramesBodySchema>;

export const machineComputerFramesResponseSchema = z.object({
  ok: z.literal(true),
  cancelled: z.boolean(),
});
export type MachineComputerFramesResponse = z.infer<typeof machineComputerFramesResponseSchema>;

export const COMPUTER_CALL_STATES = [
  'dispatched',
  'running',
  'done',
  'error',
  'interrupted',
  'cancelled',
] as const;
export type ComputerCallState = (typeof COMPUTER_CALL_STATES)[number];

export const COMPUTER_STATES = ['stopped', 'starting', 'running', 'failed'] as const;
export type ComputerState = (typeof COMPUTER_STATES)[number];

export const COMPUTER_CONTROL_HOLDERS = ['none', 'bot', 'user'] as const;
export type ComputerControlHolder = (typeof COMPUTER_CONTROL_HOLDERS)[number];
