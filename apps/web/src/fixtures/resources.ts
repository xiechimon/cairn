import type { McpConnectorRecord, ModelSource, ProviderRecord } from '@cairn/shared';
import {
  legacyDone,
  legacyReview,
  MACHINE_ID,
  MACHINE_NAME,
  MACHINE_REMOTE_ID,
  MACHINE_REMOTE_NAME,
  r7,
  TEAM_ID,
} from './core.js';
import type { FixtureSet, MachineRow, ResourcesContent } from './records.js';

const PROVIDER_SOURCE_PI: ModelSource = {
  runtime: 'pi',
  installed: true,
  hostname: MACHINE_NAME,
  models: [
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' },
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5（R3 网关）' },
    { id: 'gpt-5.2', name: 'GPT-5.2（R3 网关）' },
  ],
};

const PROVIDER_SOURCE_CC: ModelSource = {
  runtime: 'claude-code',
  installed: true,
  hostname: MACHINE_REMOTE_NAME,
  machineId: MACHINE_REMOTE_ID,
  bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
  auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
  models: [
    { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
    { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
    { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
    { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
  ],
};

function fixtureProvider(
  id: string,
  fields: Pick<ProviderRecord, 'providerId' | 'label' | 'baseUrl' | 'api' | 'models'>,
): ProviderRecord {
  return {
    kind: 'custom',
    id,
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    createdBy: 'u-fixture',
    createdAt: r7(9, 0),
    updatedAt: r7(9, 0),
    ...fields,
  };
}

const PROVIDERS: ProviderRecord[] = [
  fixtureProvider('prov-anthropic', {
    providerId: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }],
  }),
  fixtureProvider('prov-relay', {
    providerId: 'r3-gateway',
    label: 'R3 网关',
    baseUrl: 'https://gateway.example.invalid/v1',
    api: 'openai-completions',
    models: [
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5（R3 网关）' },
      { id: 'gpt-5.2', name: 'GPT-5.2（R3 网关）' },
    ],
  }),
  fixtureProvider('prov-copilot', {
    providerId: 'github-copilot',
    label: 'GitHub Copilot',
    baseUrl: 'https://api.githubcopilot.com',
    api: 'openai-completions',
    models: [{ id: 'gpt-4o', name: 'gpt-4o' }],
  }),
];

export const RESOURCES: ResourcesContent = {
  skills: [{ name: 'code-review', description: '按团队规范审查改动并给出修改建议' }],
  mcpServers: [
    {
      name: 'r3-mcp',
      kind: '远程（HTTP）',
      url: 'https://example.invalid/mcp',
      ago: '2 天前',
    },
  ],
  machines: [
    {
      id: MACHINE_ID,
      kind: 'local',
      name: MACHINE_NAME,
      hostname: MACHINE_NAME,
      online: true,
      enabledRuntimes: ['pi'],
      maxConcurrent: 3,
      runningSteps: 0,
    },
    {
      id: MACHINE_REMOTE_ID,
      kind: 'remote',
      name: MACHINE_REMOTE_NAME,
      hostname: 'mea-workstation',
      online: true,
      enabledRuntimes: ['pi', 'claude-code'],
      maxConcurrent: 3,
      runningSteps: 0,
    },
  ],
  providerSources: [PROVIDER_SOURCE_PI, PROVIDER_SOURCE_CC],
  providers: PROVIDERS,
};

export const resourcesDefault: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  resources: RESOURCES,
};

export const resourcesSkillsList: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    skills: [
      { name: 'code-review', description: '按团队规范审查改动并给出修改建议' },
      { name: 'release-notes', description: '按提交历史起草发布说明' },
      { name: 'repo-audit', description: '盘点仓库依赖与许可证' },
    ],
  },
};

export const resourcesCcMissing: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: null,
      },
    ],
  },
};

export const resourcesCcBinGone: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: null }],
  },
};

export const resourcesCcLegacy: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [{ ...PROVIDER_SOURCE_CC, bin: undefined }],
  },
};

export const resourcesCcNoConfig: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      {
        runtime: 'claude-code',
        installed: false,
        hostname: MACHINE_NAME,
        models: [],
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
      },
    ],
  },
};

