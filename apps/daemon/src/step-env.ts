import type { BoundGitCredentials } from '@cairn/shared';
import { createTempEnvironment } from '@cairn/shared/temp-environment';
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
  claudeSubscriptionToken: string | undefined;
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
  if (input.claudeSubscriptionToken !== undefined) {
    env.CLAUDE_CODE_OAUTH_TOKEN = input.claudeSubscriptionToken;
    if (input.inherited?.CAIRN_ORB !== '1') env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
  }
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
  const { env, dropGitCredentials } = assembleStepEnv({ ...input, temporary: temporary.env });
  cleanups.push(dropGitCredentials);
  return { env };
}
