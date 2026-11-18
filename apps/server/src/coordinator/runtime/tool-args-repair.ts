import type { ToolCall } from '@earendil-works/pi-ai';
import { GenerationTask, hook } from '@earendil-works/pi-durable';

export const INVALID_ARGUMENT_STREAK_CAP = 3;

const RECEIVED_MARKER = '\n\nReceived arguments:\n';
const MAX_RAW_ARGUMENT_CHARS = 256 * 1024;

const JSON_ESCAPE = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);
const VALUE_START = new Set('-+.0123456789tfnTFN');
const LITERAL_ALIASES: Record<string, string> = {
  True: 'true',
  False: 'false',
  None: 'null',
  undefined: 'null',
};

export function argumentsErrorText(argumentsError: string): string | undefined {
  const index = argumentsError.indexOf(RECEIVED_MARKER);
  return index === -1 ? undefined : argumentsError.slice(index + RECEIVED_MARKER.length);
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isControl(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code <= 0x1f;
}

function escapedControl(char: string): string {
  switch (char) {
    case '\b':
      return '\\b';
    case '\f':
      return '\\f';
    case '\n':
      return '\\n';
    case '\r':
      return '\\r';
    case '\t':
      return '\\t';
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000'}`;
  }
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || char === ',' || char === '}' || char === ']' || /\s/.test(char);
}

/**
 * Best-effort normalizer for malformed tool-argument text: single-quoted strings become double
 * quoted, bare tokens where a value or key is expected become strings, Python-style literals map to
 * JSON, a comma before a closer is dropped, and unterminated strings/containers are closed at end of
 * input. The output only ever reaches JSON.parse; anything it cannot fix stays an error.
 */
function normalizeJsonText(raw: string): string {
  let out = '';
  let lastComma = -1;
  let state: 'outside' | 'double' | 'single' = 'outside';
  const stack: string[] = [];
  let i = 0;

  while (i < raw.length) {
    const char = raw[i];
    if (char === undefined) break;
    if (state !== 'outside') {
      const close = state === 'double' ? '"' : "'";
      if (char === close) {
        out += '"';
        state = 'outside';
      } else if (state === 'single' && char === '"') {
        out += '\\"';
      } else if (char === '\\') {
        const next = raw[i + 1];
        if (state === 'single' && next === "'") {
          out += "'";
          i += 1;
        } else if (next === undefined) {
          out += '\\\\';
        } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
          out += `\\u${raw.slice(i + 2, i + 6)}`;
          i += 5;
        } else if (JSON_ESCAPE.has(next)) {
          out += `\\${next}`;
          i += 1;
        } else {
          out += '\\\\';
        }
      } else {
        out += isControl(char) ? escapedControl(char) : char;
      }
      i += 1;
      continue;
    }
    if (char === '"') {
      out += char;
      state = 'double';
      i += 1;
      continue;
    }
    if (char === "'") {
      out += '"';
      state = 'single';
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      out += char;
      i += 1;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      out += char;
      i += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      const open = stack.pop();
      if (open !== undefined && open !== (char === '}' ? '{' : '[')) return raw;
      if (lastComma !== -1 && out.slice(lastComma).trim() === ',') out = out.slice(0, lastComma);
      out += char;
      i += 1;
      continue;
    }
    if (char === ',') {
      lastComma = out.length;
      out += char;
      i += 1;
      continue;
    }
    if (char === ':') {
      out += char;
      i += 1;
      continue;
    }
    if (VALUE_START.has(char)) {
      const literal = /^(true|false|null)\b/.exec(raw.slice(i));
      if (literal !== null) {
        out += literal[0];
        i += literal[0].length;
        continue;
      }
      const alias = /^(True|False|None|undefined)\b/.exec(raw.slice(i));
      if (alias !== null) {
        out += LITERAL_ALIASES[alias[0]];
        i += alias[0].length;
        continue;
      }
      const number = /^[-+]?\d*\.?\d+([eE][-+]?\d+)?/.exec(raw.slice(i));
      if (number !== null && isBoundary(raw[i + number[0].length])) {
        out += number[0];
        i += number[0].length;
        continue;
      }
    }
    let end = i;
    while (end < raw.length && raw[end] !== ',' && raw[end] !== '}' && raw[end] !== ']') end += 1;
    const token = raw.slice(i, end).trim();
    out += LITERAL_ALIASES[token] ?? JSON.stringify(token);
    i = end;
  }
  if (state !== 'outside') out += '"';
  while (stack.length > 0) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

export function repairToolCallArguments(raw: string): Record<string, unknown> | undefined {
  if (raw.length > MAX_RAW_ARGUMENT_CHARS) return undefined;
  const direct = parseObject(raw);
  if (direct !== undefined) return direct;
  return parseObject(normalizeJsonText(raw));
}

interface RepairedToolCall extends ToolCall {
  repairedArgumentsError?: string;
}

export function createToolArgsRepair(): ReturnType<typeof hook> {
  let streak = 0;
  return hook(GenerationTask, {
    afterResponse: (message) => {
      const calls = message.content.filter(
        (block): block is RepairedToolCall => block.type === 'toolCall',
      );
      for (const call of calls) {
        if (call.argumentsError === undefined) continue;
        const raw = argumentsErrorText(call.argumentsError);
        const repaired = raw === undefined ? undefined : repairToolCallArguments(raw);
        if (repaired === undefined) continue;
        call.repairedArgumentsError = call.argumentsError;
        call.arguments = repaired as ToolCall['arguments'];
        delete call.argumentsError;
      }
      if (calls.every((call) => call.argumentsError === undefined)) {
        streak = 0;
        return;
      }
      streak += 1;
      if (streak < INVALID_ARGUMENT_STREAK_CAP) return;
      streak = 0;
      const names = calls
        .filter((call) => call.argumentsError !== undefined)
        .map((call) => call.name)
        .join(', ');
      message.content = message.content.filter((block) => block.type !== 'toolCall');
      if (message.content.length === 0)
        message.content = [
          { type: 'text', text: '(tool call dropped: arguments could not be parsed)' },
        ];
      message.stopReason = 'error';
      message.errorMessage = `Tool call arguments could not be parsed after ${INVALID_ARGUMENT_STREAK_CAP} consecutive responses (${names})`;
    },
  });
}