export const resourcesCcLoggedOut: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    providerSources: [
      PROVIDER_SOURCE_PI,
      { ...PROVIDER_SOURCE_CC, auth: { state: 'not-logged-in', provider: 'firstParty' } },
    ],
  },
};

const LOGIN_DAY_MS = 24 * 60 * 60 * 1000;

export const machinesMasterDetail: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      {
        id: 'md-omarchy',
        kind: 'local',
        name: 'omarchy',
        online: true,
        enabledRuntimes: ['pi', 'claude-code'],
        chiefHost: true,
        maxConcurrent: 3,
        runningSteps: 1,
        recommendedConcurrent: 4,
        concurrencySource: 'measured',
        concurrencyRange: { min: 1, max: 8 },
        capabilities: {
          mcpServers: ['github', 'linear'],
          skills: ['review', 'ship', 'verify'],
          osPlatform: 'linux',
        },
        claudeLogin: { state: 'ok', expiresAt: Date.now() + 30 * LOGIN_DAY_MS },
        providers: [
          {
            runtime: 'claude-code',
            login: 'logged-in',
            plan: 'Pro',
            version: '2.1.316',
            loginCommand: null,
            enabled: true,
            observedAt: Date.now(),
          },
          {
            runtime: 'codex',
            login: 'logged-out',
            plan: null,
            version: '0.167.0',
            loginCommand: 'codex login',
            enabled: false,
            observedAt: Date.now(),
          },
          {
            runtime: 'pi',
            login: 'unknown',
            plan: null,
            version: '1.4.2',
            loginCommand: null,
            enabled: true,
            observedAt: Date.now(),
          },
        ],
      },
      {
        id: 'md-build-box',
        kind: 'remote',
        name: 'build-box',
        online: true,
        enabledRuntimes: ['pi', 'claude-code'],
        maxConcurrent: 4,
        runningSteps: 0,
        concurrencySource: 'manual',
        maxConcurrentOverridden: true,
        recommendedConcurrent: 6,
        concurrencyRange: { min: 1, max: 8 },
        capabilities: null,
        claudeLogin: { state: 'expired', expiresAt: Date.now() - 60 * 60 * 1000 },
        providers: [
          {
            runtime: 'claude-code',
            login: 'logged-out',
            plan: null,
            version: '2.1.316',
            loginCommand: 'claude auth login',
            enabled: true,
            observedAt: Date.now(),
          },
        ],
      },
      {
        id: 'md-old-laptop',
        kind: 'remote',
        name: 'old-laptop',
        online: false,
        lastSeenAt: Date.now() - 12 * 60_000,
        enabledRuntimes: ['pi'],
        maxConcurrent: 2,
        runningSteps: 0,
        concurrencySource: 'estimate',
        concurrencyRange: { min: 1, max: 4 },
        capabilities: null,
      },
    ],
  },
};

export const machinesDuplicateNames: FixtureSet = {
  ...machinesMasterDetail,
  resources: {
    ...RESOURCES,
    machines: [
      ...(machinesMasterDetail.resources?.machines ?? []),
      {
        id: 'md-build-box-b7q2',
        kind: 'remote',
        name: 'build-box',
        online: false,
        lastSeenAt: Date.now() - 3 * 60 * 60_000,
        enabledRuntimes: ['pi'],
        maxConcurrent: 2,
        runningSteps: 0,
        concurrencySource: 'estimate',
        concurrencyRange: { min: 1, max: 4 },
        capabilities: null,
      },
    ],
  },
};

