import { z } from 'zod';
import type { RemoteToolDef } from './chief-tools.js';

export const OWN_COMPUTER_TOOL_NAMES = [
  'user_computer_shell',
  'user_computer_observe',
  'user_computer_act',
] as const;
export type OwnComputerTool = (typeof OWN_COMPUTER_TOOL_NAMES)[number];

export function isOwnComputerTool(tool: string): tool is OwnComputerTool {
  return (OWN_COMPUTER_TOOL_NAMES as readonly string[]).includes(tool);
}

const RM_TARGET = String.raw`(?:\/|\/\*|~|~\/|~\/\*|\$HOME|\$HOME\/|\$HOME\/\*|\$\{HOME\}|\$\{HOME\}\/|\$\{HOME\}\/\*|\/Users|\/Users\/|\/Users\/\*|\/Users\/[^\/\s;&|]+\/?\*?|\/System|\/System\/|\/Library|\/Library\/|\/Applications\/?)`;
const COMMAND_START = String.raw`(?:^|[;&|({\x60]|\$\()\s*(?:sudo\s+(?:-\S+\s+)*)?(?:\S*\/)?`;

const HARDLINE: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: new RegExp(
      String.raw`${COMMAND_START}rm\s+(?:\S+\s+)*?(?:--\s+)?${RM_TARGET}(?=$|[\s;&|)])`,
    ),
    reason: 'it deletes the home folder, a system folder or the root of the disk',
  },
  { pattern: /\b(?:mkfs(?:\.\w+)?|newfs_\w+)\b/, reason: 'it formats a disk' },
  {
    pattern:
      /\bdiskutil\s+(?:\S+\s+)*?(?:erase\w*|zerodisk|randomdisk|secureerase|reformat|partitiondisk|deletecontainer|deletevolume)\b/i,
    reason: 'it erases or repartitions a disk',
  },
  {
    pattern: /\bdd\b[^;&|]*\bof=\/dev\/(?!(?:null|zero|stdout|stderr|tty)\b|fd\/)/,
    reason: 'it writes raw bytes to a disk device',
  },
  { pattern: />\s*\/dev\/r?disk\d/, reason: 'it writes raw bytes to a disk device' },
  {
    pattern: /(\w+|:)\s*\(\s*\)\s*\{[^}]*\1\s*\|\s*\1\s*&/,
    reason: 'it is a fork bomb',
  },
  {
    pattern: new RegExp(String.raw`${COMMAND_START}(?:shutdown|reboot|halt|poweroff)\b`),
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: /\b(?:launchctl\s+reboot|systemctl\s+(?:poweroff|reboot|halt))\b/,
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: /\bcsrutil\b[^;&|]*\b(?:disable|clear)\b/,
    reason: 'it turns off System Integrity Protection',
  },
];

export function ownComputerHardlineRefusal(command: string): string | null {
  const folded = command
    .replace(/["'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hit = HARDLINE.find((rule) => rule.pattern.test(folded));
  return hit === undefined
    ? null
    : `This command was not run because ${hit.reason}. The agent never runs it on the user's Mac; if the user really wants it, they run it themselves in Terminal.`;
}

export const ownComputerActivitySchema = z.object({
  callId: z.string(),
  tool: z.enum(OWN_COMPUTER_TOOL_NAMES),
  summary: z.string(),
  state: z.string(),
  exitCode: z.number().int().nullable(),
  error: z.string().nullable(),
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  createdAt: z.number().int(),
});
export type OwnComputerActivity = z.infer<typeof ownComputerActivitySchema>;

export const ownComputerActivityResponseSchema = z.object({
  activity: z.array(ownComputerActivitySchema),
});

export function ownComputerCallSummary(tool: string, params: Record<string, unknown>): string {
  if (tool === 'user_computer_shell')
    return typeof params.command === 'string' ? params.command : '';
  const app = typeof params.app === 'string' ? params.app.trim() : '';
  if (tool !== 'user_computer_act' || !Array.isArray(params.actions)) return app;
  const kinds = params.actions
    .map((action) => (action as { kind?: unknown } | null)?.kind)
    .filter((kind): kind is string => typeof kind === 'string');
  return kinds.length === 0 ? app : `${app}: ${kinds.join(', ')}`;
}

export const OWN_COMPUTER_NOT_OWNER =
  "Only the user's own conversations can use the user's Mac; this conversation belongs to someone else. Nothing ran.";
export const OWN_COMPUTER_NO_MAC =
  'No Mac with the Cairn app is connected, so the agent cannot use one now. Nothing ran.';
export const OWN_COMPUTER_NO_ACCESSIBILITY = (mac: string) =>
  `Cairn lacks the macOS Accessibility permission on ${mac}; the user grants it in Settings, Computers. Nothing ran.`;

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const OWN_MAC_SCOPE =
  "The user's own Mac, not your VM computer. Use it when the work lives on their Mac (their apps, files, projects or signed-in sessions); use the VM computer for websites the VM browser can open. Every call is logged and shown to the user in the conversation.";

export const OWN_COMPUTER_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'user_computer_observe',
    description: `${OWN_MAC_SCOPE} Read one app's front window as numbered accessibility elements, with a screenshot when the user granted Screen Recording.`,
    parameters: obj(
      {
        app: str('The app name exactly as macOS shows it, for example Finder or Notes.'),
        query: str('Optional text to find instead of reading the whole window.'),
      },
      ['app'],
    ),
    replaySafe: true,
  },
  {
    name: 'user_computer_act',
    description: `${OWN_MAC_SCOPE} Act on one app with element numbers from the latest user_computer_observe of that app, then return a fresh observation. Ask the user before an action that cannot be undone or that reaches other people.`,
    parameters: obj(
      {
        app: str('The app name exactly as macOS shows it.'),
        actions: {
          type: 'array',
          description:
            'Ordered actions, at most 24: click {element}, type {element,text}, set {element,value}, key {key,modifiers}, scroll {direction,amount,element}, menu {path}, wait {ms}.',
          items: obj({ kind: str('One of click, type, set, key, scroll, menu, wait.') }, ['kind']),
        },
      },
      ['app', 'actions'],
    ),
  },
  {
    name: 'user_computer_shell',
    description: `${OWN_MAC_SCOPE} Run one bash command line as the user on their Mac; it runs at once. A short list of destructive commands (erasing disks, deleting the home folder or the disk root, shutting down, turning off System Integrity Protection) is always refused. Ask the user before anything else that cannot be undone.`,
    parameters: obj(
      {
        command: str('The command line to run with bash -lc.'),
        cwd: str('Optional working folder inside the home folder; defaults to the home folder.'),
        timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      },
      ['command'],
    ),
  },
];
