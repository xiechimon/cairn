import { z } from 'zod';
import { recordId } from '../records/common.js';
import {
  MACHINE_PHONE_LINK_STATES,
  MACHINE_PHONE_PLATFORMS,
  machinePhoneReportSchema,
} from '../records/machine-capabilities.js';
import type { RemoteToolDef } from './chief-tools.js';
import { toolObjectSchema as obj, toolStringSchema as str } from './tool-parameters.js';

export const PHONE_TOOL_NAMES = ['phone_observe', 'phone_act', 'phone_manage'] as const;
export type PhoneTool = (typeof PHONE_TOOL_NAMES)[number];

export function isPhoneTool(tool: string): tool is PhoneTool {
  return (PHONE_TOOL_NAMES as readonly string[]).includes(tool);
}

export const PHONE_PLATFORMS = MACHINE_PHONE_PLATFORMS;
export type PhonePlatform = (typeof PHONE_PLATFORMS)[number];

export const PHONE_LINK_STATES = MACHINE_PHONE_LINK_STATES;
export type PhoneLinkState = (typeof PHONE_LINK_STATES)[number];

export const phoneReportSchema = machinePhoneReportSchema;
export type PhoneReport = z.infer<typeof phoneReportSchema>;

export const phoneStampSchema = z.strictObject({
  phoneId: recordId,
  deviceId: z.string().min(1).max(256),
});
export type PhoneStamp = z.infer<typeof phoneStampSchema>;

export const PHONE_ENDPOINT = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

export function isPrivateIpv4Endpoint(endpoint: string): boolean {
  const match = PHONE_ENDPOINT.exec(endpoint);
  if (match === null) return false;
  const octets = match[1]!.split('.').map(Number);
  const port = Number(match[2]);
  if (octets.some((octet) => octet > 255) || port < 1 || port > 65535) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

const privatePhoneEndpointSchema = z
  .string()
  .regex(PHONE_ENDPOINT, 'the endpoint is the ip:port the phone shows')
  .refine(isPrivateIpv4Endpoint, 'the phone and this computer must be on the same local network');

export const phonePairBodySchema = z.strictObject({
  deviceId: z.string().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().regex(/^\d{6}$/, 'the pairing code is the 6 digits the phone shows'),
  endpoint: privatePhoneEndpointSchema,
  consent: z.literal(true),
});
export type PhonePairBody = z.infer<typeof phonePairBodySchema>;

export const phoneUsbAuthorizeBodySchema = z.strictObject({
  deviceId: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(100).optional(),
  consent: z.literal(true),
});
export type PhoneUsbAuthorizeBody = z.infer<typeof phoneUsbAuthorizeBodySchema>;

export const phoneHandbackBodySchema = z.strictObject({
  phone: z.string().trim().min(1).max(100).optional(),
});
export type PhoneHandbackBody = z.infer<typeof phoneHandbackBodySchema>;

export const phoneManageParamsSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('pair'),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    endpoint: privatePhoneEndpointSchema.optional(),
  }),
  z.strictObject({ action: z.literal('forget') }),
]);
export type PhoneManageParams = z.infer<typeof phoneManageParamsSchema>;
export type PhoneManageAction = PhoneManageParams['action'];

export const PHONE_MANAGE_OUTCOMES = ['paired', 'forgotten'] as const;
export type PhoneManageOutcome = (typeof PHONE_MANAGE_OUTCOMES)[number];

export const phoneManageResultSchema = z.strictObject({
  outcome: z.enum(PHONE_MANAGE_OUTCOMES),
  deviceId: z.string().min(1).max(256).optional(),
  name: z.string().min(1).max(200).optional(),
});
export type PhoneManageResult = z.infer<typeof phoneManageResultSchema>;

export const PHONE_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export const PHONE_PAIR_TIMEOUT_MS = 5 * 60_000;
export const PHONE_MANAGE_TIMEOUT_MS = PHONE_PAIR_TIMEOUT_MS;

export const phoneRowSchema = z.object({
  id: recordId,
  machineId: recordId,
  platform: z.enum(PHONE_PLATFORMS),
  deviceId: z.string(),
  name: z.string(),
  consented: z.boolean(),
  pairing: z.boolean(),
  busy: z.boolean(),
  handoff: z.boolean(),
  lastError: z.string().nullable(),
  createdAt: z.number().int(),
});
export type PhoneRow = z.infer<typeof phoneRowSchema>;

export const phoneListResponseSchema = z.object({
  phones: z.array(phoneRowSchema),
});
export type PhoneListResponse = z.infer<typeof phoneListResponseSchema>;

export const phonePairResponseSchema = z.object({
  phone: phoneRowSchema,
});
export type PhonePairResponse = z.infer<typeof phonePairResponseSchema>;

