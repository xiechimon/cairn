import { z } from 'zod';
import { epochMs, recordId } from '../records/common.js';
import { workspaceFileInstanceSchema } from './workspace-file.js';

export const COMPUTER_TOOLS = [
  'shell',
  'list_files',
  'read_file',
  'write_file',
  'attach_file',
  'stage_attachment',
  'computer_observe',
  'computer_act',
  'desktop_snapshot',
  'desktop_act',
  'open_path',
  'launch_app',
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
  'browser_close_tab',
  'request_takeover',
  'user_computer_shell',
  'user_computer_observe',
  'user_computer_act',
  'phone_observe',
  'phone_act',
  'phone_manage',
] as const;
export const computerToolSchema = z.enum(COMPUTER_TOOLS);
export type ComputerTool = z.infer<typeof computerToolSchema>;

export const COMPUTER_REPLAY_SAFE_TOOLS: ReadonlySet<ComputerTool> = new Set([
  'list_files',
  'read_file',
  'stage_attachment',
  'computer_observe',
  'desktop_snapshot',
  'browser_snapshot',
  'user_computer_observe',
  'phone_observe',
]);

export const STAGED_UPLOADS_DIR_NAME = 'cairn-uploads';
export const STAGE_ATTACHMENT_TIMEOUT_MS = 30_000;

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

export const browserSecretFillActionSchema = z.strictObject({
  kind: z.literal('fill_secret'),
  ref: z.string().min(1).max(64),
  secret: z.string().min(1).max(200),
  origin: z.string().min(1).max(2048),
});
export type BrowserSecretFillAction = z.infer<typeof browserSecretFillActionSchema>;

export const computerCallSchema = z.object({
  callId: computerCallIdSchema,
  stepId: recordId,
  tool: computerToolSchema,
  params: z.record(z.string(), z.unknown()),
  deadlineAt: epochMs,
  scopeKey: z.string().min(1).optional(),
  browserScope: z.string().min(1).max(200).optional(),
  tabScope: z
    .string()
    .regex(/^[A-Za-z0-9_:-]{1,96}$/)
    .optional(),
  browserSecrets: z
    .array(
      z.strictObject({
        name: z.string(),
        origin: z.string(),
        value: z.string(),
        username: z.string().optional(),
      }),
    )
    .optional(),
  ownerChrome: z.literal('browsermcp').optional(),
  computerGrant: z.enum(['browser', 'desktop']).optional(),
  hostShellEscalation: z.literal('approved').optional(),
  phone: z
    .strictObject({
      phoneId: recordId,
      deviceId: z.string().min(1).max(256),
    })
    .optional(),
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
    workspace: workspaceFileInstanceSchema.optional(),
    sandboxDenied: z
      .strictObject({
        reason: z.string().min(1).max(500),
      })
      .optional(),
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

export const machinePhoneConsentBodySchema = z.object({
  phoneId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(256),
  callId: z.string().min(1).max(128).optional(),
});
export type MachinePhoneConsentBody = z.infer<typeof machinePhoneConsentBodySchema>;

export const machinePhoneConsentResponseSchema = z.object({
  ok: z.literal(true),
  consented: z.boolean(),
});
export type MachinePhoneConsentResponse = z.infer<typeof machinePhoneConsentResponseSchema>;

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

export const computerActivitySchema = z.object({
  inUse: z.boolean(),
  title: z.string().nullable(),
  todoId: recordId.nullable(),
  threadId: z.string().nullable(),
  at: epochMs,
});
export type ComputerActivity = z.infer<typeof computerActivitySchema>;

export const computerRecordSchema = z.object({
  id: recordId,
  scopeKey: z.string(),
  state: z.enum(COMPUTER_STATES),
  controlHolder: z.enum(COMPUTER_CONTROL_HOLDERS),
  handoffReason: z.enum(['login', 'model']).nullable(),
  machine: z.object({ id: z.string(), name: z.string(), online: z.boolean() }),
  activity: computerActivitySchema.nullable(),
});
export type ComputerRecord = z.infer<typeof computerRecordSchema>;

export const computerStepSchema = z.object({
  machineId: z.string(),
  callId: z.string(),
  surface: z.enum(['browser', 'desktop', 'app']),
  inFlight: z.boolean(),
  at: epochMs,
  shot: z
    .object({
      callId: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      point: z.object({ x: z.number(), y: z.number() }).nullable(),
    })
    .nullable(),
  shotMissing: z.boolean(),
});
export type ComputerStep = z.infer<typeof computerStepSchema>;

export const OWNER_CHROME_UNAVAILABLE_PREFIX = "Owner's Chrome unavailable: ";

export const COMPUTER_BROWSER_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_act',
] as const;
export type ComputerBrowserTool = (typeof COMPUTER_BROWSER_TOOLS)[number];

export function isComputerBrowserTool(name: string): name is ComputerBrowserTool {
  return (COMPUTER_BROWSER_TOOLS as readonly string[]).includes(name);
}
