import type { RemoteToolDef } from './chief-tools.js';
import { toolObjectSchema as obj, toolStringSchema as str } from './tool-parameters.js';

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

const PHONE_COMMANDS =
  'adb|afcclient|cfgutil|devicectl|fb-idb|gidevice|idb|idevice\\w*|ifuse|instruments|ios-deploy|iproxy|irecovery|mobiledevice|pymobiledevice3|simctl|tidevice|xcodebuild|xcrun|xctrace';

const HARDLINE: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: new RegExp(
      String.raw`${COMMAND_START}rm\s+(?:\S+\s+)*?(?:--\s+)?${RM_TARGET}(?=$|[\s;&|)])`,
      'i',
    ),
    reason: 'it deletes the home folder, a system folder or the root of the disk',
  },
  { pattern: /\b(?:mkfs(?:\.\w+)?|newfs_\w+)\b/i, reason: 'it formats a disk' },
  {
    pattern:
      /\bdiskutil\s+(?:\S+\s+)*?(?:erase\w*|zerodisk|randomdisk|secureerase|reformat|partitiondisk|deletecontainer|deletevolume)\b/i,
    reason: 'it erases or repartitions a disk',
  },
  {
    pattern: /\bdd\b[^;&|]*\bof=\/dev\/(?!(?:null|zero|stdout|stderr|tty)\b|fd\/)/i,
    reason: 'it writes raw bytes to a disk device',
  },
  { pattern: />\s*\/dev\/r?disk\d/i, reason: 'it writes raw bytes to a disk device' },
  {
    pattern: /(\w+|:)\s*\(\s*\)\s*\{[^}]*\1\s*\|\s*\1\s*&/,
    reason: 'it is a fork bomb',
  },
  {
    pattern: new RegExp(String.raw`${COMMAND_START}(?:shutdown|reboot|halt|poweroff)\b`, 'i'),
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: /\b(?:launchctl\s+reboot|systemctl\s+(?:poweroff|reboot|halt))\b/i,
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: /\bcsrutil\b[^;&|]*\b(?:disable|clear)\b/i,
    reason: 'it turns off System Integrity Protection',
  },
  {
    pattern: new RegExp(
      String.raw`${COMMAND_START}adb\s+(?:-\S+\s+)*(?!devices\b|version\b|mdns\b|help\b|--help\b|start-server\b|kill-server\b)\S`,
      'i',
    ),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern:
      /\bxcrun\b[^;&|]*\bdevicectl\b[^;&|]*\b(?:install|uninstall|launch|terminate|pair|unpair|erase|reset|manage|copy)\b/i,
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern:
      /\bxcodebuild\b[^;&|]*\b(?:WebDriverAgent|platform=(?:iOS|watchOS|tvOS|visionOS)(?! Simulator)\b)/i,
    reason:
      'it drives a phone through WebDriverAgent outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(String.raw`(?:${COMMAND_START}simctl|\bxcrun\b[^;&|]*\bsimctl)\b`, 'i'),
    reason:
      'it controls a phone simulator outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`${COMMAND_START}(?:afcclient|cfgutil|devicectl|fb-idb|gidevice|idb|idevice\w*|ifuse|instruments|ios-deploy|iproxy|irecovery|mobiledevice|pymobiledevice3|tidevice|xctrace)\b`,
      'i',
    ),
    reason:
      'it talks to a phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`\bosascript\b(?=[^;&|]*(?:\b(?:do shell script|doShellScript|doScript|do script|includeStandardAdditions|NSTask)\b|\$\s*(?:\.\s*system\b|\[\s*['"]\s*system\b)))(?=[^;|]*(?:\b(?:${PHONE_COMMANDS})\b|&|system attribute|getenv))`,
      'i',
    ),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:BASH_ENV|BROWSER|CVSEDITOR|CVS_RSH|DIFFPROG|EDITOR|ENV|GIT_ASKPASS|GIT_CONFIG_\w*|GIT_EDITOR|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_PROXY_COMMAND|GIT_SEQUENCE_EDITOR|GIT_SSH|GIT_SSH_COMMAND|HGEDITOR|LESSCLOSE|LESSOPEN|MANPAGER|MAILER|P4DIFF|P4EDITOR|P4MERGE|PAGER|PROMPT_COMMAND|PS4|RSYNC_RSH|SSH_ASKPASS|SUDO_ASKPASS|SVN_EDITOR|SVN_SSH|SYSTEMD_PAGER|TERMINAL|VISUAL)\+?=\S*\b(?:${PHONE_COMMANDS})\b`,
      'i',
    ),
    reason:
      'it hides phone control inside an environment variable a program runs as a command; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(String.raw`\bGIT_CONFIG_\w*\+?=[^;&|]*\b(?:${PHONE_COMMANDS})\b`, 'i'),
    reason:
      'it hides phone control inside git config injected through the environment; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`\b[A-Za-z_]\w*=\S*(?:\$\(|\x60)[^;&|]*\b(?:${PHONE_COMMANDS})\b`,
      'i',
    ),
    reason:
      'it hides phone control inside a command substitution the checker cannot resolve; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(String.raw`\btrap\s+[^;&|]*\b(?:${PHONE_COMMANDS})\b`, 'i'),
    reason:
      'it defers phone control to a shell trap outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`\b(?:test|\[|declare|let|local|mapfile|printf|read|readonly|typeset|unset|export)\b[^;&|]*(?:\$\(|\x60)[^;&|]*\b(?:${PHONE_COMMANDS})\b`,
      'i',
    ),
    reason:
      'it hides phone control inside a shell builtin the checker cannot resolve; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(String.raw`\bhash\b[^;&|]*\b(?:${PHONE_COMMANDS}|osascript)\b`, 'i'),
    reason:
      'it aliases a phone-control binary outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: /\b(?:pythonw?[\d.]*|uvx?|pipx)\b[^;&|]*pymobiledevice3\b/i,
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: new RegExp(
      String.raw`\b\w+=["']?[^;&|]*\b(?:${PHONE_COMMANDS}|rm|dd|mkfs|diskutil|newfs_\w+|shutdown|reboot|halt|poweroff|csrutil|launchctl)\b[^;&|]*;[^;&|]*\$[\w({]`,
      'i',
    ),
    reason: 'it hides a gated command behind a variable expansion the checker cannot resolve',
  },
  {
    pattern: new RegExp(String.raw`\balias\s+\w+=["']?[^;&|]*\b(?:${PHONE_COMMANDS})\b`, 'i'),
    reason:
      'it aliases a phone-control binary outside the phone tools; phone control goes through phone_observe and phone_act',
  },
];

export function ownComputerHardlineRefusal(command: string): string | null {
  const folded = command
    .replace(/["'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const spliced = folded
    .replace(/\$\([^()]*\)/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\$[A-Za-z0-9_]+/g, '')
    .replace(/\$[^\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const hit = HARDLINE.find(
    (rule) => rule.pattern.test(folded) || (spliced !== folded && rule.pattern.test(spliced)),
  );
  return hit === undefined
    ? null
    : `This command was not run because ${hit.reason}. The agent never runs it on the user's Mac; if the user really wants it, they run it themselves in Terminal.`;
}

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