const FLEET_SLOTS = [
  { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'default-sonnet' },
  { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5', slot: 'default-haiku' },
];

export const providersFleet: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      {
        id: 'fleet-mac',
        kind: 'local',
        name: MACHINE_NAME,
        online: true,
        enabledRuntimes: ['pi', 'claude-code'],
        capabilities: { mcpServers: [], skills: [], executor: 'host', osPlatform: 'darwin' },
      },
      {
        id: 'fleet-box',
        kind: 'remote',
        name: 'build-box',
        online: true,
        enabledRuntimes: ['pi', 'claude-code'],
        capabilities: { mcpServers: [], skills: [], executor: 'host', osPlatform: 'linux' },
      },
      {
        id: 'fleet-box-orb',
        kind: 'remote',
        name: 'build-box-orb',
        online: true,
        enabledRuntimes: ['claude-code'],
        capabilities: { mcpServers: [], skills: [], executor: 'orb', osPlatform: 'linux' },
      },
      {
        id: 'fleet-old',
        kind: 'remote',
        name: 'old-laptop',
        online: false,
        enabledRuntimes: ['pi', 'claude-code'],
      },
      {
        id: 'fleet-new',
        kind: 'remote',
        name: 'new-box',
        online: true,
        enabledRuntimes: ['pi'],
      },
    ],
    providerSources: [
      {
        ...PROVIDER_SOURCE_PI,
        models: [
          ...PROVIDER_SOURCE_PI.models,
          { id: 'claude-opus-4-5', name: 'claude-opus-4-5', liveness: 'dead' },
        ],
      },
      {
        runtime: 'claude-code',
        installed: true,
        hostname: MACHINE_NAME,
        machineId: 'fleet-mac',
        bin: { path: '/Users/u/.local/bin/claude', version: '2.1.316' },
        auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
        models: FLEET_SLOTS,
      },
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'build-box',
        machineId: 'fleet-box',
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.316' },
        auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
        models: FLEET_SLOTS,
      },
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'build-box',
        machineId: 'fleet-box-orb',
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.316' },
        auth: { state: 'not-logged-in', provider: 'firstParty' },
        models: FLEET_SLOTS,
      },
      {
        runtime: 'claude-code',
        installed: true,
        hostname: 'DESKTOP-OLD',
        machineId: 'fleet-old',
        bin: { path: '/home/u/.local/bin/claude', version: '2.1.285' },
        auth: { state: 'logged-in', method: 'oauth_token', provider: 'firstParty' },
        models: [
          { id: 'glm-5.3', name: 'glm-5.3', slot: 'default-opus' },
          { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', slot: 'default' },
        ],
      },
    ],
  },
};

export const providersEmpty: FixtureSet = {
  ...resourcesDefault,
  resources: { ...RESOURCES, providers: [], providerSources: [PROVIDER_SOURCE_PI] },
};

const connector = (
  id: string,
  fields: Pick<
    McpConnectorRecord,
    'slug' | 'label' | 'catalogId' | 'url' | 'headerNames' | 'status' | 'authKind'
  > &
    Partial<McpConnectorRecord>,
): McpConnectorRecord => ({
  id,
  teamId: TEAM_ID,
  account: null,
  statusReason: null,
  toolCount: null,
  checkedAt: r7(13, 10),
  createdAt: r7(9, 0),
  updatedAt: r7(13, 10),
  ...fields,
});

const MCP_CONNECTORS: McpConnectorRecord[] = [
  connector('mcp-github', {
    slug: 'github',
    label: 'GitHub',
    catalogId: 'github',
    url: 'https://api.githubcopilot.com/mcp/',
    headerNames: ['Authorization', 'X-MCP-Readonly'],
    authKind: 'static',
    status: 'connected',
    toolCount: 41,
  }),
  connector('mcp-context7', {
    slug: 'context7',
    label: 'Context7',
    catalogId: 'context7',
    url: 'https://mcp.context7.com/mcp',
    headerNames: [],
    authKind: 'none',
    status: 'connected',
    toolCount: 2,
  }),
  connector('mcp-cloudflare', {
    slug: 'cloudflare',
    label: 'Cloudflare',
    catalogId: 'cloudflare',
    url: 'https://mcp.cloudflare.com/mcp',
    headerNames: [],
    authKind: 'oauth',
    status: 'needs_auth',
    statusReason: 'refresh_rejected',
  }),
  connector('mcp-wiki', {
    slug: 'team-wiki',
    label: '团队知识库',
    catalogId: null,
    url: 'https://wiki.example.com/mcp',
    headerNames: ['Authorization'],
    authKind: 'static',
    status: 'error',
    statusReason: 'timeout',
  }),
];

export const resourcesMcpConnectors: FixtureSet = {
  ...resourcesDefault,
  resources: { ...RESOURCES, mcpConnectors: MCP_CONNECTORS },
};