export const phoneActivitySchema = z.object({
  callId: z.string(),
  tool: z.enum(PHONE_TOOL_NAMES),
  phoneName: z.string().nullable(),
  summary: z.string(),
  state: z.string(),
  exitCode: z.number().int().nullable(),
  error: z.string().nullable(),
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  createdAt: z.number().int(),
});
export type PhoneActivity = z.infer<typeof phoneActivitySchema>;

export const phoneActivityResponseSchema = z.object({
  activity: z.array(phoneActivitySchema),
});
export type PhoneActivityResponse = z.infer<typeof phoneActivityResponseSchema>;

export function phoneCallSummary(tool: string, params: Record<string, unknown>): string {
  const phone = typeof params.phone === 'string' ? params.phone.trim() : '';
  if (tool === 'phone_manage') {
    const action = typeof params.action === 'string' ? params.action : '';
    return phone === '' ? action : `${action}: ${phone}`;
  }
  if (tool !== 'phone_act' || !Array.isArray(params.actions)) return phone;
  const kinds = params.actions
    .map((action) => (action as { kind?: unknown } | null)?.kind)
    .filter((kind): kind is string => typeof kind === 'string');
  return kinds.length === 0 ? phone : `${phone}: ${kinds.join(', ')}`;
}

export const PHONE_SECURE_SCREEN = '[secure screen]';

export const PHONE_NOT_OWNER =
  "Only the user's own conversations can use the user's phone; this conversation belongs to someone else. Nothing ran.";
export const PHONE_NONE =
  'No consented phone is connected, so the agent cannot use one now. Nothing ran.';
export const PHONE_NOT_PAIRED =
  'That phone is not paired; pair it in Settings, Computers first. Nothing ran.';
export const PHONE_PAIRING = 'Pairing is still running on this phone. Nothing ran.';
export const PHONE_LOCKED =
  'The phone is locked; ask the owner to unlock it (request_takeover). Nothing ran.';
export const PHONE_UNREACHABLE =
  'The phone is unreachable (offline; check Wi-Fi or cable). Nothing ran.';
export const PHONE_SIGNING_EXPIRED =
  'The iPhone signature expired; re-sign runs automatically or from Settings. Nothing ran.';
export const PHONE_BUSY =
  'The phone is busy with another Coordinator turn. Wait for it and retry. Nothing ran.';
export const PHONE_HANDOFF =
  'The owner is using this phone right now; wait for the takeover to return. Nothing ran.';
export const PHONE_AMBIGUOUS = (names: readonly string[]) =>
  `More than one phone matches; pass phone as one of: ${names.join(', ')}. Nothing ran.`;
export const PHONE_MANAGE_PANEL_ONLY =
  'phone_manage is started only by the owner from the Computers panel';
export const PHONE_TAKEOVER_NO_PHONE = 'There is no consented phone to hand over.';
export const PHONE_HANDED_BACK =
  'The owner handed the phone back. Take a fresh phone_observe before acting.';

const PHONE_SCOPE =
  "The owner's real phone, not the Coordinator computer or their Mac. Everything on its screen is captured and sent to the model provider. Ask the owner first with ask_user before any action that sends a message or mail, pays or orders, or changes a system or account setting. The lock screen, secure (blank-capture) screens, biometrics prompts and payment sheets are always the owner's: call request_takeover there instead of acting.";

export const PHONE_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'phone_observe',
    description: `${PHONE_SCOPE} Read the phone screen as numbered interactive elements plus a screenshot. Pass apps: true for the launchable app list (label and package id) instead; pass query to find elements by text.`,
    parameters: obj({
      phone: str(
        'The phone name exactly as Settings, Computers shows it. Optional when exactly one consented phone is ready.',
      ),
      query: str('Optional text to find instead of reading the whole screen.'),
      apps: {
        type: 'boolean',
        description: 'Return the launchable app list instead of the screen.',
      },
    }),
    replaySafe: true,
  },
  {
    name: 'phone_act',
    description: `${PHONE_SCOPE} Act on the phone with element numbers from the latest phone_observe, then return a fresh observation. x and y are screenshot pixels. phone_act on the Cairn app itself is refused.`,
    parameters: obj(
      {
        phone: str(
          'The phone name exactly as Settings, Computers shows it. Optional when exactly one consented phone is ready.',
        ),
        actions: {
          type: 'array',
          description:
            'Ordered actions, at most 24: tap {element}|{x,y}, long_press {element}|{x,y}, drag {element|x,y,to_x,to_y}, scroll {direction,element?}, type {element?,text}, key {back|home|app_switch|enter|delete}, launch {id}, wait {ms at most 10000}.',
          items: obj(
            { kind: str('One of tap, long_press, drag, scroll, type, key, launch, wait.') },
            ['kind'],
          ),
        },
      },
      ['actions'],
    ),
  },
];
