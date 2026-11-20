import { matchPermissionRule, type PermissionAction, type PermissionRule } from '@cairn/shared';
import {
  isToolCallEventType,
  type ToolCallEvent,
  type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import {
  parseShellWords,
  preserveShellCommandBoundaries,
  type ShellParseEntry,
} from '../computer/guard-shell-parse.js';

export type { PermissionRule };

export interface GateDecision {
  action: PermissionAction;
  ruleId?: string;
}

export interface BashGatePattern {
  id: string;
  action: PermissionAction;
  description: string;
  scope: 'command' | 'segment';
  test: (text: string, segment: BashSegment) => boolean;
}

export interface BashSegment {
  head: string;
  args: string[];
  text: string;
}

function hasRecursiveFlag(args: string[]): boolean {
  return args.some(
    (t) =>
      t === '--recursive' ||
      (t.startsWith('-') && t !== '-' && !t.startsWith('--') && /[rR]/.test(t.slice(1))),
  );
}

function effectiveDdOutput(args: readonly string[]): string | undefined {
  let output: string | undefined;
  for (const arg of args) {
    if (arg.startsWith('of=')) output = arg.slice(3);
  }
  return output;
}

function rmOperands(args: string[]): string[] {
  const out: string[] = [];
  let restAreOperands = false;
  for (const t of args) {
    if (restAreOperands) {
      out.push(t);
      continue;
    }
    if (t === '--') {
      restAreOperands = true;
      continue;
    }
    if (t.startsWith('-') && t !== '-') continue;
    out.push(t);
  }
  return out;
}

const ADB_SAFE_SUBCOMMANDS = new Set([
  'devices',
  'version',
  'mdns',
  'help',
  '--help',
  'start-server',
  'kill-server',
]);
const IOS_BRIDGE_HEADS = new Set([
  'afcclient',
  'cfgutil',
  'devicectl',
  'fb-idb',
  'gidevice',
  'idb',
  'ifuse',
  'instruments',
  'ios-deploy',
  'iproxy',
  'irecovery',
  'mobiledevice',
  'pymobiledevice3',
  'simctl',
  'tidevice',
  'xctrace',
]);
const IOS_BRIDGE_MODULE = /^(?:pythonw?[\d.]*|uv|uvx|pipx)$/;
const PHONE_WORD =
  /\b(?:adb|afcclient|cfgutil|devicectl|fb-idb|gidevice|idb|idevice\w*|ifuse|instruments|ios-deploy|iproxy|irecovery|mobiledevice|pymobiledevice3|simctl|tidevice|xcodebuild|xcrun|xctrace)\b/i;
const PHONE_SHELL_SCRIPT =
  /\b(?:do shell script|doShellScript|doScript|do script|includeStandardAdditions|NSTask)\b|\$\s*(?:\.\s*system\b|\[\s*['"]\s*system\b)/i;
const PHONE_SCRIPT_DYNAMIC = /&|system attribute|getenv|contents of|\$\s*[.[]/i;
const COMMAND_OPERAND_HEADS = new Set([
  'arch',
  'at',
  'automator',
  'batch',
  'caffeinate',
  'crontab',
  'exec',
  'launchctl',
  'screen',
  'script',
  'socat',
  'ssh',
  'su',
  'tmux',
  'xargs',
]);
const ARITH_EVAL_HEADS = new Set([
  '[',
  '[[',
  'declare',
  'export',
  'let',
  'local',
  'mapfile',
  'printf',
  'read',
  'readonly',
  'test',
  'typeset',
  'unset',
]);
const COMMAND_VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  git: ['-c', '--exec-path'],
  rsync: ['-e', '--rsh', '--rsync-path'],
  scp: ['-S'],
  sftp: ['-S'],
  ssh: ['-o'],
  tar: [
    '--checkpoint-action',
    '--to-command',
    '-I',
    '--use-compress-program',
    '-F',
    '--info-script',
    '--new-volume-script',
  ],
};
const RUNNER_ENV_NAMES = new Set([
  'BASH_ENV',
  'BROWSER',
  'CVSEDITOR',
  'CVS_RSH',
  'DIFFPROG',
  'EDITOR',
  'ENV',
  'GIT_ASKPASS',
  'GIT_EDITOR',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'HGEDITOR',
  'LESSCLOSE',
  'LESSOPEN',
  'MANPAGER',
  'MAILER',
  'P4DIFF',
  'P4EDITOR',
  'P4MERGE',
  'PAGER',
  'PROMPT_COMMAND',
  'PS4',
  'RSYNC_RSH',
  'SSH_ASKPASS',
  'SUDO_ASKPASS',
  'SVN_EDITOR',
  'SVN_SSH',
  'SYSTEMD_PAGER',
  'TERMINAL',
  'VISUAL',
]);
const RUNNER_ENV_PREFIX = /^GIT_CONFIG_/;
function runnerEnvName(name: string): boolean {
  return RUNNER_ENV_NAMES.has(name) || RUNNER_ENV_PREFIX.test(name);
}
function payloadScript(value: string): string {
  let s = value;
  while (/^[!A-Za-z0-9_.-]+=/.test(s)) s = s.slice(s.indexOf('=') + 1);
  while (s.startsWith('!')) s = s.slice(1);
  return s;
}
function noteRunnerEnv(name: string, value: string, collected: CollectedCommands): void {
  if (RUNNER_ENV_PREFIX.test(name)) {
    for (const token of value.split(/\s+/)) {
      const s = payloadScript(token);
      if (s !== '') collected.scripts.push(s);
    }
    return;
  }
  collected.scripts.push(value);
}
const PHONE_ALIAS = /\balias\s+\w+=/i;
const POWER_HEADS = new Set(['shutdown', 'reboot', 'halt', 'poweroff']);
const ADB_VALUE_FLAGS = new Set(['-s', '-H', '-P', '-L', '-t']);
function adbSubcommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (ADB_VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

export const DEFAULT_BASH_PATTERNS: readonly BashGatePattern[] = [
  {
    id: 'reject-forkbomb',
    action: 'reject',
    description: 'fork 炸弹（匿名函数自管道：恒无合法用途，直接拒）',
    scope: 'command',
    test: (text) => text.includes(':()') && text.includes('&') && text.includes('{'),
  },
  {
    id: 'ask-rm-rf-root',
    action: 'ask',
    description: '递归删且目标为系统根（/、/*）或显式关掉 --preserve-root',
    scope: 'segment',
    test: (_text, s) =>
      s.head === 'rm' &&
      hasRecursiveFlag(s.args) &&
      (s.args.includes('--no-preserve-root') ||
        rmOperands(s.args).some((op) => op === '/' || op === '/*')),
  },
  {
    id: 'ask-rm-rf-home',
    action: 'ask',
    description: '递归删且目标为用户家目录（~、$HOME、/root）',
    scope: 'segment',
    test: (_text, s) =>
      s.head === 'rm' &&
      hasRecursiveFlag(s.args) &&
      rmOperands(s.args).some(
        (op) =>
          op === '~' ||
          op === '~/' ||
          op === '$HOME' ||
          op === '/root' ||
          op === '/root/' ||
          op.startsWith('$HOME/') ||
          op.startsWith('/root/'),
      ),
  },
  {
    id: 'ask-mkfs',
    action: 'ask',
    description: '文件系统格式化（恒无合法 agent 用途）',
    scope: 'segment',
    test: (_text, s) => s.head === 'mkfs' || s.head.startsWith('mkfs.'),
  },
  {
    id: 'ask-dd-disk',
    action: 'ask',
    description: 'dd 直写块设备（of=/dev/…；of=/dev/null 是空洞放行）',
    scope: 'segment',
    test: (_text, s) => {
      if (s.head !== 'dd') return false;
      const output = effectiveDdOutput(s.args);
      if (output === undefined || output === '/dev/null') return false;
      return output.startsWith('/dev/');
    },
  },
  {
    id: 'ask-power',
    action: 'ask',
    description: '关机/重启（执行机是共享/远端资产，停机不可逆）',
    scope: 'segment',
    test: (_text, s) => POWER_HEADS.has(s.head),
  },
  {
    id: 'ask-phone-control',
    action: 'ask',
    description:
      '真机/模拟器控制（adb 写子命令、devicectl、WebDriverAgent、idevice 系；可能触达机主真机）',
    scope: 'segment',
    test: (_text, s) => {
      if (s.head === 'adb') {
        const sub = adbSubcommand(s.args);
        return sub === undefined || !ADB_SAFE_SUBCOMMANDS.has(sub);
      }
      if (s.head === 'xcrun')
        return s.args.some((arg) => {
          const lower = arg.toLowerCase();
          return (
            IOS_BRIDGE_HEADS.has(lower) ||
            lower === 'adb' ||
            lower === 'osascript' ||
            lower === 'xcodebuild' ||
            lower === 'xcrun'
          );
        });
      if (s.head === 'xcodebuild')
        return s.args.some(
          (arg) =>
            /webdriveragent/i.test(arg) ||
            /(^|,)id=[0-9a-f-]+/i.test(arg) ||
            /platform=(?:iOS|watchOS|tvOS|visionOS)(?! Simulator)\b/i.test(arg),
        );
      if (s.head === 'osascript') {
        if (!s.args.some((arg) => arg === '-e')) return true;
        const joined = s.args.join(' ');
        if (!PHONE_SHELL_SCRIPT.test(joined)) return false;
        return PHONE_WORD.test(joined) || PHONE_SCRIPT_DYNAMIC.test(joined);
      }
      if (IOS_BRIDGE_MODULE.test(s.head)) {
        if (s.args.some((arg) => PHONE_WORD.test(arg))) return true;
        const at = s.args.findIndex((arg) => arg === '-m' || arg.startsWith('-m'));
        if (at === -1) return false;
        const name = s.args[at] === '-m' ? (s.args[at + 1] ?? '') : s.args[at]!.slice(2);
        return IOS_BRIDGE_HEADS.has(name.toLowerCase());
      }
      return IOS_BRIDGE_HEADS.has(s.head) || s.head.startsWith('idevice');
    },
  },
];

export function stripQuotedSpans(command: string): string {
  let out = '';
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      const end = command.indexOf(ch, i + 1);
      i = end === -1 ? command.length : end + 1;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export function splitBashSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n|\|/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|', '&', '|&', ';;', ';&', ';;&']);
const SHELLS = new Set(['ash', 'bash', 'dash', 'fish', 'ksh', 'sh', 'zsh']);
const COMMAND_KEYWORDS = new Set([
  '!',
  '{',
  '}',
  'case',
  'coproc',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'select',
  'then',
  'until',
  'while',
]);
const MAX_COMMAND_DEPTH = 8;
const UNRESOLVED_COMMAND: GateDecision = { action: 'ask', ruleId: 'ask-unresolved-command' };

interface WrapperSpec {
  flags: readonly string[];
  values: readonly string[];
  skipOperand?: boolean;
  lookup?: boolean;
  pid?: boolean;
  numeric?: boolean;
  scripts?: readonly string[];
  optionalValues?: readonly string[];
}

const WRAPPERS: Readonly<Record<string, WrapperSpec>> = {
  builtin: { flags: [], values: [] },
  busybox: { flags: ['list'], values: [] },
  chroot: { flags: [], values: ['userspec', 'groups'], skipOperand: true },
  command: { flags: ['p'], values: [], lookup: true },
  env: {
    flags: ['i', 'ignore-environment', '0', 'null', 'v', 'debug'],
    values: ['u', 'unset', 'C', 'chdir', 'a', 'argv0'],
    scripts: ['S', 'split-string'],
  },
  doas: {
    flags: ['n', 'non-interactive', 's', 'L', 'N', 'T'],
    values: ['u', 'user', 'C', 'config'],
  },
  exec: { flags: ['c', 'l'], values: ['a'] },
  flock: {
    flags: ['s', 'shared', 'x', 'exclusive', 'n', 'nonblock', 'u', 'unlock', 'o', 'close'],
    values: ['w', 'wait', 'timeout', 'E', 'conflict-exit-code'],
    skipOperand: true,
  },
  ionice: {
    flags: ['t', 'ignore'],
    values: ['c', 'class', 'n', 'classdata'],
    pid: true,
  },
  nice: { flags: [], values: ['n', 'adjustment'], numeric: true },
  nohup: { flags: [], values: [] },
  parallel: { flags: [], values: [] },
  pkexec: { flags: ['disable-internal-agent'], values: ['user', 'u'] },
  nsenter: {
    flags: ['a', 'all'],
    values: [
      't',
      'target',
      'm',
      'mount',
      'u',
      'uts',
      'i',
      'ipc',
      'n',
      'net',
      'p',
      'pid',
      'U',
      'user',
      'S',
      'setuid',
      'G',
      'setgid',
      'w',
      'wd',
      'r',
      'root',
    ],
  },
  run0: {
    flags: ['no-ask-password', 'no-pager', 'pty', 'background'],
    values: [
      'E',
      'setenv',
      'u',
      'user',
      'g',
      'group',
      'D',
      'chdir',
      'nice',
      'property',
      'description',
      'unit',
      'slice',
      'machine',
    ],
  },
  setsid: { flags: ['f', 'fork', 'w', 'wait', 'c', 'ctty'], values: [] },
  stdbuf: { flags: [], values: ['i', 'input', 'o', 'output', 'e', 'error'] },
  sudo: {
    flags: [
      'A',
      'askpass',
      'b',
      'background',
      'E',
      'preserve-env',
      'H',
      'set-home',
      'i',
      'login',
      'k',
      'K',
      'n',
      'non-interactive',
      'P',
      'preserve-groups',
      'S',
      'stdin',
      's',
      'shell',
    ],
    values: [
      'u',
      'user',
      'g',
      'group',
      'h',
      'host',
      'p',
      'prompt',
      'C',
      'close-from',
      'T',
      'command-timeout',
      'R',
      'chroot',
      'D',
      'chdir',
      'r',
      'role',
      't',
      'type',
    ],
  },
  time: {
    flags: ['p', 'portability', 'v', 'verbose', 'a', 'append', 'q', 'quiet'],
    values: ['f', 'format', 'o', 'output'],
  },
  unshare: {
    flags: [
      'm',
      'mount',
      'u',
      'uts',
      'i',
      'ipc',
      'n',
      'net',
      'p',
      'pid',
      'U',
      'user',
      'f',
      'fork',
      'r',
      'map-root-user',
    ],
    values: ['R', 'root', 'w', 'wd', 'S', 'setgroups', 'propagation', 'kill-child'],
  },
  timeout: {
    flags: ['foreground', 'v', 'verbose', 'preserve-status'],
    values: ['k', 'kill-after', 's', 'signal'],
    skipOperand: true,
  },
  uvx: { flags: [], values: ['from', 'with', 'python', 'p'] },
  watch: {
    flags: [
      'p',
      'precise',
      'd',
      'differences',
      't',
      'no-title',
      'c',
      'color',
      'b',
      'beep',
      'e',
      'errexit',
      'g',
      'chgexit',
      'w',
      'no-wrap',
      'x',
      'exec',
      'o',
    ],
    values: ['n', 'interval'],
  },
  xargs: {
    flags: ['0', 'null', 't', 'verbose', 'x', 'exit', 'r', 'no-run-if-empty', 'o', 'open-tty'],
    values: [
      'a',
      'arg-file',
      'E',
      'I',
      'L',
      'max-lines',
      'n',
      'max-args',
      'P',
      'max-procs',
      's',
      'max-chars',
      'd',
      'delimiter',
    ],
    optionalValues: ['e', 'eof', 'i', 'replace', 'l'],
  },
};

interface CollectedCommands {
  segments: BashSegment[];
  scripts: string[];
  unresolved: boolean;
}

function commandBasename(word: string): string {
  const slash = word.lastIndexOf('/');
  return slash === -1 ? word : word.slice(slash + 1);
}

function isAssignment(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(word);
}

function assignmentParts(word: string): { name: string; value: string } {
  const eq = word.indexOf('=');
  let name = eq === -1 ? word : word.slice(0, eq);
  if (name.endsWith('+')) name = name.slice(0, -1);
  return { name, value: eq === -1 ? '' : word.slice(eq + 1) };
}

function isUnresolvedHead(word: string): boolean {
  return /[$`]/.test(word);
}

function hasCommandGlob(word: string): boolean {
  return /[*?[]/.test(word);
}

function isRedirect(op: string): boolean {
  return (
    op === '>' ||
    op === '<' ||
    op === '>>' ||
    op === '>&' ||
    op === '<&' ||
    op === '&>' ||
    op === '>>|' ||
    op === '>|' ||
    op === '<>' ||
    op === '<<' ||
    op === '<<<' ||
    op === '<<-' ||
    op === '&>>'
  );
}

function opName(entry: ShellParseEntry): string | undefined {
  if (typeof entry !== 'object' || !('op' in entry) || 'pattern' in entry) return undefined;
  return typeof entry.op === 'string' ? entry.op : undefined;
}

function entryWord(entry: ShellParseEntry): string | undefined {
  if (typeof entry === 'string') return entry;
  if (
    typeof entry === 'object' &&
    'op' in entry &&
    entry.op === 'glob' &&
    'pattern' in entry &&
    typeof entry.pattern === 'string'
  ) {
    return entry.pattern;
  }
  return undefined;
}

function convertBacktickSpan(
  source: string,
  open: number,
): { text: string; end: number } | undefined {
  let body = '';
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      const next = source[index + 1];
      if (next === '`') {
        const nestedStart = index + 2;
        const nestedEnd = source.indexOf('\\`', nestedStart);
        if (nestedEnd === -1) return undefined;
        body += `$(${source.slice(nestedStart, nestedEnd)})`;
        index = nestedEnd + 1;
        continue;
      }
      if (next === '\\' || next === '$') {
        body += next;
        index += 1;
        continue;
      }
      body += character;
      continue;
    }
    if (character === '`') return { text: body, end: index };
    body += character ?? '';
  }
  return undefined;
}

function normalizeBackticks(source: string): string {
  let out = '';
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === "'") {
      out += character;
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === '\\' && quote !== '"') {
      const next = source[index + 1];
      if (next === '`') {
        const nested = convertBacktickSpan(source, index + 1);
        if (!nested) throw new Error('unclosed backtick');
        out += `$(${nested.text})`;
        index = nested.end;
        continue;
      }
      out += character;
      if (next !== undefined) {
        out += next;
        index += 1;
      }
      continue;
    }
    if (quote === '"' && character === '\\') {
      const next = source[index + 1];
      if (next === '$') {
        out += `\\${next}`;
        index += 1;
        continue;
      }
      if (next === '`' || next === '\\' || next === '"') {
        out += next;
        index += 1;
        continue;
      }
      out += character;
      continue;
    }
    if (character === '`') {
      const span = convertBacktickSpan(source, index);
      if (!span) throw new Error('unclosed backtick');
      out += `$(${span.text})`;
      index = span.end;
      continue;
    }
    if (!quote && (character === "'" || character === '"')) quote = character;
    else if (quote === character) quote = undefined;
    out += character ?? '';
  }
  return out;
}

function matchingParen(source: string, open: number): number | undefined {
  let depth = 0;
  let quote: "'" | '"' | undefined;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote === "'") {
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function executableSubstitutionBodies(source: string): string[] {
  const bodies: string[] = [];
  const scanned = source;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < scanned.length; index += 1) {
    const character = scanned[index];
    if (quote === "'") {
      if (character === "'") quote = undefined;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
        continue;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== '$' || scanned[index + 1] !== '(' || scanned[index + 2] === '(') continue;
    const end = matchingParen(scanned, index + 1);
    if (end === undefined) continue;
    bodies.push(scanned.slice(index + 2, end));
    index = end;
  }
  return bodies;
}

function dynamicScript(word: string): boolean {
  return word.startsWith('$') || word.startsWith('`');
}

function shellCommandScript(
  words: readonly string[],
): { text?: string; dynamic: boolean } | undefined {
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (word.startsWith('--command='))
      return {
        text: word.slice('--command='.length),
        dynamic: dynamicScript(word.slice('--command='.length)),
      };
    if (word === '--command' || /^-[^-]*c/.test(word)) {
      const next = words[index + 1];
      if (next === undefined) return { dynamic: true };
      return { text: next, dynamic: dynamicScript(next) };
    }
  }
  return undefined;
}

function noteScript(word: string, collected: CollectedCommands): void {
  if (dynamicScript(word)) collected.unresolved = true;
  if (word !== '') collected.scripts.push(word);
}

function knownWrapperOption(spec: WrapperSpec, name: string): boolean {
  return (
    spec.flags.includes(name) ||
    spec.values.includes(name) ||
    (spec.optionalValues?.includes(name) ?? false) ||
    (spec.scripts?.includes(name) ?? false) ||
    name === 'help' ||
    name === 'version'
  );
}

function consumeWrapper(
  words: readonly string[],
  start: number,
  spec: WrapperSpec,
  collected: CollectedCommands,
): { index: number; stop: boolean } {
  let index = start;
  let lookup = false;
  let noCommand = false;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (word === '--') {
      index += 1;
      break;
    }
    if (spec.numeric && /^--?\d+$/.test(word)) {
      index += 1;
      continue;
    }
    if (!word.startsWith('-') || word === '-') break;
    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word.slice(2) : word.slice(2, eq);
      if (name === 'help' || name === 'version') lookup = true;
      if (spec.scripts?.includes(name)) {
        const value = eq === -1 ? words[index + 1] : word.slice(eq + 1);
        if (eq === -1) index += 1;
        if (value !== undefined) noteScript(value, collected);
        return { index: index + 1, stop: true };
      }
      if (name === 'pid' || name === 'list') noCommand = true;
      if (!knownWrapperOption(spec, name)) {
        collected.unresolved = true;
        return { index, stop: true };
      }
      if (spec.optionalValues?.includes(name)) {
        index += 1;
        continue;
      }
      if (spec.values.includes(name) && eq === -1) {
        collected.unresolved = true;
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }
    for (let letter = 1; letter < word.length; letter += 1) {
      const name = word[letter] ?? '';
      if (spec.lookup && (name === 'v' || name === 'V')) {
        lookup = true;
        continue;
      }
      if (spec.pid && name === 'p') {
        noCommand = true;
        continue;
      }
      if (spec.scripts?.includes(name)) {
        const attached = word.slice(letter + 1);
        const value = attached || words[index + 1];
        if (!attached) index += 1;
        if (value !== undefined) noteScript(value, collected);
        return { index: index + 1, stop: true };
      }
      if (spec.optionalValues?.includes(name)) continue;
      if (!knownWrapperOption(spec, name)) {
        collected.unresolved = true;
        return { index, stop: true };
      }
      if (spec.values.includes(name)) {
        collected.unresolved = true;
        break;
      }
    }
    index += 1;
  }
  if (lookup || noCommand) return { index, stop: true };
  if (spec.skipOperand && index < words.length && !(words[index] ?? '').startsWith('-')) index += 1;
  return { index, stop: false };
}