export const resourcesMcpConnectGithub: FixtureSet = {
  ...resourcesDefault,
  resources: { ...RESOURCES, mcpConnectors: MCP_CONNECTORS.slice(1) },
  ui: { mcpDialog: { kind: 'catalog', catalogId: 'github' } },
};

export const resourcesMcpAddServer: FixtureSet = {
  ...resourcesMcpConnectors,
  ui: { mcpDialog: { kind: 'custom' } },
};

export const resourcesMcpManageNeedsAuth: FixtureSet = {
  ...resourcesMcpConnectors,
  ui: { mcpDialog: { kind: 'manage', connectorId: 'mcp-cloudflare' } },
};

export const resourcesMcpAuthorizing: FixtureSet = {
  ...resourcesMcpConnectors,
  ui: { mcpDialog: { kind: 'authorizing', catalogId: 'notion' } },
};

export const resourcesMcpConfirmHost: FixtureSet = {
  ...resourcesMcpConnectors,
  ui: {
    mcpDialog: { kind: 'confirm', name: '团队知识库', host: 'auth.wiki.example.com' },
  },
};

export const resourcesMcpOAuthDenied: FixtureSet = {
  ...resourcesMcpConnectors,
  ui: { mcpDialog: { kind: 'landing', reason: 'denied', name: 'Linear' } },
};

const composioConnector = (
  id: string,
  slug: string,
  label: string,
  fields: Partial<McpConnectorRecord> = {},
): McpConnectorRecord =>
  connector(id, {
    slug,
    label,
    catalogId: 'composio',
    url: 'https://mcp.composio.dev',
    headerNames: ['x-api-key'],
    authKind: 'composio',
    status: 'needs_auth',
    ...fields,
  });

const COMPOSIO_APPS: NonNullable<ResourcesContent['composioApps']> = {
  configured: true,
  apps: [
    {
      slug: 'gmail',
      name: 'Gmail',
      description: 'Read, search and send mail',
      logoUrl: null,
      noAuth: false,
      toolsCount: 24,
      connector: composioConnector('cx-gmail', 'gmail', 'Gmail', {
        status: 'connected',
        toolCount: 24,
      }),
    },
    {
      slug: 'linear',
      name: 'Linear',
      description: 'Issues and project tracking',
      logoUrl: null,
      noAuth: false,
      toolsCount: 31,
      connector: composioConnector('cx-linear', 'linear', 'Linear', {
        status: 'needs_auth',
        statusReason: 'authorizing',
      }),
    },
    {
      slug: 'notion',
      name: 'Notion',
      description: 'Docs and wikis',
      logoUrl: null,
      noAuth: false,
      toolsCount: 19,
      connector: composioConnector('cx-notion', 'notion', 'Notion', {
        status: 'needs_auth',
        statusReason: 'no connected account',
      }),
    },
    {
      slug: 'slack',
      name: 'Slack',
      description: 'Channels and messages',
      logoUrl: null,
      noAuth: false,
      toolsCount: 47,
      connector: null,
    },
    {
      slug: 'googledrive',
      name: 'Google Drive',
      description: 'Files and folders',
      logoUrl: null,
      noAuth: false,
      toolsCount: 12,
      connector: composioConnector('cx-drive', 'googledrive', 'Google Drive', {
        status: 'revoked',
        statusReason: 'revoked',
      }),
    },
    {
      slug: 'calculator',
      name: 'Calculator',
      description: null,
      logoUrl: null,
      noAuth: true,
      toolsCount: 3,
      connector: null,
    },
  ],
};

export const resourcesComposioApps: FixtureSet = {
  ...resourcesMcpConnectors,
  resources: { ...RESOURCES, mcpConnectors: MCP_CONNECTORS, composioApps: COMPOSIO_APPS },
};

export const resourcesComposioNoKey: FixtureSet = {
  ...resourcesMcpConnectors,
  resources: {
    ...RESOURCES,
    mcpConnectors: MCP_CONNECTORS,
    composioApps: { configured: false, apps: [] },
  },
};

const GITHUB_APP_CONNECTOR = connector('mcp-github-app', {
  slug: 'github',
  label: 'GitHub',
  catalogId: 'github',
  url: 'https://api.githubcopilot.com/mcp/',
  headerNames: [],
  authKind: 'github-app',
  account: 'lin-wei',
  status: 'connected',
  toolCount: 41,
});

