import { z } from 'zod';
import { epochMs, recordId } from '../records/common.js';
import { vmDownloadSchema } from '../records/machine-capabilities.js';
import { ownComputerGrantStampSchema } from './own-computer.js';

export const COMPUTER_TOOLS = [
  'shell',
  'list_files',
  'read_file',
  'write_file',
  'attach_file',
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
  'install_packages',
  'computer_manage',
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
  'desktop_snapshot',
  'browser_snapshot',
  'user_computer_observe',
]);

export const DEBIAN_PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/;
export const INSTALL_PACKAGES_MAX = 20;
export const INSTALL_PACKAGES_TIMEOUT_MS = 10 * 60_000;

export const debianPackageNamesSchema = z
  .array(
    z
      .string()
      .max(128, 'a package name is longer than 128 characters')
      .regex(
        DEBIAN_PACKAGE_NAME,
        'each package must be a Debian package name such as ffmpeg or libpq-dev, not a path, URL or option',
      ),
  )
  .min(1, 'name at least one package')
  .max(INSTALL_PACKAGES_MAX, `name at most ${INSTALL_PACKAGES_MAX} packages`)
  .refine((names) => new Set(names).size === names.length, 'a package is named twice');

export const installPackagesParamsSchema = z.strictObject({ packages: debianPackageNamesSchema });
export type InstallPackagesParams = z.infer<typeof installPackagesParamsSchema>;

export const packageInstallDecisionBodySchema = z.strictObject({
  packages: debianPackageNamesSchema,
  decision: z.enum(['approve', 'decline']),
});
export type PackageInstallDecisionBody = z.infer<typeof packageInstallDecisionBodySchema>;

export const COMPUTER_MANAGE_ACTIONS = ['stop', 'update', 'recover', 'reset', 'install'] as const;
export type ComputerManageAction = (typeof COMPUTER_MANAGE_ACTIONS)[number];
export const COMPUTER_MANAGE_OUTCOMES = [
  'stopped',
  'already_stopped',
  'updated',
  'current',
  'recovered',
  'reset',
  'installed',
] as const;
export type ComputerManageOutcome = (typeof COMPUTER_MANAGE_OUTCOMES)[number];
export const COMPUTER_MANAGE_TIMEOUT_MS = 20 * 60_000;

export const computerManageParamsSchema = z.strictObject({
  action: z.enum(COMPUTER_MANAGE_ACTIONS),
});
export type ComputerManageParams = z.infer<typeof computerManageParamsSchema>;
export const computerManageResultSchema = z.strictObject({
  outcome: z.enum(COMPUTER_MANAGE_OUTCOMES),
});
export type ComputerManageResult = z.infer<typeof computerManageResultSchema>;

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
  browserLicense: z.string().min(1).max(4096).optional(),
  computerGrant: z.enum(['browser', 'desktop']).optional(),
  ownComputerGrant: ownComputerGrantStampSchema.optional(),
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
  browserEnabled: z.boolean(),
  handoffReason: z.enum(['login', 'model']).nullable(),
  kind: z.enum(['host', 'vm']),
  download: vmDownloadSchema.nullable(),
  machine: z.object({ id: z.string(), name: z.string(), online: z.boolean() }),
  activity: computerActivitySchema.nullable(),
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
