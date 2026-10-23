// MCP 本地 config 面（spec 13/#368）：来源 = 本机 `~/.claude.json` 的
// mcpServers 段，server 读本机投影供 UI 展示（只读制）。登记制管理面
// （CRUD + SecretBox headers 密文 + claim 端点解析）随 mcp_server 表删除——
// claim 只携 slug 列表，端点解析权在执行 daemon（daemon backend/mcp-config
// 缝，各读各机：stdio 命令在真正的执行机上起，语义随机器正确）。
//
// 安全不变量（spec 13 凭证面收窄）：env/headers 密钥值永不出 server——
// 读取缝解析即剥值，record 投影只携带 hasCredential/credentialKeys 键名；
// wire 形状里没有值槽位，即便未来 bug 想透传也无从携带。

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_CONFIG_FILE_NAME,
  type McpServerRecord,
  parseClaudeMcpEntries,
} from '@cairn/shared';

export interface McpServerDeps {
  /** 本机 config 读路径（AppContext.mcpConfigPath 注入；默认 ~/.claude.json，
   *  CAIRN_MCP_CONFIG 可覆盖——config.ts 单源）。 */
  mcpConfigPath: string;
}

/** 默认读路径（chief-tools deps 缺省回落位；与 config.ts / daemon config
 * 的默认同源 = shared CLAUDE_CONFIG_FILE_NAME）。 */
export function defaultMcpConfigPath(): string {
  return join(homedir(), CLAUDE_CONFIG_FILE_NAME);
}

/** 读取缝产出 = 已剥值的部分 record + 文件 mtime（record 时间戳源）。 */
export interface ClaudeMcpRead {
  records: Omit<McpServerRecord, 'teamId' | 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>[];
  mtimeMs: number;
}

/** 读 `~/.claude.json` mcpServers 段（单 config 形状；解析与归一律单源 =
 * shared parseClaudeMcpEntries，daemon 执行面同函数）。容忍律（spec 13
 * premortem 护栏一）：文件不存在 / 坏 JSON / 无 mcpServers 键 = 空集不抛；
 * 条目级校验失败 = 跳过该条不殃及其它。 */
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
    // 值剥离点：env/headers 只取键名——密钥值不出本函数。stdio 的 url 槽 =
    // command 预览（spec 13 数据契约；mapMcpServers 消费面保持现状）。
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

/** GET /api/teams/{id}/mcp-servers 投影：record 形状保形（web 零学习成本，
 * mcpServerRecordSchema 单源）。teamId = 保形槽（config 按机器不按团队，
 * 对 scoping 是 no-op）；id = slug（config 键即稳定标识）；createdBy 无
 * 语义（本地文件无创建者）= 空串；时间戳 = 文件 mtime（页面相对时间列 =
 * config 最近修改）。 */
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
