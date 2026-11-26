import { matchesInOrderWithinSegment, replaceDelimitedSpans } from '../linear-text.js';
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

const PHONE_COMMANDS =
  'adb|afcclient|cfgutil|devicectl|fb-idb|gidevice|idb|idevice\\w*|ifuse|instruments|ios-deploy|iproxy|irecovery|mobiledevice|pymobiledevice3|simctl|tidevice|xcodebuild|xcrun|xctrace';

const SHELL_SEGMENT_BREAK = /[;&|]/;

type CommandCheck = { test(text: string): boolean };

const NO_SEGMENT_BREAK = /(?!)/;

function inOrder(parts: readonly RegExp[]): CommandCheck {
  return matchesInOrderWithinSegment(NO_SEGMENT_BREAK, parts);
}

function inShellSegment(parts: readonly RegExp[]): CommandCheck {
  return matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, parts);
}

function eitherOf(checks: readonly CommandCheck[]): CommandCheck {
  return { test: (text) => checks.some((check) => check.test(text)) };
}

function phoneWord(extra?: string): RegExp {
  const words = extra === undefined ? PHONE_COMMANDS : `${PHONE_COMMANDS}|${extra}`;
  return new RegExp(String.raw`\b(?:${words})\b`, 'i');
}

function afterFirst(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match === null ? null : text.slice(match.index + match[0].length);
}

