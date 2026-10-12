// 机器能力探测（#1251 / ADR 0018 决策 4.1）：daemon 注册/心跳随行的能力
// 清单——已装 MCP server slug 集（本机 `~/.claude.json`，config.mcpConfigPath）
// + 本机技能目录名集（config.skillsDir）。模型二进制与档位不在这里重复探测：
// claude-code 面已随同一心跳上行（claude-code-models/bin/auth 三探针，
// machine.claudeCodeReport 列），server 侧能力视图两列合并。
//
// 缝纪律：slug 归一单源 = shared parseClaudeMcpEntries（server 投影面
// services/mcp-servers.ts 与 daemon 执行面 backend/mcp-config.ts 的同一份
// 规则）；本模块只取名字集合，不解析端点、不触凭证（端点解析权仍在
// backend/mcp-config 缝，按步消费）。技能名 = 含 SKILL.md 的一级子目录名
// （盘位事实）；frontmatter id 解析归 server 投影面（services/skills.ts），
// 上报面不造第二真值。
//
// 容忍律（claude-code-bin.ts「探测不许把 presence 节拍或上线序列搞挂」同律，
// 02 §5.4 心跳红线的 daemon 半边）：任何源缺失/不可读/坏 JSON = 该维空集，
// 永不 throw。
//
// 节拍成本：`~/.claude.json` 可达数 MB（Claude Code 自身状态同文件），30s
// 一拍全文重解析是纯浪费——createMachineCapabilitiesProbe 按源 mtime 缓存，
// 未变不重读；ENOENT 视同「变为空」（消失是事实），其余 stat 失败保守沿用
// 旧值（瞬态权限/IO 抖动不打翻上报）。已知近似：既有技能子目录内新落
// SKILL.md 只改子目录 mtime，不改扫描根 mtime——下一拍根目录任何变更即
// 补齐（能力上报是增强信号，分钟级滞后无害）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type MachineCapabilities, parseClaudeMcpEntries } from '@pacman/shared';

/** 探测源两位（daemon config 直取：mcpConfigPath / skillsDir）。 */
export interface MachineCapabilitySources {
  mcpConfigPath: string;
  skillsDir: string;
}

/** 本机 MCP config → 已装 slug 集（小写归一 + 排序；坏条目由
 *  parseClaudeMcpEntries 条目级跳过）。文件缺失/坏 JSON = 空集。 */
function scanMcpSlugs(mcpConfigPath: string): string[] {
  try {
    const json: unknown = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
    return [...new Set(parseClaudeMcpEntries(json).map((e) => e.slug))].sort();
  } catch {
    return [];
  }
}

/** 技能根 → 含 SKILL.md 的一级子目录名集（排序；符号链接目录同算——盘位
 *  事实以路径可达为准）。根缺失/不可读 = 空集；单目录判定失败 = 跳过。 */
function scanSkillNames(skillsDir: string): string[] {
  let entryNames: string[];
  try {
    entryNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const name of entryNames) {
    try {
      if (statSync(join(skillsDir, name, 'SKILL.md')).isFile()) names.push(name);
    } catch {
      // 无 SKILL.md / 不可达 = 不是技能位，跳过。
    }
  }
  return names.sort();
}

/** 一次性探测（enroll 前 / 测试直用）：全函数，永不 throw。 */
export function probeMachineCapabilities(sources: MachineCapabilitySources): MachineCapabilities {
  return {
    mcpServers: scanMcpSlugs(sources.mcpConfigPath),
    skills: scanSkillNames(sources.skillsDir),
  };
}

/** mtime 缓存的节拍探测器（presence 30s 拍直用）：源未变 → 复用上次结果；
 *  变化（含 ENOENT 消失）→ 重扫；非 ENOENT 的 stat 失败 → 沿用旧值（无旧值
 *  则现场探一次）。返回对象每次新建，数组来自缓存——调用方只读序列化。 */
export function createMachineCapabilitiesProbe(
  sources: MachineCapabilitySources,
): () => MachineCapabilities {
  let mcpCache: { mtimeMs: number; value: string[] } | null = null;
  let skillsCache: { mtimeMs: number; value: string[] } | null = null;

  /** 源 mtime：ENOENT → 0（视同变更，重扫出空集）；其余失败 → null（沿用）。 */
  const mtimeOf = (path: string): number | null => {
    try {
      return statSync(path).mtimeMs;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
    }
  };

  return () => {
    const mcpMtime = mtimeOf(sources.mcpConfigPath);
    if (mcpMtime !== null && (mcpCache === null || mcpCache.mtimeMs !== mcpMtime)) {
      mcpCache = { mtimeMs: mcpMtime, value: scanMcpSlugs(sources.mcpConfigPath) };
    }
    if (mcpCache === null) {
      mcpCache = { mtimeMs: Number.NaN, value: scanMcpSlugs(sources.mcpConfigPath) };
    }
    const skillsMtime = mtimeOf(sources.skillsDir);
    if (skillsMtime !== null && (skillsCache === null || skillsCache.mtimeMs !== skillsMtime)) {
      skillsCache = { mtimeMs: skillsMtime, value: scanSkillNames(sources.skillsDir) };
    }
    if (skillsCache === null) {
      skillsCache = { mtimeMs: Number.NaN, value: scanSkillNames(sources.skillsDir) };
    }
    return { mcpServers: mcpCache.value, skills: skillsCache.value };
  };
}
