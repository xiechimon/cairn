// Skill 加载工具（#1299）：pi session 专用自定义工具——入参 skill name
// → 校验在可见集 → 返回 SKILL.md 全文 + [skills] invoke 日志。claude-code
// 后端不注册本工具（其原生 Skill 机制已可观测）。
// 参照 tag-tool.ts 的 LocalToolDef 缝：daemon 进程内执行，不经 relay。
// 分类单源 shared/skill-facts.ts 已预埋 `Skill` 词（skillCallName 的 Skill
// 分支即识 arguments.skill），本工具参数 shape 与之对齐。

import { readFile } from 'node:fs/promises';
import type { LocalToolDef } from '@cairn/shared';

/** pi Skill 工具名（shared/skill-facts.ts skillCallName 同源）。 */
export const SKILL_TOOL_NAME = 'Skill';

export interface SkillLoadToolOpts {
  /** name → SKILL.md 绝对路径（由调用方扫描 + allowlist/injectedSkills
   * 过滤后传入——与 catalog 同可见面，判据永不漂移）。 */
  skillFileMap: ReadonlyMap<string, string>;
  /** `[skills] invoke: <name>` 日志行出口（daemon logger.skills）。 */
  onInvoke?: (name: string) => void;
}

/** 构造 Skill 加载工具（pi 后端注册为 custom tool）。execute 纯内存查表 +
 * 读文件——不重扫描、不调 loadSkills。 */
export function buildSkillLoadTool(opts: SkillLoadToolOpts): LocalToolDef {
  return {
    name: SKILL_TOOL_NAME,
    label: SKILL_TOOL_NAME,
    description:
      'Load a skill by name. Returns the full SKILL.md text for the named skill. ' +
      'Use this tool to load skills listed in <available_skills> — do NOT use read ' +
      'for skill files. The skill name must be listed in the catalog.',
    parameters: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill name to load (as listed in <available_skills>).',
        },
      },
      required: ['skill'],
    },
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const name = typeof params.skill === 'string' ? params.skill.trim() : '';
      if (name === '') return 'Skill tool needs a non-empty "skill" name.';
      const filePath = opts.skillFileMap.get(name);
      if (filePath === undefined) {
        return (
          `Skill "${name}" not found in the visible skill set. ` +
          `Check <available_skills> for available skills.`
        );
      }
      opts.onInvoke?.(name);
      try {
        return await readFile(filePath, 'utf8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Failed to read SKILL.md for "${name}" (${filePath}): ${msg}`;
      }
    },
  };
}

/** 扫描技能目录 → name → SKILL.md 绝对路径映射（#1299 Skill 工具预扫描面）。
 * 目录不存在/扫描失败 = 空 Map（fail-open——已写入日志行的错误不进映射，
 * 与 catalog 注入面同律）。调用方在此映射之上自行叠加 allowlist /
 * injectedSkills 过滤后再传入 buildSkillLoadTool。 */
export function scanSkillFileMap(
  dirs: string[],
  loadSkills: typeof import('@earendil-works/pi-coding-agent').loadSkills,
  opts: { cwd: string; agentDir: string; log?: (msg: string) => void },
): Map<string, string> {
  try {
    const result = loadSkills({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      skillPaths: dirs,
      includeDefaults: false,
    });
    return new Map(result.skills.map((s) => [s.name, s.filePath]));
  } catch (err) {
    opts.log?.(
      `invalid: skill tool pre-scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Map();
  }
}