function osascriptReachesOutside(phoneCommands: string): CommandCheck {
  const scripting =
    /\b(?:do shell script|doShellScript|doScript|do script|includeStandardAdditions|NSTask)\b|\$\s*(?:\.\s*system\b|\[\s*['"]\s*system\b)/i;
  const reach = new RegExp(String.raw`\b(?:${phoneCommands})\b|system attribute|getenv`, 'i');
  return {
    test: (text) =>
      text.split(/[;|]/).some((chunk) => {
        const pieces = chunk.split('&');
        return pieces.some((piece, at) => {
          const rest = afterFirst(piece, /\bosascript\b/i);
          if (rest === null || !scripting.test(rest)) return false;
          return at < pieces.length - 1 || reach.test(rest);
        });
      }),
  };
}

function substitutionAfterAssignment(tail: RegExp): CommandCheck {
  return {
    test(text) {
      let assigned = false;
      let marked = false;
      for (const [part] of text.matchAll(/\s+|[;&|]|[^\s;&|]+/g)) {
        if (/^\s/.test(part)) assigned = false;
        else if (SHELL_SEGMENT_BREAK.test(part)) marked = false;
        else if (marked && tail.test(part)) return true;
        else {
          let rest: string | null = part;
          if (!assigned) {
            rest = afterFirst(part, /\b[A-Za-z_]\w*=/);
            assigned = rest !== null;
          }
          const afterMarker = rest === null || marked ? null : afterFirst(rest, /\$\(|\x60/);
          if (afterMarker === null) continue;
          marked = true;
          if (tail.test(afterMarker)) return true;
        }
      }
      return false;
    },
  };
}

function assignedThenExpanded(command: RegExp): CommandCheck {
  const head = inOrder([/\b\w+=/, command]);
  return {
    test: (text) =>
      text.split(/[&|]/).some((chunk) => {
        const statements = chunk.split(';');
        return statements.some(
          (statement, at) => head.test(statement) && /\$[\w({]/.test(statements[at + 1] ?? ''),
        );
      }),
  };
}

const COMMAND_OPENER = /[;&|({`]/;

function commandStarts(text: string): number[] {
  const words = new Set<number>();
  const sudo = /sudo\s+/iy;
  const flag = /-\S+\s+/y;
  for (let at = 0; at <= text.length; at++) {
    if (at !== 0 && !COMMAND_OPENER.test(text.charAt(at - 1))) continue;
    let word = at;
    while (/\s/.test(text.charAt(word))) word++;
    words.add(word);
    let next = endOfMatchAt(sudo, text, word);
    while (next !== null && !words.has(next)) {
      words.add(next);
      next = endOfMatchAt(flag, text, next);
    }
  }
  const starts: number[] = [];
  let inPath = false;
  for (let at = 0; at <= text.length; at++) {
    const afterDirectory = inPath && text.charAt(at - 1) === '/';
    if (words.has(at) || afterDirectory) starts.push(at);
    if (words.has(at)) inPath = true;
    if (/\s/.test(text.charAt(at))) inPath = false;
  }
  return starts;
}

function endOfMatchAt(sticky: RegExp, text: string, at: number): number | null {
  sticky.lastIndex = at;
  return sticky.test(text) ? sticky.lastIndex : null;
}

function commandNamed(name: string): CommandCheck {
  const sticky = new RegExp(name, 'iy');
  return {
    test: (text) => commandStarts(text).some((at) => endOfMatchAt(sticky, text, at) !== null),
  };
}

function removesProtectedFolder(): CommandCheck {
  const command = /rm\s+/iy;
  const target = new RegExp(String.raw`(?<=\s)${RM_TARGET}(?=$|[\s;&|)])`, 'gi');
  return {
    test(text) {
      for (const at of commandStarts(text)) {
        const operands = endOfMatchAt(command, text, at);
        if (operands === null) continue;
        target.lastIndex = operands;
        return target.test(text);
      }
      return false;
    },
  };
}

function drivesAdb(): CommandCheck {
  const command = /adb\s+/iy;
  const flag = /-\S+\s+/y;
  const operand = /(?!devices\b|version\b|mdns\b|help\b|--help\b|start-server\b|kill-server\b)\S/iy;
  return {
    test(text) {
      const seen = new Set<number>();
      return commandStarts(text).some((at) => {
        let word = endOfMatchAt(command, text, at);
        while (word !== null && !seen.has(word)) {
          seen.add(word);
          if (endOfMatchAt(operand, text, word) !== null) return true;
          word = endOfMatchAt(flag, text, word);
        }
        return false;
      });
    },
  };
}

type NameSuffixes = { earliestBody: number; longer: Map<string, NameSuffixes> };

function definesAndForksItself(body: string): boolean {
  const defined: NameSuffixes = { earliestBody: 0, longer: new Map() };
  for (const header of body.matchAll(/((?<!\w)\w+|:)\s*\(\s*\)\s*\{/g)) {
    const name = header[1] ?? '';
    let node = defined;
    for (let at = name.length - 1; at >= 0; at--) {
      let next = node.longer.get(name.charAt(at));
      if (next === undefined) {
        next = { earliestBody: header.index + header[0].length, longer: new Map() };
        node.longer.set(name.charAt(at), next);
      }
      node = next;
    }
  }
  for (const fork of body.matchAll(/\|(?=\s*(\w+|:)\s*&)/g)) {
    const name = fork[1] ?? '';
    let end = fork.index;
    while (/\s/.test(body.charAt(end - 1))) end--;
    const start = end - name.length;
    if (start < 0 || !body.startsWith(name, start)) continue;
    let node: NameSuffixes | undefined = defined;
    for (let at = name.length - 1; at >= 0 && node !== undefined; at--) {
      node = node.longer.get(name.charAt(at));
    }
    if (node !== undefined && node.earliestBody <= start) return true;
  }
  return false;
}

const FORK_BOMB: CommandCheck = {
  test: (text) => text.split('}').some(definesAndForksItself),
};

const HARDLINE: readonly { pattern: CommandCheck; reason: string }[] = [
  {
    pattern: removesProtectedFolder(),
    reason: 'it deletes the home folder, a system folder or the root of the disk',
  },
  { pattern: /\b(?:mkfs(?:\.\w+)?|newfs_\w+)\b/i, reason: 'it formats a disk' },
  {
    pattern:
      /\bdiskutil\s(?:(?!\bdiskutil\s)[\s\S])*?(?<=\s)(?:erase\w*|zerodisk|randomdisk|secureerase|reformat|partitiondisk|deletecontainer|deletevolume)\b/i,
    reason: 'it erases or repartitions a disk',
  },
  {
    pattern: matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, [
      /\bdd\b/i,
      /\bof=\/dev\/(?!(?:null|zero|stdout|stderr|tty)\b|fd\/)/i,
    ]),
    reason: 'it writes raw bytes to a disk device',
  },
  { pattern: />\s*\/dev\/r?disk\d/i, reason: 'it writes raw bytes to a disk device' },
  {
    pattern: FORK_BOMB,
    reason: 'it is a fork bomb',
  },
  {
    pattern: commandNamed(String.raw`(?:shutdown|reboot|halt|poweroff)\b`),
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: /\b(?:launchctl\s+reboot|systemctl\s+(?:poweroff|reboot|halt))\b/i,
    reason: 'it shuts down or restarts the Mac',
  },
  {
    pattern: matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, [
      /\bcsrutil\b/i,
      /\b(?:disable|clear)\b/i,
    ]),
    reason: 'it turns off System Integrity Protection',
  },
  {
    pattern: drivesAdb(),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, [
      /\bxcrun\b/i,
      /\bdevicectl\b/i,
      /\b(?:install|uninstall|launch|terminate|pair|unpair|erase|reset|manage|copy)\b/i,
    ]),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, [
      /\bxcodebuild\b/i,
      /\b(?:WebDriverAgent|platform=(?:iOS|watchOS|tvOS|visionOS)(?! Simulator)\b)/i,
    ]),
    reason:
      'it drives a phone through WebDriverAgent outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: eitherOf([
      commandNamed(String.raw`simctl\b`),
      inShellSegment([/\bxcrun\b/i, /\bsimctl\b/i]),
    ]),
    reason:
      'it controls a phone simulator outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: commandNamed(
      String.raw`(?:afcclient|cfgutil|devicectl|fb-idb|gidevice|idb|idevice\w*|ifuse|instruments|ios-deploy|iproxy|irecovery|mobiledevice|pymobiledevice3|tidevice|xctrace)\b`,
    ),
    reason:
      'it talks to a phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: osascriptReachesOutside(PHONE_COMMANDS),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: matchesInOrderWithinSegment(/\s/, [
      /\b(?:BASH_ENV|BROWSER|CVSEDITOR|CVS_RSH|DIFFPROG|EDITOR|ENV|GIT_ASKPASS|GIT_CONFIG_\w*|GIT_EDITOR|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_PROXY_COMMAND|GIT_SEQUENCE_EDITOR|GIT_SSH|GIT_SSH_COMMAND|HGEDITOR|LESSCLOSE|LESSOPEN|MANPAGER|MAILER|P4DIFF|P4EDITOR|P4MERGE|PAGER|PROMPT_COMMAND|PS4|RSYNC_RSH|SSH_ASKPASS|SUDO_ASKPASS|SVN_EDITOR|SVN_SSH|SYSTEMD_PAGER|TERMINAL|VISUAL)\+?=/i,
      phoneWord(),
    ]),
    reason:
      'it hides phone control inside an environment variable a program runs as a command; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: inShellSegment([/\bGIT_CONFIG_\w*\+?=/i, phoneWord()]),
    reason:
      'it hides phone control inside git config injected through the environment; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: substitutionAfterAssignment(phoneWord()),
    reason:
      'it hides phone control inside a command substitution the checker cannot resolve; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: inShellSegment([/\btrap\s/i, phoneWord()]),
    reason:
      'it defers phone control to a shell trap outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: inShellSegment([
      /\b(?:test|\[|declare|let|local|mapfile|printf|read|readonly|typeset|unset|export)\b/i,
      /\$\(|\x60/,
      phoneWord(),
    ]),
    reason:
      'it hides phone control inside a shell builtin the checker cannot resolve; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: inShellSegment([/\bhash\b/i, phoneWord('osascript')]),
    reason:
      'it aliases a phone-control binary outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: matchesInOrderWithinSegment(SHELL_SEGMENT_BREAK, [
      /\b(?:pythonw?[\d.]*|uvx?|pipx)\b/i,
      /pymobiledevice3\b/i,
    ]),
    reason:
      'it controls a paired phone outside the phone tools; phone control goes through phone_observe and phone_act',
  },
  {
    pattern: assignedThenExpanded(
      phoneWord('rm|dd|mkfs|diskutil|newfs_\\w+|shutdown|reboot|halt|poweroff|csrutil|launchctl'),
    ),
    reason: 'it hides a gated command behind a variable expansion the checker cannot resolve',
  },
  {
    pattern: inShellSegment([/\balias\s+\w+=/i, phoneWord()]),
    reason:
      'it aliases a phone-control binary outside the phone tools; phone control goes through phone_observe and phone_act',
  },
];

export function ownComputerHardlineRefusal(command: string): string | null {
  const folded = command
    .replace(/["'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const spliced = replaceDelimitedSpans(
    folded.replace(/\$\([^()]*\)/g, '').replace(/`[^`]*`/g, ''),
    { open: /\$\{/, close: () => '}' },
    () => '',
  )
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
export const HOST_SHELL_SANDBOX_BLOCKED_PREFIX = 'blocked by sandbox:';
export const HOST_SHELL_ESCALATION_DENIED = 'denied by owner';

const OWN_MAC_SCOPE =
  "The user's own Mac, not the Coordinator computer desktop. Use it when the work lives on their Mac (their apps, files, projects or signed-in sessions). Every call is logged and shown to the user in the conversation.";

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
    description: `${OWN_MAC_SCOPE} Run one bash command line as the user on their Mac; it runs at once. A short list of destructive commands (erasing disks, deleting the home folder or the disk root, shutting down, turning off System Integrity Protection) is always refused. Ask the user before anything else that cannot be undone. Commands run in a sandbox that blocks credential paths and nested sandboxes; if a command returns "blocked by sandbox", try another approach first and set escalate: true only when no sandboxed alternative can do the job.`,
    parameters: obj(
      {
        command: str('The command line to run with bash -lc.'),
        cwd: str('Optional working folder inside the home folder; defaults to the home folder.'),
        timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
        escalate: {
          type: 'boolean',
          description:
            'Set true only after a sandbox denial when no sandboxed alternative works; asks the owner to approve running this exact command once without the sandbox.',
        },
      },
      ['command'],
    ),
  },
];

export const COORDINATOR_ATTACH_FILE_TOOL: RemoteToolDef = {
  name: 'attach_file',
  description:
    "Attach a file from the user's own computer to your reply (up to 10 MiB; PNG, JPEG, GIF, WebP, PDF, or UTF-8 text/JSON/XML). Pass the file path on the user's computer (for example a PNG exported with user_computer_shell). Credential directories are refused. The attachment is added to your reply automatically; do not repeat the attachment markdown token in your text.",
  parameters: obj(
    {
      path: str("Path to the file on the user's computer."),
      caption: str('Optional caption or display name for the attachment.'),
    },
    ['path'],
  ),
};
