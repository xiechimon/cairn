import type { NetworkInterfaceInfo } from 'node:os';
import type { GitIdentity, TailnetAccess, TeamRecord, UserRecord } from '@cairn/shared';
import type { Logger } from 'pino';
import type { Db } from './db/client.js';
import type { ClerkVerifier } from './lib/clerk-auth.js';
import type { AccessVerifier } from './lib/cloudflare-access.js';
import type { FetchLike } from './lib/github.js';
import type { OwnerChannel } from './lib/owner-channel.js';
import type { KeySecretBox } from './lib/secret-box.js';
import type { StreamTicketBook } from './services/browser-session.js';
import type { CodexDeviceState } from './services/codex-device-login.js';
import type { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import type { GithubConnectionDeviceAttempt } from './services/github-connection-device.js';
import type { ImService } from './services/im/core.js';
import type { ImBridge } from './services/im/imessage.js';
import type { PendingUpload } from './services/machine-uploads.js';
import type { MachineWakeHub } from './services/machine-wake-hub.js';
import type { MailConnector } from './services/mail-connector.js';
import type { SendMail } from './services/mail-smtp.js';
import type { GithubAppRegistration, McpOAuthState } from './services/mcp-servers.js';
import type { OAuthClientConfig, OAuthStateEntry } from './services/oauth.js';
import type { PageThumbnails } from './services/page-thumbnails.js';
import type { VapidKeys } from './services/push.js';
import type { SkillImportFetch } from './services/skill-import.js';
import type { TailscaleServe } from './services/tailscale-serve.js';
import type { TailnetRemote } from './services/tsnet-remote.js';
import type { XaiDeviceState } from './services/xai-device-login.js';

export interface ClerkAuthContext {
  publishableKey: string;
  issuer: string;
  verify: ClerkVerifier;
}

export interface RemoteAccessContext {
  environmentId: string;
  listenHost: string;
  listenPort: number;
  tailnetStatus: () => TailnetAccess | null;
  tailnet?: TailnetRemote;
  tailscale?: TailscaleServe;
  networkInterfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
}

export interface AppContext {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  remote?: RemoteAccessContext;
  db: Db;
  hub: TeamStreamHub;
  machineHub: MachineWakeHub;
  convHub?: ConversationStreamHub;
  secretBox: KeySecretBox;
  vapidKeys?: VapidKeys | null;
  pushEndpointHosts?: ReadonlySet<string>;
  user: UserRecord;
  team: TeamRecord;
  im?: ImService;
  imBridge?: ImBridge;
  mail?: MailConnector;
  mailSend?: SendMail;
  pingIntervalMs: number;
  claimHoldMs: number;
  uploads: Map<string, PendingUpload>;
  streamTickets: StreamTicketBook;
  enrollments: Map<
    string,
    {
      teamId: string;
      name?: string;
      code: string;
      createdAt: number;
      hostKey?: string;
      legacyHostKeys?: string[];
      fromLocalHost?: boolean;
      machine?: { machineId: string; token: string; teamId: string; serverUrl: string };
    }
  >;
  reposDir: string;
  workspacesDir?: string | undefined;
  attachmentsDir: string;
  pageThumbnails?: PageThumbnails;
  backupStatusPath?: string;
  deployRecordPath?: string;
  skillsDir: string;
  skillSourcesPath: string;
  homeDir: string;
  dataDir?: string | undefined;
  skillImportFetch?: SkillImportFetch;
  skillImportTimeoutMs?: number;
  webDir?: string | null;
  githubFetch?: FetchLike;
  githubBaseFetch?: FetchLike;
  oauthStates: Map<string, OAuthStateEntry>;
  xaiDeviceStates: Map<string, XaiDeviceState>;
  codexDeviceStates: Map<string, CodexDeviceState>;
  githubConnectionDeviceStates: Map<string, GithubConnectionDeviceAttempt>;
  oauthFetch?: FetchLike;
  providerTestFetch?: typeof fetch;
  providerTestTimeoutMs?: number;
  antigravityVerifyTimeoutMs?: number;
  oauthClient: OAuthClientConfig | null;
  authToken: string | null;
  ownerChannel?: OwnerChannel;
  accessVerifier?: AccessVerifier | null;
  clerkAuth?: ClerkAuthContext | null;
  mcpConfigPath: string;
  mcpFetch?: typeof fetch;
  composioFetch?: typeof fetch;
  mcpOAuthState: McpOAuthState;
  mcpGithubApp?: GithubAppRegistration;
  logger?: Logger;
}