function unknownHeadDecision(args: readonly string[]): GateDecision | undefined {
  if (args.length === 0) return undefined;
  const joined = args.join(' ');
  const rm = { head: 'rm', args: [...args], text: `rm ${joined}` };
  const dd = { head: 'dd', args: [...args], text: `dd ${joined}` };
  for (const pattern of DEFAULT_BASH_PATTERNS) {
    if (
      pattern.id !== 'ask-rm-rf-root' &&
      pattern.id !== 'ask-rm-rf-home' &&
      pattern.id !== 'ask-dd-disk'
    ) {
      continue;
    }
    const segment = pattern.id === 'ask-dd-disk' ? dd : rm;
    if (pattern.test(segment.text, segment)) return { action: pattern.action, ruleId: pattern.id };
  }
  return undefined;
}

function rememberUnknownHead(args: readonly string[], collected: CollectedCommands): void {
  const hit = unknownHeadDecision(args);
  if (!hit) return;
  const head = hit.ruleId === 'ask-dd-disk' ? 'dd' : 'rm';
  collected.segments.push({ head, args: [...args], text: `${head} ${args.join(' ')}` });
}

function emitSimple(
  words: readonly string[],
  collected: CollectedCommands,
  unknownHead = false,
): void {
  if (unknownHead) {
    rememberUnknownHead(words, collected);
    return;
  }
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (isAssignment(word)) {
      const { name, value } = assignmentParts(word);
      if (runnerEnvName(name) && value !== '') noteRunnerEnv(name, value, collected);
      else if (/\$\(|`/.test(value)) collected.unresolved = true;
      index += 1;
      continue;
    }
    if (COMMAND_KEYWORDS.has(word)) {
      index += 1;
      if (word === 'function' && index < words.length && words[index] !== '{') index += 1;
      continue;
    }
    if (isUnresolvedHead(word)) {
      collected.unresolved = true;
      rememberUnknownHead(words.slice(index + 1), collected);
      return;
    }
    const base = commandBasename(word).toLowerCase();
    if (base === 'eval') {
      const rest = words.slice(index + 1);
      if (rest.some((part) => dynamicScript(part))) collected.unresolved = true;
      const text = rest.join(' ');
      if (text !== '') collected.scripts.push(text);
      return;
    }
    if (SHELLS.has(base)) {
      const script = shellCommandScript(words.slice(index));
      if (script?.dynamic) collected.unresolved = true;
      if (script?.text) collected.scripts.push(script.text);
      return;
    }
    const spec = Object.hasOwn(WRAPPERS, base) ? WRAPPERS[base] : undefined;
    if (spec) {
      if (base === 'flock') {
        for (let at = index + 1; at < words.length; at += 1) {
          const part = words[at] ?? '';
          if (part === '-c' || part === '--command') {
            const script = words[at + 1];
            if (script) noteScript(script, collected);
            else collected.unresolved = true;
          } else if (part.startsWith('--command=')) {
            noteScript(part.slice('--command='.length), collected);
          }
        }
      }
      const skipped = consumeWrapper(words, index + 1, spec, collected);
      if (skipped.stop) return;
      index = skipped.index;
      continue;
    }
    if (/\s/.test(word)) {
      collected.scripts.push(word);
      return;
    }
    if (hasCommandGlob(word)) {
      collected.unresolved = true;
      return;
    }
    if (COMMAND_OPERAND_HEADS.has(base) || ARITH_EVAL_HEADS.has(base)) {
      const arith = ARITH_EVAL_HEADS.has(base);
      const rest = words.slice(index + 1);
      for (let at = 0; at < rest.length; at += 1) {
        const arg = rest[at]!;
        const eq = arg.indexOf('=');
        const parts = eq === -1 ? [arg] : [arg, arg.slice(eq + 1)];
        for (const part of parts) {
          if (arith) {
            if (!/\$\(|`/.test(part)) continue;
            const inner = /^\$\(([\s\S]*)\)$/.exec(part) ?? /^`([\s\S]*)`$/.exec(part);
            collected.scripts.push(inner ? inner[1]! : part);
            continue;
          }
          if (/\s/.test(part)) {
            collected.scripts.push(part);
            continue;
          }
          const lower = commandBasename(part).toLowerCase();
          if (
            IOS_BRIDGE_HEADS.has(lower) ||
            lower === 'adb' ||
            lower === 'xcodebuild' ||
            lower === 'xcrun' ||
            lower === 'osascript' ||
            lower.startsWith('idevice')
          )
            collected.segments.push({
              head: lower,
              args: rest.slice(at + 1),
              text: part,
            });
        }
        if (base === 'socat') {
          const execMatch = /^(?:exec|system):(.*)$/is.exec(arg);
          if (execMatch !== null && execMatch[1] !== '') collected.scripts.push(execMatch[1]!);
        }
      }
    }
    if (base === 'trap') {
      for (const arg of words.slice(index + 1)) {
        if (!arg.startsWith('-')) {
          if (arg !== '') collected.scripts.push(arg);
          break;
        }
      }
    }
    if (base === 'hash') {
      const rest = words.slice(index + 1);
      for (let at = 0; at < rest.length; at += 1) {
        const arg = rest[at]!;
        if (arg === '--') break;
        if (!arg.startsWith('-') || arg.startsWith('--')) continue;
        const pAt = arg.indexOf('p', 1);
        if (pAt === -1) continue;
        const path = arg.slice(pAt + 1) !== '' ? arg.slice(pAt + 1) : rest[at + 1];
        if (path === undefined) continue;
        const lower = commandBasename(path).toLowerCase();
        if (
          IOS_BRIDGE_HEADS.has(lower) ||
          lower === 'adb' ||
          lower === 'xcodebuild' ||
          lower === 'xcrun' ||
          lower === 'osascript' ||
          lower.startsWith('idevice')
        ) {
          collected.segments.push({ head: lower, args: [], text: path });
          collected.unresolved = true;
        }
      }
    }
    const valueOpts = Object.hasOwn(COMMAND_VALUE_OPTIONS, base)
      ? COMMAND_VALUE_OPTIONS[base]
      : undefined;
    if (valueOpts !== undefined) {
      const rest = words.slice(index + 1);
      for (let at = 0; at < rest.length; at += 1) {
        const arg = rest[at]!;
        for (const opt of valueOpts) {
          let payload: string | undefined;
          if (arg === opt && at + 1 < rest.length) payload = rest[at + 1];
          else if (arg.startsWith(`${opt}=`)) payload = arg.slice(opt.length + 1);
          else if (arg.startsWith(opt)) {
            const restArg = arg.slice(opt.length);
            if (restArg !== '') payload = restArg.startsWith('=') ? restArg.slice(1) : restArg;
          }
          if (payload === undefined) continue;
          const s = payloadScript(payload);
          if (s !== '') collected.scripts.push(s);
        }
      }
    }
    if (base === 'find') {
      let at = index + 1;
      while (at < words.length) {
        if (
          words[at] === '-exec' ||
          words[at] === '-execdir' ||
          words[at] === '-ok' ||
          words[at] === '-okdir'
        ) {
          const cmd = [];
          at += 1;
          while (at < words.length && words[at] !== ';' && words[at] !== '+') {
            cmd.push(words[at] ?? '');
            at += 1;
          }
          if (cmd.length > 0) collected.scripts.push(cmd.join(' '));
        }
        at += 1;
      }
    }
    if (base !== '') {
      collected.segments.push({
        head: base,
        args: words.slice(index + 1),
        text: words.slice(index).join(' '),
      });
    }
    return;
  }
}

