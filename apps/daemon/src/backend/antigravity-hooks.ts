import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcpTurnPolicy } from './acp-permission-gate.js';

const HOOK_GROUP_KEY = 'cairn-relay-guard';
const READ_ONLY_BUILTINS = [
  'read_file',
  'view_file',
  'list_dir',
  'find_by_name',
  'grep_search',
  'view_file_outline',
  'view_code_item',
  'command_status',
  'read_terminal',
];

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildHookScript(policy: Exclude<AcpTurnPolicy, 'normal'>): string {
  const allowReadOnly =
    policy === 'read-only' ? `const ro=${JSON.stringify(READ_ONLY_BUILTINS)};` : 'const ro=[];';
  const denyReason =
    policy === 'relay-only'
      ? 'Cairn relay-only turn: built-in tool " + name + " is disabled; use mcp_cairn_* tools instead.'
      : 'Cairn read-only turn: built-in tool " + name + " is disabled.';
  return [
    'const fs=require("node:fs");',
    allowReadOnly,
    'let data={};',
    'try{data=JSON.parse(fs.readFileSync(0,"utf8"))}catch{}',
    'const tc=data&&data.toolCall||{},name=String(tc.name||""),args=tc.args||{};',
    'const srv=String(args.ServerName??args.serverName??args.server_name??"").trim().toLowerCase();',
    'const ok=name.startsWith("mcp_cairn_")||(name==="call_mcp_tool"&&srv==="cairn")||ro.includes(name);',
    `process.stdout.write(JSON.stringify(ok?{decision:"allow"}:{decision:"deny",reason:"${denyReason}"}));`,
  ].join('');
}

export function installAntigravityTurnHooks(cwd: string, policy: AcpTurnPolicy): () => void {
  if (policy === 'normal') return () => {};
  const agentsDir = join(cwd, '.agents');
  const hooksPath = join(agentsDir, 'hooks.json');
  const hadAgentsDir = existsSync(agentsDir);
  const priorRaw = existsSync(hooksPath) ? readFileSync(hooksPath, 'utf8') : null;
  let base: Record<string, unknown> = {};
  if (priorRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(priorRaw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {}
  }
  const command = `${shQuote(process.execPath)} -e ${shQuote(buildHookScript(policy))}`;
  const next = {
    ...base,
    [HOOK_GROUP_KEY]: {
      PreToolUse: [
        {
          matcher: '.*',
          hooks: [{ type: 'command', command }],
        },
      ],
    },
  };
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(hooksPath, JSON.stringify(next), { mode: 0o600 });
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (priorRaw !== null) {
        writeFileSync(hooksPath, priorRaw);
        return;
      }
      rmSync(hooksPath, { force: true });
      if (!hadAgentsDir && existsSync(agentsDir) && readdirSync(agentsDir).length === 0) {
        rmSync(agentsDir, { recursive: true, force: true });
      }
    } catch {}
  };
}
