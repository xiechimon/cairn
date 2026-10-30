export const BRAND_SLOTS = {
  cliCommandName: { todosDev: 'tds', replacement: 'cairn' },
  envPrefix: { todosDev: 'TDS_', replacement: 'CAIRN_' },
  homeDir: { todosDev: '~/.tds', replacement: '~/.cairn' },
  workspacesDir: {
    todosDev: '~/.tds/workspaces/<conversationId>',
    replacement: '~/.cairn/workspaces/<conversationId>',
  },
  branchPrefix: { todosDev: 'tds/conv-', replacement: 'cairn/conv-' },
  apiKeyPrefix: { todosDev: 'tds_<48hex>', replacement: 'cairn_<48hex>' },
  machineToken: { todosDev: '64hex（无前缀）', replacement: '保持（非品牌槽）' },
  gitHostDomain: { todosDev: 'git.todos.dev', replacement: '本地主机名代位' },
  remoteMcpPath: { todosDev: '/api/mcp', replacement: '保持（形状无品牌）' },
  cliPackageName: {
    todosDev: '@todos-dev/cli',
    replacement: '@xiechimon/cairn-cli（npm 公发，06 册 W2-D1）',
  },
  deepLinkScheme: { todosDev: 'tds://', replacement: 'cairn://' },
  firstTouchCookie: { todosDev: 'tds_ft', replacement: 'cairn_ft' },
  localStoragePrefix: {
    todosDev: 'tds- / tds.（约 15 键，见 protocol/client-state.ts）',
    replacement: 'cairn- / cairn. 同形替换',
  },
  daemonLog: { todosDev: '~/.tds/daemon.log', replacement: '~/.cairn/daemon.log' },
  sessionCookie: { todosDev: 'tds_session', replacement: 'cairn_session' },
  manifestName: {
    todosDev: 'Todos（manifest name/short_name/apple-mobile-web-app-title）',
    replacement: 'Cairn',
  },
} as const;

export const BRAND = {
  cliCommandName: 'cairn',
  envPrefix: 'CAIRN_',
  homeDirName: '.cairn',
  workspacesDirName: 'workspaces',
  branchPrefix: 'cairn/conv-',
  apiKeyPrefix: 'cairn_',
  remoteMcpPath: '/api/mcp',
  cliPackageName: '@xiechimon/cairn-cli',
  manifestName: 'Cairn',
  sessionCookieName: 'cairn_session',
} as const;

export const ENV_VARS = {
  githubCreateMinIntervalMs: 'CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS',
  githubCreateHourlyCap: 'CAIRN_GITHUB_CREATE_HOURLY_CAP',
  server: 'CAIRN_SERVER',
  apiKey: 'CAIRN_API_KEY',
  team: 'CAIRN_TEAM',
  workspacesDir: 'CAIRN_WORKSPACES_DIR',
  home: 'CAIRN_HOME',
  webDir: 'CAIRN_WEB_DIR',
  githubOauthClientId: 'CAIRN_GITHUB_OAUTH_CLIENT_ID',
  githubOauthClientSecret: 'CAIRN_GITHUB_OAUTH_CLIENT_SECRET',
  token: 'CAIRN_TOKEN',
  requireToken: 'CAIRN_REQUIRE_TOKEN',
  tailscaleUsers: 'CAIRN_TAILSCALE_USERS',
  skillsDir: 'CAIRN_SKILLS_DIR',
  mcpConfig: 'CAIRN_MCP_CONFIG',
  customModelReasoning: 'CAIRN_CUSTOM_MODEL_REASONING',
  piCacheRetention: 'CAIRN_PI_CACHE_RETENTION',
  hookTimeoutMs: 'CAIRN_HOOK_TIMEOUT_MS',
  issueIntake: 'CAIRN_ISSUE_INTAKE',
  scheduling: 'CAIRN_SCHEDULING',
  trajectoryOutcomeBackfill: 'CAIRN_TRAJ_OUTCOME_BACKFILL',
  trajectoryReflectCurate: 'CAIRN_TRAJ_REFLECT_CURATE',
  trajectoryReflectOpenGuardIssues: 'CAIRN_TRAJ_REFLECT_OPEN_GUARD_ISSUES',
} as const;

export const API_KEY_PATTERN = /^cairn_[0-9a-f]{48}$/;

export const MACHINE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function gitHostedRepoPath(teamId: string, repoName: string): string {
  return `/${teamId}/${repoName}`;
}

export function conversationBranch(conversationId: string): string {
  return `${BRAND.branchPrefix}${conversationId}`;
}

export const PUBLISHED_PACKAGES = {
  server: { name: '@xiechimon/cairn', command: 'cairn' },
  cli: { name: '@xiechimon/cairn-cli', command: 'cairn' },
} as const;
