import type { ClaimedStep, LocalToolDef } from '@cairn/shared';
import { notInConfigLine, resolveMcpEndpoints } from './backend/mcp-config.js';
import {
  collectVisibleSkillFileMap,
  collectVisibleSkillNames,
  piWorktreeSkillDirs,
  type SkillsCatalogOpts,
  withSkillDispatchDirectives,
} from './backend/skills.js';
import { buildSkillLoadTool } from './skill-tool.js';

type StepAgent = NonNullable<ClaimedStep['agent']>;

export function sessionInjectedSkills(
  agent: Pick<StepAgent, 'injectedSkills' | 'defaultSkill'>,
): StepAgent['injectedSkills'] {
  return agent.injectedSkills === undefined || agent.defaultSkill == null
    ? agent.injectedSkills
    : [agent.defaultSkill, ...agent.injectedSkills.filter((id) => id !== agent.defaultSkill)];
}

export function stepMcpEndpoints(
  configPath: Parameters<typeof resolveMcpEndpoints>[0],
  claimedMcp: string[] | undefined,
  log: (line: string) => void,
): ReturnType<typeof resolveMcpEndpoints> {
  const slugs = claimedMcp ?? [];
  const endpoints =
    slugs.length > 0
      ? resolveMcpEndpoints(configPath, slugs, {
          onMissing: (slug) => log(notInConfigLine(slug)),
        })
      : [];
  if (claimedMcp !== undefined) {
    log(
      slugs.length > 0
        ? `loaded from ${configPath}: ${
            endpoints.length > 0 ? endpoints.map((e) => e.slug).join(', ') : '(none)'
          }`
        : 'managed-empty: strict MCP set (runtime config not inherited)',
    );
  }
  return endpoints;
}

export interface SkillLoadToolInput {
  skillsDir: string;
  home: string;
  cwd: string;
  isChief: boolean;
  skillsAllowlist: StepAgent['skillsAllowlist'];
  injectedSkills: StepAgent['injectedSkills'];
  teamSkillsDir: string | null;
  log: (msg: string) => void;
}

export function prepareSkillLoadTool(input: SkillLoadToolInput): {
  tool: LocalToolDef;
  withDispatch: (prompt: string) => string;
} {
  const skillScanOpts: SkillsCatalogOpts = {
    skillsDir: input.skillsDir,
    cwd: input.home,
    ...(!input.isChief && input.skillsAllowlist != null
      ? { allowlist: input.skillsAllowlist }
      : {}),
    ...(!input.isChief && input.injectedSkills !== undefined
      ? { injectedSkills: input.injectedSkills }
      : {}),
    ...(input.teamSkillsDir !== null ? { teamSkillsDir: input.teamSkillsDir } : {}),
    worktreeSkillsDirs: piWorktreeSkillDirs(input.cwd),
    log: input.log,
  };
  const tool = buildSkillLoadTool({
    skillFileMap: collectVisibleSkillFileMap(skillScanOpts),
    onInvoke: (name) => input.log(`invoke: ${name}`),
  });
  return {
    tool,
    withDispatch: (prompt) =>
      withSkillDispatchDirectives(prompt, collectVisibleSkillNames(skillScanOpts), input.log),
  };
}
