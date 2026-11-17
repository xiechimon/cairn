import { z } from 'zod';
import { recordId } from '../records/common.js';
import type { RemoteToolDef } from './chief-tools.js';

export const AGENT_DESKTOP_VERSION = '1.1.0';
export const AGENT_DESKTOP_HELPER = 'agent-desktop-macos-helper';

export interface AgentDesktopRelease {
  url: string;
  archiveSha256: string;
  binarySha256: string;
}

const RELEASE_BASE = `https://github.com/vercel-labs/agent-desktop/releases/download/v${AGENT_DESKTOP_VERSION}`;

export const AGENT_DESKTOP_RELEASES: Readonly<Record<'arm64' | 'x64', AgentDesktopRelease>> = {
  arm64: {
    url: `${RELEASE_BASE}/agent-desktop-v${AGENT_DESKTOP_VERSION}-aarch64-apple-darwin.tar.gz`,
    archiveSha256: '3048e00aa0741bf25ffe0326f78c966408be4490ce13513f3f94ecf2a0b5270d',
    binarySha256: 'a89c781a3b2cf29bc0467c30a4e1063b6f564858540f2dc58a75c79ce2c9d9f3',
  },
  x64: {
    url: `${RELEASE_BASE}/agent-desktop-v${AGENT_DESKTOP_VERSION}-x86_64-apple-darwin.tar.gz`,
    archiveSha256: 'b6352ac66aa49e0280c6f690de791dc03c827623a838950856b20ddbebcdc382',
    binarySha256: 'bfbb387446e615687dfe345158f7ac1e37197f5de203fa36bb621e474e016d77',
  },
};

export function agentDesktopRelease(arch: string): AgentDesktopRelease | null {
  return arch === 'arm64' || arch === 'x64' ? AGENT_DESKTOP_RELEASES[arch] : null;
}

export const OWN_COMPUTER_APP_ACTION = 'user_computer.app';
export const OWN_COMPUTER_SHELL_ACTION = 'user_computer.shell';
export const OWN_COMPUTER_ACTIONS: readonly string[] = [
  OWN_COMPUTER_APP_ACTION,
  OWN_COMPUTER_SHELL_ACTION,
];

export const OWN_COMPUTER_ALLOW_ONCE = '允许一次';
export const OWN_COMPUTER_ALLOW_CONVERSATION = '在本对话中允许';
export const OWN_COMPUTER_ALLOW_COMMAND = '总是允许这条命令';
export const OWN_COMPUTER_DENY = '拒绝';

export const OWN_COMPUTER_NEVER_DRIVEN: readonly string[] = [
  'cairn',
  'electron',
  'system settings',
  'system preferences',
];

export function ownComputerAppKey(app: string): string {
  return app.trim().toLowerCase();
}

export function ownComputerGrantKey(
  tool: 'user_computer_shell' | 'user_computer_observe' | 'user_computer_act',
  params: Record<string, unknown>,
): string | null {
  const value = tool === 'user_computer_shell' ? params.command : params.app;
  if (typeof value !== 'string') return null;
  const key = tool === 'user_computer_shell' ? value : ownComputerAppKey(value);
  return key === '' ? null : key;
}

export const ownComputerGrantStampSchema = z.strictObject({
  proposalId: recordId,
  key: z.string().min(1).max(100_000),
});
export type OwnComputerGrantStamp = z.infer<typeof ownComputerGrantStampSchema>;

export const ownComputerGrantSchema = z.object({
  proposalId: recordId,
  kind: z.enum(['app', 'shell']),
  key: z.string(),
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  decidedAt: z.number().int(),
});
export type OwnComputerGrant = z.infer<typeof ownComputerGrantSchema>;

export const ownComputerGrantsResponseSchema = z.object({
  grants: z.array(ownComputerGrantSchema),
});
export type OwnComputerGrantsResponse = z.infer<typeof ownComputerGrantsResponseSchema>;

export type OwnComputerInstallFailure = 'network' | 'checksum' | 'archive' | 'version' | 'disk';
export type OwnComputerInstallResult =
  | { ok: true; binary: string }
  | { ok: false; reason: OwnComputerInstallFailure | 'unsupported' };

export const OWN_COMPUTER_NOT_ON =
  'The owner has not turned on "Let the agent use this Mac" in Settings, Computers. Nothing ran.';
export const OWN_COMPUTER_NOT_OWNER_TURN =
  "Only conversations the owner starts can use the owner's Mac. Nothing ran.";
export const OWN_COMPUTER_NO_ACCESSIBILITY = (mac: string) =>
  `Cairn lacks the macOS Accessibility permission on ${mac}; the owner grants it in Settings, Computers. Nothing ran.`;
export const OWN_COMPUTER_NOT_INSTALLED = (mac: string) =>
  `agent-desktop is not installed on ${mac}; the owner finishes setup in Settings, Computers. Nothing ran.`;
export const OWN_COMPUTER_NO_SHELL = (mac: string) =>
  `${mac} does not offer a host shell. Nothing ran.`;
export const OWN_COMPUTER_NEVER_DRIVEN_TEXT = (app: string) =>
  `${app} is never driven: the agent does not use Cairn or change its own permissions. Nothing ran.`;
export const OWN_COMPUTER_DENIED = (what: string) =>
  `The owner denied ${what}; do not retry it in this conversation. Nothing ran.`;
export const OWN_COMPUTER_NO_ANSWER = (what: string) =>
  `The owner did not answer the request to use ${what}. Nothing ran. Stop and tell the owner.`;

const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const OWN_MAC_SCOPE =
  "The owner's own Mac, not your VM computer. Use it only when the owner asks for something that lives on their Mac (their apps, files or signed-in sessions); use the VM computer by default and never use the Mac to reach a website the VM browser can open.";

export const OWN_COMPUTER_TOOLS: readonly RemoteToolDef[] = [
  {
    name: 'user_computer_observe',
    description: `${OWN_MAC_SCOPE} Read one app's front window as numbered accessibility elements, with a screenshot when the owner granted Screen Recording. The first use of an app in a conversation asks the owner in chat and waits for the answer.`,
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
    description: `${OWN_MAC_SCOPE} Act on one app with element numbers from the latest user_computer_observe of that app, then return a fresh observation. Each new app asks the owner first.`,
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
    description: `${OWN_MAC_SCOPE} Run one shell command as the owner in the Runner's own folder on their Mac. Every command asks the owner first unless they always allowed that exact command line.`,
    parameters: obj(
      {
        command: str('The exact command line to run.'),
        timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      },
      ['command'],
    ),
  },
];
