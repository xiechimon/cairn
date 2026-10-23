// 本机 MCP config 解析缝（spec 13/#368）：claim 载荷 mcpServers = slug 列表
// → 读本机 `~/.claude.json`（config.mcpConfigPath）解析 McpEndpoint[] →
// 喂 pi 原生 MCP（backend/pi.ts registerMcpServer，#930）。
// 缝纪律：归 backend/（MCP provider 缝）——runner 经本模块消费，不直接触
// config 文件形状；解析与归一律单源 = shared parseClaudeMcpEntries（server
// 投影面同一份消费形状与规则）。
// 凭证边界：env/headers 值只存在于执行机 config 文件 → 子进程环境/请求头，
// 从不跨 wire、从不落 cairn 状态目录。
// 容忍律（与 server 读取缝同律）：文件缺失/坏 JSON = 空集；条目级校验失败 =
// 跳过该条；未知 slug = 跳过 + onMissing 降级行回调。

import { readFileSync } from 'node:fs';
import type { McpEndpoint } from '@cairn/shared';
import {
  type ClaudeMcpEntry,
  MCP_CONNECT_FAILED_CANON,
  MCP_NOT_IN_CONFIG_CANON,
  parseClaudeMcpEntries,
} from '@cairn/shared';

export interface ResolveMcpOpts {
  /** 「config 里找不到」降级行出口（runner 接 logger.mcp；缺省 = 静默）。 */
  onMissing?: (slug: string) => void;
}

/** 本机 config → slug 条目表。解析与归一律单源 = shared
 * parseClaudeMcpEntries（server 投影面同函数——slug 匹配契约不随任一侧
 * 漂移）；文件缺失 / 坏 JSON = 空表，不炸回合。 */
function readEntryTable(configPath: string): Map<string, ClaudeMcpEntry> {
  const table = new Map<string, ClaudeMcpEntry>();
  try {
    const json: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    for (const { slug, entry } of parseClaudeMcpEntries(json)) {
      table.set(slug, entry);
    }
  } catch {
    // 空表兜底（premortem 护栏一）。
  }
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

/** claim slug 列表 → 本机端点集。匹配大小写不敏感（server 投影把 config 键
 * 小写化成 slug，agent 勾选存的即该 slug；执行侧按键归一找回原条目）。 */
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
      // 未知 slug / 坏条目 / 坏文件统一走「config 里找不到」降级：勾选与
      // 配置漂移、多机各读各 config 的跑偏都落这一行，不炸回合。
      opts.onMissing?.(slug);
      continue;
    }
    endpoints.push(toEndpoint(slug, entry));
  }
  return endpoints;
}

/** canon 降级行文本（MCP_CONNECT_FAILED_CANON 族扩展；`[mcp] ` 前缀由
 * logger.mcp 落，与 connectFailedLine 同律）。 */
export function notInConfigLine(slug: string): string {
  return `${slug}: ${MCP_NOT_IN_CONFIG_CANON}`;
}

/** canon 连接失败行文本（r3 §1.5 实测行形 `[mcp] <slug>: connect failed —
 * its tools are unavailable this turn: <reason>`；前缀由 logger.mcp 落）。
 * #930 起来源两路：注册期 registerMcpServer 抛错（非法名/非法 config）、
 * 连接期 pi MCP 扩展的 attention 通知解析（backend/pi.ts）。 */
export function connectFailedLine(slug: string, reason: string): string {
  return `${slug}: ${MCP_CONNECT_FAILED_CANON}: ${reason}`;
}
