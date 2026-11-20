import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  type ClaudeAuthStateWire,
  type ClaudeCodeReport,
  type ClaudeLogin,
  DEFAULT_CLAUDE_CODE_MODELS,
  parseClaudeCodeModelSource,
} from '@cairn/shared';
import type { ClaudeCodeAuthProbe } from './claude-code-auth.js';
import type { ClaudeBinInfo } from './claude-code-bin.js';

export interface ClaudeCodeReportExtra {
  bin?: ClaudeBinInfo | null;
  auth?: ClaudeCodeAuthProbe;
  login?: ClaudeLogin;
}

export function toWireAuth(probe: ClaudeCodeAuthProbe): ClaudeAuthStateWire {
  if (probe.state === 'logged-in') {
    return { state: probe.state, method: probe.method, provider: probe.provider };
  }
  if (probe.state === 'not-logged-in') {
    return { state: probe.state, provider: probe.provider };
  }
  return { state: probe.state, reason: probe.reason };
}

function usesCustomBackend(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  try {
    const env = (JSON.parse(raw) as { env?: unknown }).env;
    if (typeof env !== 'object' || env === null) return false;
    const baseUrl = (env as Record<string, unknown>).ANTHROPIC_BASE_URL;
    return typeof baseUrl === 'string' && baseUrl.trim() !== '';
  } catch {
    return false;
  }
}

export function readClaudeCodeReport(
  configDir: string,
  extra: ClaudeCodeReportExtra = {},
): ClaudeCodeReport {
  let raw: string | undefined;
  try {
    raw = readFileSync(join(configDir, 'settings.json'), 'utf8');
  } catch {
    raw = undefined;
  }
  const source = parseClaudeCodeModelSource(raw ?? null, hostname());
  const binaryFound = extra.bin != null;
  const settingsIds = new Set(source.models.map((model) => model.id));
  const builtins =
    binaryFound && !usesCustomBackend(raw)
      ? DEFAULT_CLAUDE_CODE_MODELS.filter((model) => !settingsIds.has(model.id))
      : [];
  return {
    installed: source.installed || binaryFound,
    hostname: source.hostname,
    models:
      binaryFound && source.models.length === 0
        ? DEFAULT_CLAUDE_CODE_MODELS.map((model) => ({ ...model }))
        : [...source.models, ...builtins.map((model) => ({ ...model }))],
    ...(extra.bin !== undefined ? { bin: extra.bin } : {}),
    ...(extra.auth ? { auth: toWireAuth(extra.auth) } : {}),
    ...(extra.login !== undefined ? { login: extra.login } : {}),
  };
}
