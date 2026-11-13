import type { LocalToolDef } from '@cairn/shared';
import { type PrepareWebToolsOpts, prepareWebTools } from './backend/web-search.js';
import { buildSecretTool, type SecretChannelOpts } from './secret-channel.js';
import { prepareCreateTagTool } from './step-git-tools.js';
import { prepareSkillLoadTool, type SkillLoadToolInput } from './step-skill-tool.js';

export interface StepLocalTools {
  tools: LocalToolDef[];
  dispatch: (prompt: string) => string;
}

export function assembleStepLocalTools(input: {
  web: PrepareWebToolsOpts;
  secrets: Omit<SecretChannelOpts, 'creds'> | null;
  createTag: Parameters<typeof prepareCreateTagTool>[0];
  skillLoad: SkillLoadToolInput | null;
}): StepLocalTools {
  const webTools = prepareWebTools(input.web);
  const secretTool =
    input.secrets === null
      ? null
      : buildSecretTool({ ...input.secrets, creds: webTools.secretCreds });
  const createTagTool = prepareCreateTagTool(input.createTag);
  const tools = [secretTool, createTagTool, ...webTools.tools].filter(
    (t): t is LocalToolDef => t !== null,
  );
  if (input.skillLoad === null) return { tools, dispatch: (prompt) => prompt };
  const skillLoad = prepareSkillLoadTool(input.skillLoad);
  tools.push(skillLoad.tool);
  return { tools, dispatch: skillLoad.withDispatch };
}
