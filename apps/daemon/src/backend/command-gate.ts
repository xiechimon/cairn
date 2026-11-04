import { matchPermissionRule, type PermissionAction, type PermissionRule } from '@cairn/shared';
import {
  isToolCallEventType,
  type ToolCallEvent,
  type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';

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

const PREFIX_TOKENS = new Set(['sudo', 'command', 'nice', 'nohup']);

function tokenize(segmentText: string): BashSegment {
  const raw = segmentText
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  const tokens = [...raw];
  while (tokens.length > 0) {
    const head = tokens[0] as string;
    if (PREFIX_TOKENS.has(head)) {
      tokens.shift();
      continue;
    }
    if (head === 'env') {
      tokens.shift();
      while (tokens.length > 0 && (tokens[0] as string).includes('=')) tokens.shift();
      continue;
    }
    break;
  }
  const [head = '', ...args] = tokens;
  return { head, args, text: segmentText.trim() };
}

function hasRecursiveFlag(args: string[]): boolean {
  return args.some(
    (t) =>
      t === '--recursive' ||
      (t.startsWith('-') && t !== '-' && !t.startsWith('--') && /[rR]/.test(t.slice(1))),
  );
}

function normalizeBracedVar(op: string): string {
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}(\/.*)?$/.exec(op);
  if (!m) return op;
  return `$${m[1] ?? ''}${m[2] ?? ''}`;
}

function rmOperands(args: string[]): string[] {
  const out: string[] = [];
  let restAreOperands = false;
  for (const t of args) {
    if (restAreOperands) {
      out.push(normalizeBracedVar(t));
      continue;
    }
    if (t === '--') {
      restAreOperands = true;
      continue;
    }
    if (t.startsWith('-') && t !== '-') continue;
    out.push(normalizeBracedVar(t));
  }
  return out;
}

const POWER_HEADS = new Set(['shutdown', 'reboot', 'halt', 'poweroff']);

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
    test: (_text, s) =>
      s.head === 'dd' && s.text.includes('of=/dev/') && !s.text.includes('of=/dev/null'),
  },
  {
    id: 'ask-power',
    action: 'ask',
    description: '关机/重启（执行机是共享/远端资产，停机不可逆）',
    scope: 'segment',
    test: (_text, s) => POWER_HEADS.has(s.head),
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
  for (const pattern of DEFAULT_BASH_PATTERNS) {
    if (pattern.scope === 'command') {
      if (pattern.test(stripped, { head: '', args: [], text: stripped })) {
        return { action: pattern.action, ruleId: pattern.id };
      }
      continue;
    }
    for (const segmentText of splitBashSegments(stripped)) {
      const segment = tokenize(segmentText);
      if (segment.head === '') continue;
      if (pattern.test(stripped, segment)) return { action: pattern.action, ruleId: pattern.id };
    }
  }
  return { action: 'allow' };
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
  if (customRules === undefined || customRules.length === 0) return undefined;
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    slots[key] = typeof value === 'string' ? value : '';
  }
  const hit = matchPermissionRule(customRules, toolName, slots);
  if (hit === undefined) return undefined;
  return { action: hit.action, ruleId: hit.id };
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
