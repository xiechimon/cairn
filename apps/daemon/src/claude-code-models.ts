import { readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  type ClaudeAuthStateWire,
  type ClaudeCodeReport,
  parseClaudeCodeModelSource,
} from '@cairn/shared';
import type { ClaudeCodeAuthProbe } from './claude-code-auth.js';
import type { ClaudeBinInfo } from './claude-code-bin.js';

export interface ClaudeCodeReportExtra {
  bin?: ClaudeBinInfo | null;
  auth?: ClaudeCodeAuthProbe;
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

export function readClaudeCodeReport(
  homeDir: string = homedir(),
  extra: ClaudeCodeReportExtra = {},
): ClaudeCodeReport {
  let raw: string | undefined;
  try {
    raw = readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf8');
  } catch {
    raw = undefined;
  }
  const source = parseClaudeCodeModelSource(raw ?? null, hostname());
  return {
    installed: source.installed,
    hostname: source.hostname,
    models: source.models,
    ...(extra.bin !== undefined ? { bin: extra.bin } : {}),
    ...(extra.auth ? { auth: toWireAuth(extra.auth) } : {}),
  };
}