const GITHUB_APP_READY = {
  available: true,
  installUrl: 'https://github.com/apps/cairn-app/installations/new',
  connectionReady: true,
};

const githubDevice = (
  step: import('./records.js').GithubDeviceFixtureStep,
  connected: boolean,
): FixtureSet => ({
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    githubConnector: GITHUB_APP_READY,
    mcpConnectors: connected
      ? [GITHUB_APP_CONNECTOR, ...MCP_CONNECTORS.slice(1)]
      : MCP_CONNECTORS.slice(1),
  },
  ui: { mcpDialog: { kind: 'github-device', step } },
});

export const resourcesMcpGithubDeviceCode = githubDevice('code', false);
export const resourcesMcpGithubDeviceDenied = githubDevice('denied', false);
export const resourcesMcpGithubDeviceExpired = githubDevice('expired', false);
export const resourcesMcpGithubDeviceRepos = githubDevice('repos', true);
export const resourcesMcpGithubDeviceReposMissing = githubDevice('repos-missing', true);
export const resourcesMcpGithubDeviceReconnect = githubDevice('reconnect', true);

export const resourcesMcpGithubConnected: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    githubConnector: GITHUB_APP_READY,
    mcpConnectors: [GITHUB_APP_CONNECTOR, ...MCP_CONNECTORS.slice(1)],
  },
};

export const resourcesMcpGithubManage: FixtureSet = {
  ...resourcesMcpGithubConnected,
  ui: { mcpDialog: { kind: 'manage', connectorId: 'mcp-github-app' } },
};

type OwnMacCapabilities = NonNullable<MachineRow['capabilities']>;

const OWN_MAC_READY: OwnMacCapabilities = {
  mcpServers: [],
  skills: [],
  osPlatform: 'darwin',
  ownComputer: true,
  ownComputerShell: true,
  hostPermissions: { accessibility: 'granted', automation: 'unknown', screenRecording: 'granted' },
};

function ownMac(
  id: string,
  name: string,
  patch: Partial<MachineRow>,
  capabilities: Partial<OwnMacCapabilities> = {},
): MachineRow {
  return {
    id,
    kind: 'local',
    name,
    online: true,
    enabledRuntimes: ['pi'],
    maxConcurrent: 3,
    runningSteps: 0,
    ...patch,
    capabilities: { ...OWN_MAC_READY, ...capabilities },
  };
}

const MINUTE = 60_000;

export const ownComputerStates: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      ownMac('oc-cli', 'cli-mac', {}, { ownComputer: undefined }),
      ownMac(
        'oc-no-ax',
        'no-access-mac',
        {},
        {
          hostPermissions: {
            accessibility: 'denied',
            automation: 'unknown',
            screenRecording: 'denied',
          },
        },
      ),
      ownMac(
        'oc-no-screen',
        'no-screen-mac',
        {},
        {
          hostPermissions: {
            accessibility: 'granted',
            automation: 'unknown',
            screenRecording: 'denied',
          },
        },
      ),
      ownMac('oc-ready', 'macbook-pro', {
        ownComputerFixture: {
          activity: [
            {
              callId: 'a'.repeat(64),
              tool: 'user_computer_shell',
              summary: 'xcodebuild -scheme Cairn -configuration Debug build',
              state: 'done',
              exitCode: 0,
              error: null,
              threadId: 'chief-thread-1',
              threadTitle: '验收桌面版的托盘菜单',
              createdAt: Date.now() - 4 * MINUTE,
            },
            {
              callId: 'b'.repeat(64),
              tool: 'user_computer_act',
              summary: 'Cairn: click, type',
              state: 'done',
              exitCode: null,
              error: null,
              threadId: 'chief-thread-1',
              threadTitle: '验收桌面版的托盘菜单',
              createdAt: Date.now() - 6 * MINUTE,
            },
            {
              callId: 'c'.repeat(64),
              tool: 'user_computer_shell',
              summary: 'pnpm test --filter @cairn/desktop',
              state: 'done',
              exitCode: 1,
              error: null,
              threadId: null,
              threadTitle: null,
              createdAt: Date.now() - 2 * 60 * MINUTE,
            },
            {
              callId: 'd'.repeat(64),
              tool: 'user_computer_observe',
              summary: 'Finder',
              state: 'done',
              exitCode: null,
              error: null,
              threadId: 'chief-thread-2',
              threadTitle: '整理下载文件夹',
              createdAt: Date.now() - 26 * 60 * MINUTE,
            },
          ],
        },
      }),
    ],
  },
};

