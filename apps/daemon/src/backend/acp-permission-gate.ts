import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { escapeRegExp, type SessionOpts } from '@cairn/shared';

export type AcpTurnPolicy = 'relay-only' | 'read-only' | 'normal';

export type AcpToolCall = RequestPermissionRequest['toolCall'];

export interface AcpNormalGate {
  mode: 'deny' | 'allow-once';
}

export interface AcpGateDecision {
  allow: boolean;
  reason: string;
}

const PERMISSIVE_MODES = new Set([
  'bypass',
  'bypasspermissions',
  'bypass_permissions',
  'autonomous',
  'full-access',
  'accept-edits',
  'acceptedits',
  'auto',
  'yolo',
]);
const RESTRICTIVE_MODE_ORDER = ['read-only', 'default', 'normal', 'ask', 'plan'];
const READ_KINDS = new Set(['read', 'search', 'think']);
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
  opts: Pick<SessionOpts, 'remoteToolsOnly' | 'readOnly' | 'lockedDown'>,
): AcpTurnPolicy {
  if (opts.remoteToolsOnly === true) return 'relay-only';
  if (opts.readOnly === true || opts.lockedDown === true) return 'read-only';
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

export const UNMANAGED_PROVIDER_ACTIONS = [
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'RemoteTrigger',
  'Workflow',
] as const;

export function claudeAcpSessionMeta(policy: AcpTurnPolicy): Record<string, unknown> | undefined {
  return {
    claudeCode: {
      options: {
        disallowedTools: [
          ...UNMANAGED_PROVIDER_ACTIONS,
          ...(policy === 'relay-only'
            ? [...CLAUDE_BUILTIN_WRITE_TOOLS, ...CLAUDE_BUILTIN_READ_TOOLS]
            : policy === 'read-only'
              ? CLAUDE_BUILTIN_WRITE_TOOLS
              : []),
        ],
        ...(policy === 'normal' ? {} : { allowDangerouslySkipPermissions: false }),
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

function isCairnLazyMcpCall(
  toolCall: AcpToolCall,
  candidates: readonly string[],
  hostToolNames: readonly string[],
): boolean {
  if (!candidates.some((candidate) => /^call_mcp_tool(?:\b|$)/i.test(candidate))) return false;
  const rawInput = toolCall.rawInput;
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return false;
  const record = rawInput as Record<string, unknown>;
  const serverName = record.ServerName ?? record.serverName ?? record.server_name;
  if (typeof serverName !== 'string' || serverName.trim().toLowerCase() !== 'cairn') return false;
  const toolName = record.ToolName ?? record.toolName ?? record.tool_name;
  return typeof toolName === 'string' && hostToolNames.includes(toolName);
}

export function isHostToolCall(toolCall: AcpToolCall, hostToolNames: readonly string[]): boolean {
  if (hostToolNames.length === 0) return false;
  const candidates = nameCandidates(toolCall);
  const kind = toolCall.kind ?? 'other';
  if (kind !== 'other') return false;
  if (isCairnLazyMcpCall(toolCall, candidates, hostToolNames)) return true;
  return hostToolNames.some((name) => {
    const escaped = escapeRegExp(name);
    const qualified = new RegExp(
      `^(?:mcp__cairn__${escaped}|mcp_cairn_${escaped}|cairn(?:__|[:/. -]+)${escaped}|${escaped} \\(cairn(?: MCP(?: Server)?)?\\)|Calling ${escaped} from cairn(?: MCP(?: Server)?)?)$`,
      'i',
    );
    return candidates.some((candidate) => qualified.test(candidate) || candidate === name);
  });
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
  return { allow: false, reason: `Cairn permission gate rejected ${label}: agent policy denies` };
}
