import { readFileSync } from 'node:fs';
import type { McpEndpoint } from '@cairn/shared';
import {
  type ClaudeMcpEntry,
  MCP_CONNECT_FAILED_CANON,
  MCP_NOT_IN_CONFIG_CANON,
  parseClaudeMcpEntries,
} from '@cairn/shared';

export interface ResolveMcpOpts {
  onMissing?: (slug: string) => void;
}

function readEntryTable(configPath: string): Map<string, ClaudeMcpEntry> {
  const table = new Map<string, ClaudeMcpEntry>();
  try {
    const json: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    for (const { slug, entry } of parseClaudeMcpEntries(json)) {
      table.set(slug, entry);
    }
  } catch {}
  return table;
}

function toEndpoint(slug: string, entry: ClaudeMcpEntry): McpEndpoint {
  return 'command' in entry
    ? {
        slug,
        transport: 'stdio',
        command: entry.command,
        ...(entry.args ? { args: entry.args } : {}),
        ...(entry.env ? { env: entry.env } : {}),
      }
    : {
        slug,
        transport: 'http',
        url: entry.url,
        ...(entry.headers ? { headers: entry.headers } : {}),
      };
}

export function resolveMcpEndpoints(
  configPath: string,
  slugs: readonly string[],
  opts: ResolveMcpOpts = {},
): McpEndpoint[] {
  if (slugs.length === 0) return [];
  const table = readEntryTable(configPath);
  const endpoints: McpEndpoint[] = [];
  for (const slug of slugs) {
    const entry = table.get(slug.toLowerCase());
    if (!entry) {
      opts.onMissing?.(slug);
      continue;
    }
    endpoints.push(toEndpoint(slug, entry));
  }
  return endpoints;
}

export function notInConfigLine(slug: string): string {
  return `${slug}: ${MCP_NOT_IN_CONFIG_CANON}`;
}

export function connectFailedLine(slug: string, reason: string): string {
  return `${slug}: ${MCP_CONNECT_FAILED_CANON}: ${reason}`;
}