export const folderGrantsStates: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      ownMac('fg-bound', 'folders-mac', {
        folderGrants: {
          workspacesDir: '/Users/ian/cairn/workspaces',
          bindsGrants: true,
          pins: [
            { path: '/Users/ian/Code', status: 'confirmed', enabled: true },
            { path: '/Users/ian/Documents', status: 'confirmed', enabled: false },
            { path: '/opt/shared', status: 'pending', enabled: false },
            { path: '/etc/secret', status: 'rejected', enabled: false },
            { path: '/Users/ian/gone', status: 'absent', enabled: false },
          ],
        },
      }),
      ownMac('fg-unbound', 'plain-mac', {
        folderGrants: {
          workspacesDir: '/srv/agent/workspaces',
          pins: [
            { path: '/srv/data', status: 'confirmed', enabled: false },
            { path: '/var/tmp/staging', status: 'pending', enabled: false },
          ],
        },
      }),
      ownMac('fg-none', 'bare-mac', {}),
    ],
  },
};

export const computerGrantsStates: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    machines: [
      ownMac('cg-default', 'capable-mac', {}, { computer: true, browser: true }),
      ownMac(
        'cg-browser-off',
        'no-browser-mac',
        { browserOverride: false },
        { computer: true, browser: true },
      ),
      ownMac(
        'cg-desktop-off',
        'no-desktop-mac',
        { desktopOverride: false },
        { computer: true, browser: true },
      ),
      ownMac(
        'cg-explicit-on',
        'pinned-mac',
        { browserOverride: true, desktopOverride: true },
        { computer: true, browser: true },
      ),
      ownMac('cg-plain', 'plain-mac', {}),
    ],
  },
};

const MAIL_ACCOUNT: import('@cairn/shared').MailAccountRecord = {
  id: 'mail-qq',
  address: 'ian.xie@qq.com',
  imapHost: 'imap.qq.com',
  imapPort: 993,
  smtpHost: 'smtp.qq.com',
  smtpPort: 465,
  status: 'watching',
  lastError: null,
  lastMailAt: Date.UTC(2026, 10, 19, 9, 42),
  wakeMode: 'all',
  rules: [],
};

export const resourcesMailEmpty: FixtureSet = {
  ...resourcesDefault,
  resources: { ...RESOURCES, mailAccounts: [] },
};

export const resourcesMailConnected: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    mailAccounts: [
      MAIL_ACCOUNT,
      {
        ...MAIL_ACCOUNT,
        id: 'mail-qq-work',
        address: 'ian@foxmail.com',
        status: 'connecting',
        lastMailAt: Date.UTC(2026, 10, 19, 9, 5),
        wakeMode: 'rules',
        rules: [
          { id: 'r1', matchKind: 'sender_allow', pattern: 'dana@corp.example' },
          { id: 'r2', matchKind: 'subject_contains', pattern: '发票' },
        ],
      },
      {
        ...MAIL_ACCOUNT,
        id: 'mail-gmail',
        address: 'ian@gmail.com',
        imapHost: 'imap.gmail.com',
        smtpHost: 'smtp.gmail.com',
        lastMailAt: Date.UTC(2026, 10, 18, 22, 10),
      },
    ],
  },
};

export const resourcesMailError: FixtureSet = {
  ...resourcesDefault,
  resources: {
    ...RESOURCES,
    mailAccounts: [
      { ...MAIL_ACCOUNT, status: 'revoked', lastError: 'auth-rejected' },
      {
        ...MAIL_ACCOUNT,
        id: 'mail-163',
        address: 'ian@163.com',
        imapHost: 'imap.163.com',
        smtpHost: 'smtp.163.com',
        status: 'degraded',
        lastError: 'timeout',
      },
    ],
  },
};
