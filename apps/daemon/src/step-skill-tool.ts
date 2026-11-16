import type { ClaimedStep, LocalToolDef, McpConnectorEndpoint, McpEndpoint } from '@cairn/shared';
import {
  notInConfigLine,
  resolveMcpEndpoints,
  shadowedLocalLine,
  withheldConnectorLine,
} from './backend/mcp-config.js';
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

export interface StepMcpConnectors {
  connectors?: readonly McpConnectorEndpoint[] | undefined;
  withheld?: readonly string[] | undefined;
}

export function stepMcpEndpoints(
  configPath: Parameters<typeof resolveMcpEndpoints>[0],
  claimedMcp: string[] | undefined,
  log: (line: string) => void,
  fromServer: StepMcpConnectors = {},
): McpEndpoint[] {
  const slugs = claimedMcp ?? [];
  const connectorBySlug = new Map(
    (fromServer.connectors ?? []).map((c) => [c.slug.toLowerCase(), c] as const),
  );
  const withheld = new Set((fromServer.withheld ?? []).map((slug) => slug.toLowerCase()));
  const local = new Map(
    resolveMcpEndpoints(configPath, slugs).map((e) => [e.slug.toLowerCase(), e] as const),
  );
  const endpoints: McpEndpoint[] = [];
  const fromFile: string[] = [];
  const fromConnectors: string[] = [];
  for (const slug of slugs) {
    const key = slug.toLowerCase();
    const connector = connectorBySlug.get(key);
    const entry = local.get(key);
    if (connector !== undefined) {
      endpoints.push({ ...connector, slug });
      fromConnectors.push(slug);
      if (entry !== undefined) log(shadowedLocalLine(slug, configPath));
    } else if (withheld.has(key)) {
      log(withheldConnectorLine(slug));
    } else if (entry !== undefined) {
      endpoints.push(entry);
      fromFile.push(slug);
    } else {
      log(notInConfigLine(slug));
    }
  }
  if (claimedMcp === undefined) return endpoints;
  if (slugs.length === 0) {
    log('managed-empty: strict MCP set (runtime config not inherited)');
    return endpoints;
  }
  const connectorsPart =
    fromConnectors.length > 0 ? `; from connectors: ${fromConnectors.join(', ')}` : '';
  log(
    `loaded from ${configPath}: ${fromFile.length > 0 ? fromFile.join(', ') : '(none)'}${connectorsPart}`,
  );
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
