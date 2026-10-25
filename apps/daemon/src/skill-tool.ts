import { readFile } from 'node:fs/promises';
import type { LocalToolDef } from '@cairn/shared';

export const SKILL_TOOL_NAME = 'Skill';

export interface SkillLoadToolOpts {
  skillFileMap: ReadonlyMap<string, string>;
  onInvoke?: (name: string) => void;
}

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
