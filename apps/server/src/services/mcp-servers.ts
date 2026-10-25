import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_CONFIG_FILE_NAME,
  type McpServerRecord,
  parseClaudeMcpEntries,
} from '@cairn/shared';

export interface McpServerDeps {
  mcpConfigPath: string;
}

export function defaultMcpConfigPath(): string {
  return join(homedir(), CLAUDE_CONFIG_FILE_NAME);
}

export interface ClaudeMcpRead {
  records: Omit<McpServerRecord, 'teamId' | 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>[];
  mtimeMs: number;
}

export function readClaudeMcpServers(path: string): ClaudeMcpRead {
  let text: string;
  let mtimeMs: number;
  try {
    text = readFileSync(path, 'utf8');
    mtimeMs = Math.floor(statSync(path).mtimeMs);
  } catch {
    return { records: [], mtimeMs: 0 };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { records: [], mtimeMs };
  }
  const records: ClaudeMcpRead['records'] = [];
  for (const { key, slug, entry } of parseClaudeMcpEntries(json)) {
    if ('command' in entry) {
      const credentialKeys = Object.keys(entry.env ?? {});
      records.push({
        label: key,
        slug,
        transport: 'stdio',
        url: entry.command,
        hasCredential: credentialKeys.length > 0,
        credentialKeys,
      });
      continue;
    }
    const credentialKeys = Object.keys(entry.headers ?? {});
    records.push({
      label: key,
      slug,
      transport: 'http',
      url: entry.url,
      hasCredential: credentialKeys.length > 0,
      credentialKeys,
    });
  }
  return { records, mtimeMs };
}

export function listMcpServers(deps: McpServerDeps, teamId: string): McpServerRecord[] {
  const { records, mtimeMs } = readClaudeMcpServers(deps.mcpConfigPath);
  return records.map((r) => ({
    ...r,
    teamId,
    id: r.slug,
    createdBy: '',
    createdAt: mtimeMs,
    updatedAt: mtimeMs,
  }));
}
