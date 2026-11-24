import { homedir } from 'node:os';
import { antigravityOAuthStepCredentialSchema, type BoundGitCredentials } from '@cairn/shared';
import { createCredentialProfile } from '@cairn/shared/credential-profile';
import { createTempEnvironment } from '@cairn/shared/temp-environment';
import {
  antigravityFileStorageEnv,
  claudeConfigDir,
  prepareAntigravityHome,
  prepareGeminiHome,
  writeAntigravityOAuthCredential,
} from './agent-config.js';
import { gitCredentialEnv } from './git.js';

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const AMBIENT_GOOGLE_AUTH = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'AGY_ACP_CCPA_PROJECT',
  'AGY_ACP_ENABLE_OAUTH',
  'BROWSER',
]);

export const READONLY_GIT_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'url.cairn-readonly-workspace-denied://.pushInsteadOf',
  GIT_CONFIG_VALUE_0: '',
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_CONFIG_SYSTEM: NULL_DEVICE,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'false',
  SSH_ASKPASS: 'false',
  GIT_SSH_COMMAND: 'false',
  SSH_AUTH_SOCK: '',
  SSH_AGENT_PID: '',
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
  cleanupProfile?: () => void;
}

export function assembleStepEnv(input: StepEnvInput): StepEnv {
  const gitEnv: Record<string, string> =
    input.git === null || input.readonlyGit
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
  delete env.CAIRN_ANTIGRAVITY_AUTH_MODE;
  delete env.AGY_CLI_FORCE_FILE_TOKEN_STORAGE;
  delete env.AGY_ACP_FORCE_FILE_STORAGE;
  let cleanupProfile: (() => void) | undefined;
  if (input.runtimeId === 'antigravity' && input.antigravityToken?.startsWith('{')) {
    let credential: ReturnType<typeof antigravityOAuthStepCredentialSchema.parse>;
    try {
      credential = antigravityOAuthStepCredentialSchema.parse(JSON.parse(input.antigravityToken));
    } catch {
      throw new Error('Invalid Antigravity OAuth credential');
    }
    for (const key of Object.keys(env)) {
      if (AMBIENT_GOOGLE_AUTH.has(key.toUpperCase())) delete env[key];
    }
    if (
      credential.refreshToken === undefined &&
      (credential.expiresAt === undefined || credential.expiresAt <= Date.now())
    )
      throw new Error('Antigravity OAuth access token expired');
    const profile = createCredentialProfile(input.agentConfig.cairnHome);
    try {
      writeAntigravityOAuthCredential(profile.home, credential, input.agentConfig.cairnHome);
      Object.assign(env, profile.env, antigravityFileStorageEnv(profile.home));
      cleanupProfile = profile.cleanup;
    } catch (error) {
      profile.cleanup();
      throw error;
    }
    env.CAIRN_ANTIGRAVITY_AUTH_MODE = 'oauth-personal';
  } else {
    if (input.antigravityToken !== undefined) env.GEMINI_API_KEY = input.antigravityToken;
    if (input.runtimeId === 'antigravity') {
      env.CAIRN_ANTIGRAVITY_AUTH_MODE =
        input.antigravityToken === undefined ? 'host' : 'gemini-api-key';
    }
    if (input.inherited?.CAIRN_ORB !== '1') Object.assign(env, isolatedConfigEnv(input));
  }
  return {
    env,
    cleanupProfile,
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
  const { env, dropGitCredentials, cleanupProfile } = assembled;
  if (cleanupProfile !== undefined) cleanups.push(cleanupProfile);
  cleanups.push(dropGitCredentials);
  return { env };
}
