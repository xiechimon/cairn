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
  scopeKey: z.string().min(1).optional(),
});
export type ComputerCall = z.infer<typeof computerCallSchema>;

const frameSeq = z.number().int().positive();

export const LOGIN_SIGNALS = [
  'password',
  'current-password',
  'new-password',
  'one-time-code',
  'username',
  'challenge',
] as const;
export const loginSignalSchema = z.enum(LOGIN_SIGNALS);
export type LoginSignal = z.infer<typeof loginSignalSchema>;
export const loginFormSchema = z.object({
  signals: z.array(loginSignalSchema).min(1).max(LOGIN_SIGNALS.length),
});
export type LoginForm = z.infer<typeof loginFormSchema>;

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
    loginForm: loginFormSchema.optional(),
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

export const machineComputerRelayBodySchema = z.object({
  computer: z.literal(true),
  name: computerToolSchema,
  toolCallId: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()),
});
export type MachineComputerRelayBody = z.infer<typeof machineComputerRelayBodySchema>;

export const computerRelayResultSchema = z.object({
  text: z.string(),
  images: z.array(computerImageSchema).max(COMPUTER_IMAGES_MAX).optional(),
});
export type ComputerRelayResult = z.infer<typeof computerRelayResultSchema>;

export const COMPUTER_FEED_TOOLS = [
  'shell',
  'user_computer_shell',
  'write_file',
  'attach_file',
  'open_path',
  'launch_app',
] as const;
export type ComputerFeedTool = (typeof COMPUTER_FEED_TOOLS)[number];

export const computerCommandSchema = z.object({
  callId: computerCallIdSchema,
  computerId: recordId.nullable(),
  stepId: recordId,
  tool: z.enum(COMPUTER_FEED_TOOLS),
  command: z.string(),
  cwd: z.string(),
  status: z.enum(['running', 'done', 'error', 'interrupted', 'cancelled']),
  exitCode: z.number().int().nullable(),
  output: z.string(),
  at: epochMs,
});
export type ComputerCommand = z.infer<typeof computerCommandSchema>;

export const computerRecordSchema = z.object({
  id: recordId,
  scopeKey: z.string(),
  state: z.enum(COMPUTER_STATES),
  controlHolder: z.enum(COMPUTER_CONTROL_HOLDERS),
  browserEnabled: z.boolean(),
  machine: z.object({ id: z.string(), name: z.string(), online: z.boolean() }),
});
export type ComputerRecord = z.infer<typeof computerRecordSchema>;

export const computerPatchBodySchema = z.object({
  browserEnabled: z.boolean(),
});
export type ComputerPatchBody = z.infer<typeof computerPatchBodySchema>;

export const computerEnsureBodySchema = z.object({
  machineId: z.string().min(1).max(128),
  browserEnabled: z.boolean(),
});
export type ComputerEnsureBody = z.infer<typeof computerEnsureBodySchema>;

export const COMPUTER_BROWSER_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
] as const;
export type ComputerBrowserTool = (typeof COMPUTER_BROWSER_TOOLS)[number];

export function isComputerBrowserTool(name: string): name is ComputerBrowserTool {
  return (COMPUTER_BROWSER_TOOLS as readonly string[]).includes(name);
}

export const COMPUTER_COMMANDS_LIMIT_DEFAULT = 50;
export const COMPUTER_COMMANDS_LIMIT_MAX = 200;

export const computerCommandsResponseSchema = z.object({
  commands: z.array(computerCommandSchema),
});
export type ComputerCommandsResponse = z.infer<typeof computerCommandsResponseSchema>;
