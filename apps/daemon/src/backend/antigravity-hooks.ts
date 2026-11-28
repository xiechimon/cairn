import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AcpTurnPolicy } from './acp-permission-gate.js';

type RestrictedPolicy = Exclude<AcpTurnPolicy, 'normal'>;

interface HookLeaseState {
  hadAgentsDir: boolean;
  hadHooksFile: boolean;
  leases: Map<symbol, RestrictedPolicy>;
}

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
const activeHooks = new Map<string, HookLeaseState>();

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildHookScript(policy: RestrictedPolicy): string {
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

function readHooksObject(hooksPath: string, strict: boolean): Record<string, unknown> | null {
  if (!existsSync(hooksPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(hooksPath, 'utf8'));
  } catch (error) {
    if (strict) {
      throw new Error(
        `Refusing to overwrite malformed hooks file ${hooksPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (strict) {
      throw new Error(`Refusing to overwrite non-object hooks file ${hooksPath}`);
    }
    return null;
  }
  return parsed as Record<string, unknown>;
}

function strictestPolicy(leases: Map<symbol, RestrictedPolicy>): RestrictedPolicy {
  for (const policy of leases.values()) {
    if (policy === 'relay-only') return 'relay-only';
  }
  return 'read-only';
}

function writeGuard(
  hooksPath: string,
  agentsDir: string,
  base: Record<string, unknown>,
  policy: RestrictedPolicy,
): void {
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
}

function stripGuardKey(
  hooksPath: string,
  agentsDir: string,
  options: { keepEmptyFile: boolean; removeEmptyAgentsDir: boolean },
): void {
  try {
    const parsed = readHooksObject(hooksPath, false);
    if (parsed === null || !Object.hasOwn(parsed, HOOK_GROUP_KEY)) return;
    const { [HOOK_GROUP_KEY]: _removed, ...rest } = parsed;
    if (Object.keys(rest).length > 0) {
      writeFileSync(hooksPath, JSON.stringify(rest), { mode: 0o600 });
      return;
    }
    if (options.keepEmptyFile) {
      writeFileSync(hooksPath, '{}', { mode: 0o600 });
      return;
    }
    rmSync(hooksPath, { force: true });
    if (
      options.removeEmptyAgentsDir &&
      existsSync(agentsDir) &&
      readdirSync(agentsDir).length === 0
    ) {
      rmSync(agentsDir, { recursive: true, force: true });
    }
  } catch {}
}

export function installAntigravityTurnHooks(cwd: string, policy: AcpTurnPolicy): () => void {
  const key = resolve(cwd);
  const agentsDir = join(key, '.agents');
  const hooksPath = join(agentsDir, 'hooks.json');
  if (policy === 'normal') {
    if (!activeHooks.has(key)) {
      stripGuardKey(hooksPath, agentsDir, { keepEmptyFile: false, removeEmptyAgentsDir: false });
    }
    return () => {};
  }

  const base = readHooksObject(hooksPath, true) ?? {};
  let entry = activeHooks.get(key);
  const createdEntry = entry === undefined;
  if (entry === undefined) {
    entry = {
      hadAgentsDir: existsSync(agentsDir),
      hadHooksFile: existsSync(hooksPath),
      leases: new Map(),
    };
    activeHooks.set(key, entry);
  }
  const token = Symbol();
  entry.leases.set(token, policy);
  try {
    writeGuard(hooksPath, agentsDir, base, strictestPolicy(entry.leases));
  } catch (error) {
    entry.leases.delete(token);
    if (createdEntry && entry.leases.size === 0) activeHooks.delete(key);
    throw error;
  }

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    const current = activeHooks.get(key);
    if (current === undefined) return;
    current.leases.delete(token);
    if (current.leases.size > 0) {
      try {
        const curBase = readHooksObject(hooksPath, true) ?? {};
        writeGuard(hooksPath, agentsDir, curBase, strictestPolicy(current.leases));
      } catch {}
      return;
    }
    activeHooks.delete(key);
    stripGuardKey(hooksPath, agentsDir, {
      keepEmptyFile: current.hadHooksFile,
      removeEmptyAgentsDir: !current.hadAgentsDir,
    });
  };
}
