import { homedir } from 'node:os';
import type { BoundGitCredentials } from '@cairn/shared';
import { createTempEnvironment } from '@cairn/shared/temp-environment';
import { claudeConfigDir, prepareAntigravityHome, prepareGeminiHome } from './agent-config.js';
import { gitCredentialEnv } from './git.js';

const READONLY_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'url.cairn-readonly-workspace-denied://.pushInsteadOf',
  GIT_CONFIG_VALUE_0: '',
};

export interface StepEnvInput {
  inherited: Record<string, string> | undefined;
  temporary: Record<string, string>;
  git: BoundGitCredentials | null;
  appCredential: { env(): Record<string, string> } | null;
  readonlyGit: boolean;
  runtimeId: string | null;
  agentConfig: { cairnHome: string; realHome?: string };
  claudeSubscriptionToken: string | undefined;
  claudeCodeCoordinator?: boolean;
  devinToken?: string;
  devinHome?: string;
  antigravityToken?: string;
}

export interface StepEnv {
  env: Record<string, string>;
  dropGitCredentials: () => void;
}

export function assembleStepEnv(input: StepEnvInput): StepEnv {
  const gitEnv: Record<string, string> =
    input.git === null
      ? {}
      : (input.appCredential?.env() ?? {
          ...Object.fromEntries(
            Object.entries(gitCredentialEnv(input.git)).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
          GH_TOKEN: input.git.password,
          GITHUB_TOKEN: input.git.password,
        });
  const env: Record<string, string> = {
    ...input.inherited,
    ...input.temporary,
    ...gitEnv,
    ...(input.readonlyGit ? READONLY_GIT_ENV : {}),
  };
  if (input.appCredential !== null) {
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    delete env.CAIRN_GIT_CRED_PASSWORD;
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  if (input.claudeCodeCoordinator === true) env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS = '100000';
  if (input.claudeSubscriptionToken !== undefined) {
    env.CLAUDE_CODE_OAUTH_TOKEN = input.claudeSubscriptionToken;
    if (input.inherited?.CAIRN_ORB !== '1') env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  }
  delete env.WINDSURF_API_KEY;
  if (input.devinToken !== undefined) env.WINDSURF_API_KEY = input.devinToken;
  if (input.runtimeId === 'devin') {
    for (const key of Object.keys(env)) {
      if (key.startsWith('CHISEL_') || key.startsWith('DEVIN_')) delete env[key];
    }
  }
  delete env.GEMINI_API_KEY;
  if (input.antigravityToken !== undefined) env.GEMINI_API_KEY = input.antigravityToken;
  if (input.inherited?.CAIRN_ORB !== '1') Object.assign(env, isolatedConfigEnv(input));
  return {
    env,
    dropGitCredentials: () => {
      for (const key of Object.keys(gitEnv)) {
        delete env[key];
        delete gitEnv[key];
      }
    },
  };
}

function isolatedConfigEnv(input: StepEnvInput): Record<string, string> {
  const { cairnHome } = input.agentConfig;
  const realHome = input.agentConfig.realHome ?? homedir();
  switch (input.runtimeId) {
    case 'claude-code':
      return { CLAUDE_CONFIG_DIR: claudeConfigDir(cairnHome) };
    case 'devin':
      return input.devinHome === undefined ? {} : { HOME: input.devinHome };
    case 'antigravity':
      return {
        HOME: prepareAntigravityHome({
          cairnHome,
          realHome,
          apiKey: input.antigravityToken !== undefined,
        }),
      };
    case 'gemini':
      return { GEMINI_CLI_HOME: prepareGeminiHome({ cairnHome, realHome }) };
    default:
      return {};
  }
}

export function prepareStepEnv(
  input: Omit<StepEnvInput, 'temporary'>,
  cleanups: (() => void | Promise<void>)[],
): { env: Record<string, string> } | { error: string } {
  let temporary: ReturnType<typeof createTempEnvironment>;
  try {
    temporary = createTempEnvironment({ ...process.env, ...input.inherited });
  } catch (error) {
    return {
      error: `Temporary directory setup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  cleanups.push(temporary.cleanup);
  let assembled: StepEnv;
  try {
    assembled = assembleStepEnv({ ...input, temporary: temporary.env });
  } catch (error) {
    return {
      error: `Agent config directory setup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const { env, dropGitCredentials } = assembled;
  cleanups.push(dropGitCredentials);
  return { env };
}