function absorbNested(
  entries: readonly ShellParseEntry[],
  start: number,
  collected: CollectedCommands,
): number {
  let index = start;
  const nested: ShellParseEntry[] = [];
  let depth = 1;
  while (index < entries.length && depth > 0) {
    const inner = entries[index];
    const innerOp = inner ? opName(inner) : undefined;
    index += 1;
    if (innerOp === '(' || innerOp === '<(' || innerOp === '>(') depth += 1;
    else if (innerOp === ')') depth -= 1;
    if (depth > 0 && inner) nested.push(inner);
  }
  const innerCollected = collectCommands(nested);
  collected.segments.push(...innerCollected.segments);
  collected.scripts.push(...innerCollected.scripts);
  collected.unresolved ||= innerCollected.unresolved;
  return index;
}

function collectCommands(entries: readonly ShellParseEntry[]): CollectedCommands {
  const collected: CollectedCommands = {
    segments: [],
    scripts: [],
    unresolved: false,
  };
  let index = 0;
  let awaitingSubstitutionArgs = false;
  while (index < entries.length) {
    const words: string[] = [];
    const unknownHead = awaitingSubstitutionArgs;
    let commandPosition = !unknownHead;
    awaitingSubstitutionArgs = false;
    while (index < entries.length) {
      const entry = entries[index];
      if (!entry) {
        index += 1;
        continue;
      }
      if (typeof entry === 'object' && 'comment' in entry) {
        index += 1;
        continue;
      }
      const op = opName(entry);
      if (op && COMMAND_SEPARATORS.has(op)) {
        index += 1;
        break;
      }
      if (op === '(' || op === ')') {
        index += 1;
        if (words.length > 0) break;
        commandPosition = true;
        continue;
      }
      if (op === '<(' || op === '>(') {
        const head = commandBasename(words[0] ?? '');
        if (SHELLS.has(head) || head === 'source' || head === '.') collected.unresolved = true;
        index = absorbNested(entries, index + 1, collected);
        continue;
      }
      if (op && isRedirect(op)) {
        const head = commandBasename(words[0] ?? '');
        const shellInput = SHELLS.has(head) || head === 'source' || head === '.';
        index += 1;
        const target = entries[index];
        const targetWord = target ? entryWord(target) : undefined;
        if (targetWord !== undefined) index += 1;
        if (shellInput) {
          if (op === '<<<' && targetWord) collected.scripts.push(targetWord);
          else collected.unresolved = true;
        }
        continue;
      }
      const word = entryWord(entry);
      if (word === undefined) {
        index += 1;
        continue;
      }
      const next = entries[index + 1];
      const nextOp = next ? opName(next) : undefined;
      if (/^\d+$/.test(word) && nextOp && isRedirect(nextOp)) {
        index += 1;
        continue;
      }
      index += 1;
      if (commandPosition && COMMAND_KEYWORDS.has(word)) {
        if (word === 'function') {
          const name = entries[index] ? entryWord(entries[index] as ShellParseEntry) : undefined;
          if (name && name !== '{') index += 1;
        }
        if (word === 'coproc') {
          const name = entries[index] ? entryWord(entries[index] as ShellParseEntry) : undefined;
          const after = entries[index + 1]
            ? entryWord(entries[index + 1] as ShellParseEntry)
            : undefined;
          if (name !== undefined && name !== '{' && after !== undefined) index += 1;
        }
        continue;
      }
      if (commandPosition && word === '$' && nextOp === '(') {
        collected.unresolved = true;
        awaitingSubstitutionArgs = true;
        continue;
      }
      if (commandPosition && isAssignment(word)) {
        const { name, value } = assignmentParts(word);
        if (runnerEnvName(name) && value !== '') noteRunnerEnv(name, value, collected);
        else if (/\$\(|`/.test(value)) collected.unresolved = true;
        continue;
      }
      words.push(word);
      commandPosition = false;
    }
    emitSimple(words, collected, unknownHead);
  }
  return collected;
}

function segmentDecision(segments: readonly BashSegment[]): GateDecision | undefined {
  for (const pattern of DEFAULT_BASH_PATTERNS) {
    if (pattern.scope !== 'segment') continue;
    for (const segment of segments) {
      if (segment.head === '') continue;
      if (pattern.test(segment.text, segment))
        return { action: pattern.action, ruleId: pattern.id };
    }
  }
  return undefined;
}

function classifyCommand(
  command: string,
  depth: number,
  seen: Set<string>,
): GateDecision | undefined {
  if (depth > MAX_COMMAND_DEPTH) return UNRESOLVED_COMMAND;
  if (seen.has(command)) return undefined;
  seen.add(command);
  const stripped = stripQuotedSpans(command);
  const forkbomb = DEFAULT_BASH_PATTERNS.find((pattern) => pattern.id === 'reject-forkbomb');
  if (forkbomb?.test(stripped, { head: '', args: [], text: stripped })) {
    return { action: forkbomb.action, ruleId: forkbomb.id };
  }
  let normalized: string;
  try {
    normalized = normalizeBackticks(command);
  } catch {
    return UNRESOLVED_COMMAND;
  }
  let entries: ShellParseEntry[];
  try {
    entries = parseShellWords(preserveShellCommandBoundaries(normalized), (name) =>
      name === '' ? '$' : `$${name}`,
    );
  } catch {
    return UNRESOLVED_COMMAND;
  }
  const collected = collectCommands(entries);
  const direct = segmentDecision(collected.segments);
  if (direct) return direct;
  for (const script of collected.scripts) {
    const nested = classifyCommand(script, depth + 1, seen);
    if (nested && nested.action !== 'allow') return nested;
  }
  for (const body of executableSubstitutionBodies(normalized)) {
    const nested = classifyCommand(body, depth + 1, seen);
    if (nested && nested.action !== 'allow') return nested;
  }
  if (collected.unresolved) return UNRESOLVED_COMMAND;
  return undefined;
}

export function decideBashCommand(
  command: string,
  customRules?: readonly PermissionRule[],
): GateDecision {
  const stripped = stripQuotedSpans(command);
  if (customRules !== undefined) {
    const params = { command: stripped };
    const hit =
      matchPermissionRule(customRules, 'bash', params) ??
      matchPermissionRule(customRules, 'Bash', params);
    if (hit !== undefined) return { action: hit.action, ruleId: hit.id };
  }
  return classifyCommand(command, 0, new Set()) ?? { action: 'allow' };
}

export function phoneControlRefusal(command: string): string | undefined {
  const decision = decideBashCommand(command);
  if (decision.action !== 'allow') return formatGateRefusal(command, decision);
  if (PHONE_ALIAS.test(command) && PHONE_WORD.test(command))
    return formatGateRefusal(command, { action: 'ask', ruleId: 'ask-phone-control' });
  return undefined;
}

function refusalActionNote(action: PermissionAction): string {
  return action === 'reject'
    ? 'rejected outright (this shape is never legitimate)'
    : 'requires approval, and this daemon runs unattended (no approval surface), so it is denied';
}

export function formatGateRefusal(command: string, decision: GateDecision): string {
  const ruleId = decision.ruleId ?? 'unknown';
  return [
    `command gate (${ruleId}): ${refusalActionNote(decision.action)}.`,
    `command: ${command}`,
    'replan without the irreversible shape (narrow the paths, drop the flags), or put the rationale in the plan and let a human approve it at the confirm/review gate.',
  ].join('\n');
}

export function decideToolCall(
  toolName: string,
  params: Readonly<Record<string, unknown>>,
  customRules?: readonly PermissionRule[],
): GateDecision | undefined {
  if (customRules !== undefined && customRules.length > 0) {
    const slots: Record<string, string> = Object.create(null);
    for (const [key, value] of Object.entries(params)) {
      slots[key] = typeof value === 'string' ? value : '';
    }
    const hit = matchPermissionRule(customRules, toolName, slots);
    if (hit !== undefined) return { action: hit.action, ruleId: hit.id };
  }
  return undefined;
}

export function formatToolRefusal(toolName: string, decision: GateDecision): string {
  const ruleId = decision.ruleId ?? 'unknown';
  return [
    `tool gate (${ruleId}): ${refusalActionNote(decision.action)}.`,
    `tool: ${toolName}`,
    'replan without the gated tool call, or put the rationale in the plan and let a human approve it at the confirm/review gate.',
  ].join('\n');
}

export function gateToolCallHandler(opts: {
  rules?: readonly PermissionRule[];
  log?: (msg: string) => void;
}): (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined> {
  const rules = opts.rules;
  const log = opts.log;
  return async (event) => {
    if (isToolCallEventType('bash', event)) {
      const decision = decideBashCommand(event.input.command, rules);
      if (decision.action !== 'allow') {
        log?.(`${decision.action}: rule=${decision.ruleId} command=${event.input.command}`);
        return { block: true, reason: formatGateRefusal(event.input.command, decision) };
      }
      return undefined;
    }
    const hit = decideToolCall(event.toolName, event.input, rules);
    if (hit !== undefined && hit.action !== 'allow') {
      log?.(`${hit.action}: rule=${hit.ruleId} tool=${event.toolName}`);
      return { block: true, reason: formatToolRefusal(event.toolName, hit) };
    }
    return undefined;
  };
}
