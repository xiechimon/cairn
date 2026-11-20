import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeMcpEntries } from '@cairn/shared';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import { claudeConfigHome } from './runtime-homes.js';

const IMPORT_VERSION = 1;
const SECRET_KEY =
  /key|token|secret|pass|pwd|auth|credential|cookie|session|dsn|pem|bearer|private/i;

const markerSchema = z.object({
  version: z.number(),
  at: z.number(),
  copied: z.array(z.string()),
  skipped: z.array(z.object({ item: z.string(), reason: z.string() })),
  failed: z.array(z.object({ item: z.string(), reason: z.string() })),
});

export interface AgentConfigImportReport {
  copied: string[];
  skipped: Array<{ item: string; reason: string }>;
  failed: Array<{ item: string; reason: string }>;
}

export interface AgentConfigImportOptions {
  cairnHome: string;
  realHome?: string;
  env?: NodeJS.ProcessEnv;
  force?: boolean;
}

function markerPath(cairnHome: string): string {
  return join(cairnHome, 'imports', 'agent-config.json');
}

export function agentConfigImportDone(cairnHome: string): boolean {
  try {
    markerSchema.parse(JSON.parse(readFileSync(markerPath(cairnHome), 'utf8')));
    return true;
  } catch {
    return false;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function serverBag(source: unknown): Record<string, unknown> {
  return source !== null && typeof source === 'object' && !Array.isArray(source)
    ? Object.assign(Object.create(null), source as Record<string, unknown>)
    : Object.create(null);
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed = readJson(path);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const codexMcpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_vars: z.array(z.string()).optional(),
  url: z.string().optional(),
  bearer_token_env_var: z.string().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});

const codexConfigSchema = z.object({
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
});

export function importAgentConfig(
  options: AgentConfigImportOptions,
): AgentConfigImportReport | null {
  const { cairnHome } = options;
  const realHome = options.realHome ?? homedir();
  const env = options.env ?? process.env;
  if (!options.force && agentConfigImportDone(cairnHome)) return null;

  const report: AgentConfigImportReport = { copied: [], skipped: [], failed: [] };
  const claudeHome = claudeConfigHome(cairnHome);
  mkdirSync(claudeHome, { recursive: true, mode: 0o700 });

  const userSkills = join(realHome, '.claude', 'skills');
  const managedSkills = join(claudeHome, 'skills');
  if (!existsSync(userSkills)) {
    report.skipped.push({ item: userSkills, reason: 'no user skills directory' });
  } else {
    mkdirSync(managedSkills, { recursive: true });
    for (const entry of readdirSync(userSkills)) {
      const dest = join(managedSkills, entry);
      if (lstatSync(dest, { throwIfNoEntry: false }) !== undefined) {
        report.skipped.push({ item: `skills/${entry}`, reason: 'already present in managed home' });
        continue;
      }
      try {
        cpSync(join(userSkills, entry), dest, { recursive: true, verbatimSymlinks: true });
        report.copied.push(`skills/${entry}`);
      } catch (error) {
        report.failed.push({
          item: `skills/${entry}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const managedClaudeJsonPath = join(claudeHome, '.claude.json');
  const managedClaudeJson = readJsonObject(managedClaudeJsonPath) ?? {};
  const managedServers = serverBag(managedClaudeJson.mcpServers);
  const daemonMcpPath = join(cairnHome, 'mcp.json');
  const daemonMcpJson = readJsonObject(daemonMcpPath) ?? {};
  const daemonServers = serverBag(daemonMcpJson.mcpServers);
  let claudeJsonChanged = false;
  let daemonMcpChanged = false;

  const addServer = (name: string, entry: unknown, source: string): void => {
    const inClaude = Object.hasOwn(managedServers, name);
    const inDaemon = Object.hasOwn(daemonServers, name);
    if (inClaude && inDaemon) {
      report.skipped.push({
        item: `${source}:mcp/${name}`,
        reason: 'already present in managed config',
      });
      return;
    }
    if (!inClaude) {
      managedServers[name] = entry;
      claudeJsonChanged = true;
    }
    if (!inDaemon) {
      daemonServers[name] = entry;
      daemonMcpChanged = true;
    }
    report.copied.push(`${source}:mcp/${name}`);
  };

  const userClaudeJsonPath = join(realHome, '.claude.json');
  if (!existsSync(userClaudeJsonPath)) {
    report.skipped.push({ item: userClaudeJsonPath, reason: 'no user .claude.json' });
  } else {
    const parsed = readJsonObject(userClaudeJsonPath);
    if (parsed === null) {
      report.failed.push({ item: userClaudeJsonPath, reason: 'unreadable or not a JSON object' });
    } else {
      for (const { key, entry } of parseClaudeMcpEntries(parsed)) {
        addServer(key, entry, 'claude.json');
      }
    }
  }

  const codexConfigPath = join(realHome, '.codex', 'config.toml');
  if (!existsSync(codexConfigPath)) {
    report.skipped.push({ item: codexConfigPath, reason: 'no codex config.toml' });
  } else {
    let codex: z.infer<typeof codexConfigSchema>;
    try {
      const parsed = codexConfigSchema.safeParse(parseToml(readFileSync(codexConfigPath, 'utf8')));
      codex = parsed.success ? parsed.data : { mcp_servers: undefined };
      if (!parsed.success)
        report.failed.push({ item: codexConfigPath, reason: 'unexpected TOML shape' });
    } catch (error) {
      codex = { mcp_servers: undefined };
      report.failed.push({
        item: codexConfigPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    for (const [name, raw] of Object.entries(codex.mcp_servers ?? {})) {
      const server = codexMcpServerSchema.safeParse(raw);
      if (!server.success) {
        report.failed.push({ item: `codex:mcp/${name}`, reason: 'unrecognized server shape' });
        continue;
      }
      const s = server.data;
      if (typeof s.command === 'string' && s.command.length > 0) {
        const envOut: Record<string, string> = { ...(s.env ?? {}) };
        let missingVar = false;
        for (const varName of s.env_vars ?? []) {
          const value = env[varName];
          if (value === undefined || varName.startsWith('CAIRN_')) {
            report.skipped.push({
              item: `codex:mcp/${name}`,
              reason:
                value === undefined
                  ? `env var ${varName} is not set`
                  : `env var ${varName} is daemon-scoped`,
            });
            missingVar = true;
            break;
          }
          envOut[varName] = value;
        }
        if (missingVar) continue;
        addServer(
          name,
          {
            command: s.command,
            ...(s.args !== undefined ? { args: s.args } : {}),
            ...(Object.keys(envOut).length > 0 ? { env: envOut } : {}),
          },
          'codex',
        );
      } else if (typeof s.url === 'string' && s.url.length > 0) {
        const headers: Record<string, string> = { ...(s.http_headers ?? {}) };
        if (s.bearer_token_env_var !== undefined) {
          const token = env[s.bearer_token_env_var];
          if (token === undefined || s.bearer_token_env_var.startsWith('CAIRN_')) {
            report.skipped.push({
              item: `codex:mcp/${name}`,
              reason:
                token === undefined
                  ? `env var ${s.bearer_token_env_var} is not set`
                  : `env var ${s.bearer_token_env_var} is daemon-scoped`,
            });
            continue;
          }
          headers.Authorization = `Bearer ${token}`;
        }
        addServer(
          name,
          {
            url: s.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
          'codex',
        );
      } else {
        report.skipped.push({
          item: `codex:mcp/${name}`,
          reason: 'no command or url field',
        });
      }
    }
  }

  if (claudeJsonChanged || !existsSync(managedClaudeJsonPath)) {
    managedClaudeJson.mcpServers = managedServers;
    try {
      writeJson(managedClaudeJsonPath, managedClaudeJson);
    } catch (error) {
      report.failed.push({
        item: managedClaudeJsonPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (daemonMcpChanged) {
    daemonMcpJson.mcpServers = daemonServers;
    try {
      writeJson(daemonMcpPath, daemonMcpJson);
    } catch (error) {
      report.failed.push({
        item: daemonMcpPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const userSettingsPath = join(realHome, '.claude', 'settings.json');
  if (!existsSync(userSettingsPath)) {
    report.skipped.push({ item: userSettingsPath, reason: 'no user settings.json' });
  } else {
    const settings = readJsonObject(userSettingsPath);
    if (settings === null) {
      report.failed.push({
        item: userSettingsPath,
        reason: 'unreadable or not a JSON object',
      });
    } else {
      const managedSettingsPath = join(claudeHome, 'settings.json');
      const managedSettings = readJsonObject(managedSettingsPath) ?? {};
      let changed = false;
      if (typeof settings.model === 'string' && managedSettings.model === undefined) {
        managedSettings.model = settings.model;
        changed = true;
        report.copied.push('settings:model');
      }
      const envSource =
        settings.env !== null && typeof settings.env === 'object' && !Array.isArray(settings.env)
          ? (settings.env as Record<string, unknown>)
          : {};
      const managedEnv =
        managedSettings.env !== null &&
        typeof managedSettings.env === 'object' &&
        !Array.isArray(managedSettings.env)
          ? { ...(managedSettings.env as Record<string, unknown>) }
          : {};
      for (const [key, value] of Object.entries(envSource)) {
        if (typeof value !== 'string') continue;
        if (SECRET_KEY.test(key)) {
          report.skipped.push({ item: `settings:env/${key}`, reason: 'secret-like name' });
          continue;
        }
        if (managedEnv[key] !== undefined) {
          report.skipped.push({ item: `settings:env/${key}`, reason: 'already present' });
          continue;
        }
        managedEnv[key] = value;
        changed = true;
        report.copied.push(`settings:env/${key}`);
      }
      if (Object.keys(managedEnv).length > 0) managedSettings.env = managedEnv;
      if (changed) {
        try {
          writeJson(managedSettingsPath, managedSettings);
        } catch (error) {
          report.failed.push({
            item: managedSettingsPath,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  try {
    mkdirSync(join(cairnHome, 'imports'), { recursive: true });
    writeJson(markerPath(cairnHome), { version: IMPORT_VERSION, at: Date.now(), ...report });
  } catch {
    return report;
  }
  return report;
}
