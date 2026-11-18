import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import type { SessionOpts } from '@cairn/shared';
import {
  decideBashCommand,
  decideToolCall,
  type FolderGateContext,
  type PermissionRule,
} from './command-gate.js';

export type AcpTurnPolicy = 'relay-only' | 'read-only' | 'normal';

export type AcpToolCall = RequestPermissionRequest['toolCall'];

export interface AcpNormalGate {
  mode: 'deny' | 'allow-once' | 'gate';
  rules?: readonly PermissionRule[];
  folders?: () => FolderGateContext | undefined;
}

export interface AcpGateDecision {
  allow: boolean;
  reason: string;
}

const PERMISSIVE_MODES = new Set([
  'bypass',
  'bypasspermissions',
  'autonomous',
  'full-access',
  'accept-edits',
  'acceptedits',
  'auto',
  'yolo',
]);
const RESTRICTIVE_MODE_ORDER = ['read-only', 'default', 'normal', 'ask', 'plan'];
const KNOWN_KINDS = new Set([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
]);
const READ_KINDS = new Set(['read', 'search', 'think']);
const FILE_KIND_TOOL: Record<string, string> = {
  read: 'read',
  search: 'grep',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
};
const CLAUDE_BUILTIN_WRITE_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
];
const CLAUDE_BUILTIN_READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS'];

export function acpTurnPolicy(
  opts: Pick<SessionOpts, 'remoteToolsOnly' | 'readOnly'>,
): AcpTurnPolicy {
  if (opts.remoteToolsOnly === true) return 'relay-only';
  if (opts.readOnly === true) return 'read-only';
  return 'normal';
}

export function isPermissiveAcpMode(modeId: string): boolean {
  return PERMISSIVE_MODES.has(modeId.toLowerCase());
}

export function restrictiveAcpMode(modes: {
  currentModeId: string;
  availableModes: readonly { id: string }[];
}): string | null {
  if (!isPermissiveAcpMode(modes.currentModeId)) return null;
  for (const wanted of RESTRICTIVE_MODE_ORDER) {
    const found = modes.availableModes.find((mode) => mode.id.toLowerCase() === wanted);
    if (found) return found.id;
  }
  throw new Error(
    'ACP agent starts in a mode that skips permission prompts and offers no restrictive mode: refusing a locked turn (fail-closed)',
  );
}

export function claudeAcpSessionMeta(policy: AcpTurnPolicy): Record<string, unknown> | undefined {
  if (policy === 'normal') return undefined;
  return {
    claudeCode: {
      options: {
        disallowedTools:
          policy === 'relay-only'
            ? [...CLAUDE_BUILTIN_WRITE_TOOLS, ...CLAUDE_BUILTIN_READ_TOOLS]
            : CLAUDE_BUILTIN_WRITE_TOOLS,
        allowDangerouslySkipPermissions: false,
      },
    },
  };
}

function strings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (typeof value === 'object' && value !== null)
    for (const inner of Object.values(value)) strings(inner, into);
}

function nameCandidates(toolCall: AcpToolCall): string[] {
  const found: string[] = [];
  for (const value of [toolCall.title, toolCall.name])
    if (typeof value === 'string') found.push(value);
  const meta = toolCall._meta;
  if (meta !== null && meta !== undefined) {
    for (const [key, value] of Object.entries(meta)) {
      if (/toolname/i.test(key)) strings(value, found);
      else if (typeof value === 'object' && value !== null) {
        for (const [inner, innerValue] of Object.entries(value)) {
          if (/toolname/i.test(inner)) strings(innerValue, found);
        }
      }
    }
  }
  return found.map((value) => value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isHostToolCall(toolCall: AcpToolCall, hostToolNames: readonly string[]): boolean {
  if (hostToolNames.length === 0) return false;
  const candidates = nameCandidates(toolCall);
  const kind = toolCall.kind ?? 'other';
  if (kind !== 'other') return false;
  return hostToolNames.some((name) => {
    const escaped = escapeRegExp(name);
    const qualified = new RegExp(
      `^(?:mcp__cairn__${escaped}|mcp_cairn_${escaped}|cairn(?:__|[:/. -]+)${escaped}|${escaped} \\(cairn(?: MCP(?: Server)?)?\\))$`,
      'i',
    );
    return candidates.some((candidate) => qualified.test(candidate) || candidate === name);
  });
}

function rawRecord(toolCall: AcpToolCall): Record<string, unknown> {
  const raw = toolCall.rawInput;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function commandOf(toolCall: AcpToolCall): string | null {
  const raw = rawRecord(toolCall);
  for (const key of ['command', 'cmd', 'script']) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (Array.isArray(value) && value.every((part) => typeof part === 'string'))
      return value.join(' ');
  }
  return null;
}

function pathsOf(toolCall: AcpToolCall): string[] {
  const paths: string[] = [];
  for (const location of toolCall.locations ?? []) paths.push(location.path);
  const raw = rawRecord(toolCall);
  for (const key of ['path', 'file_path', 'filepath', 'absolute_path']) {
    if (typeof raw[key] === 'string') paths.push(raw[key]);
  }
  return paths;
}

export function decideAcpPermission(input: {
  policy: AcpTurnPolicy;
  toolCall: AcpToolCall;
  hostToolNames: readonly string[];
  normal: AcpNormalGate;
}): AcpGateDecision {
  const { policy, toolCall } = input;
  const kind = toolCall.kind ?? 'other';
  const label = `${kind} ${toolCall.title ?? toolCall.name ?? toolCall.toolCallId}`;
  if (policy !== 'normal') {
    if (isHostToolCall(toolCall, input.hostToolNames)) {
      return { allow: true, reason: 'Cairn relay tool' };
    }
    if (policy === 'read-only' && READ_KINDS.has(kind)) {
      return { allow: true, reason: 'read-only turn allows read-type built-ins' };
    }
    const why =
      policy === 'relay-only'
        ? 'this turn runs on Cairn relay tools only, built-in tools are off'
        : 'this is a read-only turn, only read-type built-ins and relay tools are allowed';
    return { allow: false, reason: `Cairn permission gate rejected ${label}: ${why}` };
  }
  if (input.normal.mode === 'allow-once') return { allow: true, reason: 'allow-once agent policy' };
  if (input.normal.mode === 'deny') {
    return { allow: false, reason: `Cairn permission gate rejected ${label}: agent policy denies` };
  }
  if (!KNOWN_KINDS.has(kind)) {
    return { allow: false, reason: `Cairn permission gate rejected ${label}: unknown tool kind` };
  }
  const folders = input.normal.folders?.();
  if (kind === 'execute') {
    const command = commandOf(toolCall);
    if (command === null) {
      return {
        allow: false,
        reason: `Cairn permission gate rejected ${label}: no command text to check`,
      };
    }
    const decision = decideBashCommand(command, input.normal.rules, folders);
    return decision.action === 'allow'
      ? { allow: true, reason: 'command gate allows' }
      : {
          allow: false,
          reason: `Cairn permission gate rejected ${label}: command gate (${decision.ruleId ?? 'rule'}) ${decision.action}`,
        };
  }
  const tool = FILE_KIND_TOOL[kind];
  if (tool !== undefined) {
    for (const path of pathsOf(toolCall)) {
      const decision = decideToolCall(tool, { path }, input.normal.rules, folders);
      if (decision !== undefined && decision.action !== 'allow') {
        return {
          allow: false,
          reason: `Cairn permission gate rejected ${label}: tool gate (${decision.ruleId ?? 'rule'}) ${decision.action}`,
        };
      }
    }
  }
  return { allow: true, reason: 'tool gate allows' };
}
